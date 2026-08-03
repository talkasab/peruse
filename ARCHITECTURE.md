# peruse — Architecture (as implemented)

This document describes the system **as it is**. History and rationale live
in [docs/design-history.md](docs/design-history.md) and
[docs/DEVLOG.md](docs/DEVLOG.md); future work lives in
[GitHub issues](https://github.com/talkasab/peruse/issues).

peruse is a read-only local directory viewer: a small Bun server plus one
static page. Directory tree on the left, rendered file on the right;
git-aware change marks with per-hunk diff popups; live updates as files
change. Catppuccin Latte/Mocha. It never writes to the directory it serves.

## Process shape

```
bin/peruse.js         CLI: args, fd-limit re-exec, URL printing, browser open
server/index.js       Bun.serve: 5 routes + git + chokidar→SSE  (one file)
web/{index.html,app.js,style.css}   client source
dist/                 prebuilt client (bun build; auto-rebuilt when stale)
```

One external runtime dependency: **chokidar** (Bun's native watcher drops
events). Client libraries (markdown-it + plugins, Shiki, diff2html,
DOMPurify, Alpine.js, @catppuccin/palette) are devDependencies bundled into
`dist/`.

## CLI (`bin/peruse.js`)

`peruse [path] [--port 7440] [--host 127.0.0.1] [--no-open]`

- If the soft fd limit is low (<4096), re-execs itself once through `sh`
  with `ulimit -n` raised toward the hard limit (watcher fds; stock macOS
  shells allow 256). Guarded by `PERUSE_FDS_RAISED`.
- Default port walks forward to the next free one (up to +20); an explicit
  `--port` is pinned and fails loudly.
- Binding `0.0.0.0`/`::` prints every reachable URL (localhost + each
  non-internal IPv4: LAN, Tailscale, …). **No auth** — exposing beyond
  localhost is an explicit opt-in.

## Server (`server/index.js`)

All rendering is client-side; the server serves files, answers git
questions, and pushes change events. Every request path is resolved under
the served root (traversal guard); `.git/` is never listed or served.
Symlinks are followed for file access — deliberately including links whose
target lies outside the served root (owner decision 2026-07-25;
characterized in the integration suite; network-mode confinement is issue
#21). Symlink entries do not appear in the tree (dirents are neither file
nor directory), but direct paths through them serve normally.

| Endpoint | Returns |
|---|---|
| `GET /` + assets | prebuilt client from `dist/` (auto-rebuilt at startup if `web/` is newer — checkout runs only) |
| `GET /api/tree` | nested JSON tree; per-file git status letter; gitignored flags; per-dir `dirty` flag (any changed descendant); gitignored dirs listed but not walked; ≤500 entries per dir with an inert "… N more" row |
| `GET /api/file?path=` | text content, size, binary flag, status, hunks |
| `GET /raw/<path>` | raw bytes, correct MIME (images, markdown assets) |
| `GET /api/events` | SSE change stream |

### Git

Plain `git` subprocesses, cwd = served root: `status --porcelain=v2 -z
-uall` (statuses; repo-prefix aware), `ls-files -o -i --exclude-standard
--directory` (ignored set, dirs collapsed). Diff base is worktree-vs-`HEAD`
(empty-tree hash when HEAD is unborn); untracked files diff against
`/dev/null` via `--no-index`. Non-git directories degrade gracefully
(no statuses, no hunks, no warning).

### Hunks

`git diff -U0` so **each contiguous change is its own hunk** — marks sit
exactly on changed lines and nearby edits never merge. The server then
splices up to 3 context lines around each change into the hunk's `patch`
(from worktree content, identical on both diff sides; per-side header
arithmetic handles the count-0 line-after-which convention). Fields:
`oldStart/oldLines/newStart/newLines/kind(added|modified|deleted)/patch`.

### Watching → SSE

`Bun.serve` runs with `idleTimeout: 0` — its 10 s default kills idle
connections, which is fatal for the SSE stream (idle by design, 30 s
pings) and for slow first responses; the git layer's own 30 s subprocess
cap provides the real bound.

One chokidar watcher, events coalesced into ~200 ms batches:
`{"changed": [paths], "git": bool}` (`.git/*` changes set `git`, are never
forwarded as file events). Clients re-fetch the tree on any event and
re-fetch the open file when it changed (preserving scroll + open popup).

Robustness (each learned from a real failure):
- `followSymlinks: false`; skip sockets/FIFOs/devices; watcher errors are
  rate-limit logged, never fatal.
- Never watch gitignored dirs (they're never shown expanded). Ignore set
  refreshed from every git status call.
- Watch budget: at most ⅛ of the real fd limit in distinct admitted paths
  (chokidar holds fds per watched *file* under Bun and doesn't reliably
  pass `stats` to the ignore callback — admission is by first sight).
  `PERUSE_WATCH_BUDGET` overrides; `startServer`'s `watchBudget` option (used
  by tests) takes precedence over both.
- Below ~1024 fds even the initial scan can starve the process: watching
  is disabled entirely with a clear message instead.
- `startServer` returns a `ready` promise (resolves on chokidar's initial
  scan, or immediately if watching is disabled) and closes the watcher and
  ping timer if startup fails (e.g. a pinned `--port` already in use) rather
  than leaking them.

## Client (`web/`)

Alpine.js component; no framework build. State: tree + flattened visible
rows (depth-annotated), selection via `location.hash` (`#/path`), theme in
`localStorage` (default `prefers-color-scheme`).

- **Tree**: VS Code explorer conventions — uniform 24 px rows, rotating
  chevrons (only on expandable dirs), folder/file SVG-mask icons, indent
  guides, status letters (M yellow, A/U green, D red, R teal — the
  explorer-badge palette), yellow dot on dirs containing changes,
  gitignored entries muted by label color (hide toggle in header),
  changed-only filter auto-expanding directories.
- **Markdown**: markdown-it (GFM: tables, strikethrough, autolinks,
  task lists, anchors, footnotes; raw HTML on). Every block token carries
  `data-lines` (source range) via a core rule; fences highlighted by the
  same Shiki instance as code files. YAML frontmatter renders as a
  key/value card; stripped lines are replaced with blanks so `data-lines`
  stays true to file lines. Relative links open in-app (tree follows);
  relative images rewrite to `/raw/`; external links get `target=_blank`.
  Rendered HTML passes through DOMPurify before DOM insertion; raw HTML
  remains supported, while active content and Alpine directives (`x-*`,
  `@*`, `:*`) are removed. The sanitizer preserves common README HTML,
  task-list inputs, fragment IDs/links, and Shiki's classes and inline
  dual-theme styles.
  Each h1/h2 + content is wrapped in a `<section>` at render time so
  headings pin to the pane top while their section scrolls and are pushed
  off by the next (no sticky stacking).
- **Code**: Shiki dual-theme (`catppuccin-latte`/`mocha`, CSS-variable
  output — theme flips without re-render), ~30 eagerly bundled grammars,
  JS regex engine (no wasm), line numbers via CSS counters. Files >1 MB or
  >10k lines render plain with a notice.
- **Change marks** (the core interaction):
  - Code: 3 px gutter bars on exactly the changed lines (blue modified,
    green added) and a red wedge at deletion points — the VS Code/JetBrains
    gutter convention.
  - Markdown: a fixed change rail left of **all** content — overlay bars,
    JS-measured per marked block (`offsetTop`/`offsetHeight` against the
    positioned `#viewer`), one x at any nesting depth, re-laid on resize
    via ResizeObserver. The **innermost** intersecting block is marked.
  - Wholly-new files (status U/A) get **no** in-file marks — the status
    badge already says it all.
  - Click a mark → that change's diff in a **popup** anchored at the mark
    (JetBrains-style; never a whole-page diff view). diff2html renders
    just the hunk; unified default, split toggle; one popup at a time;
    dismissed by re-click, ✕, Esc, or click-outside. Pure additions get
    marks but **no popup** (the content is already visible).
  - Header chip `‹ N changes ›` counts and steps through
    modified/deleted changes, scrolling each into view.
- **Feedback**: selecting a file shows a floating "rendering …" pill,
  `position: sticky` at the top of `#viewer-scroll` so it pins to the
  viewport at any scroll depth; its spinner is transform-animated so the
  compositor keeps it moving while Shiki blocks the main thread. Shown for
  silent refreshes only >300 KB.
- **Navigation vs. live refresh**: `selectFile` awaits a fetch and up to two
  frames, so selections overlap. A real navigation records the path it is
  heading for (`wanted`) and takes a token (`nav`); an SSE silent refresh
  carries whatever path was loaded when it fired, so if the user has since
  navigated away it drops out instead of re-rendering the old file and writing
  that path back to `location.hash` (issue #26).
- **Binary/images**: images render via `/raw/`; other binaries show a
  metadata card with a download link.

All file-derived rich HTML insertion paths are sanitized: rendered Markdown
(including highlighted fences), highlighted code, and diff2html popup output.
Static image/file cards continue to encode URL paths and escape displayed text.

## Theming

`@catppuccin/palette` CSS variables; semantic vars mapped per
`data-theme` (latte/mocha) on `<html>`; Shiki dual-theme variables and
diff2html `--d2h-*` overrides key off the same attribute — one attribute
flip restyles everything.

## Testing

Three tiers (no test framework dependency; `playwright-core` for E2E). The
core browser journeys share a fixture from `test/fixture.js`, which builds a
throwaway git repo covering every state peruse renders — including the
shapes behind past incidents (separated edits, symlinks, ignored dirs,
oversized dirs). No socket/FIFO is included: chokidar's initial scan hangs
indefinitely on one (reproduced under Bun on Linux; issue #20), so that
corner of the watcher's `ignored` skip is untested rather than risk hanging
the suite.
Regression assertions are tagged with the commit that fixed the incident
they guard.

- `bun run test` → **unit** (`test/unit/`: parseHunks, withContext, safePath,
  buildTree, gitStatus porcelain-v2 parsing, web/lib.js helpers, rendered HTML
  sanitization and compatibility) +
  **integration** (`test/integration/`: real server + real git over HTTP —
  tree/file/raw contracts, SSE coalescing and gitignore-skip,
  idle-connection survival, port fallback, tiny-watch-budget survival,
  non-git degradation).
- `bun run test:e2e` → **E2E** (`test/e2e/`): five core Chromium journeys —
  smoke, code review (exact marks, popup scope), markdown review (rail
  single-x measurement, innermost marks, arrows, links, pinned headers,
  no body scroll), live updates, theming (Latte/Mocha token + popup color
  flip) — plus two self-contained regressions, each with its own fixture,
  server, and fresh page: Markdown sanitization (inert hostile HTML alongside
  preserved README/task-list/Shiki rendering in the live DOM) and navigation
  (a silent refresh must not undo an in-flight navigation).
  Chromium binary via `PERUSE_CHROMIUM` or playwright's registry.

The core journeys share one page. That pattern surfaced issue #26, which looked
like harness flakiness but was an application race: an SSE silent refresh
landing mid-navigation reverted `location.hash`, undoing a link click in about
a quarter of runs. The fix is in `selectFile` (see Navigation vs. live refresh
above); `navigation.test.js` drives the race deterministically. The sanitization
and navigation regressions each use their own fixture, server, and page.

## Development tooling

Biome 2.x is the repository-wide formatter, import organizer, and recommended
rules linter. It formats JavaScript, CSS, and JSON; HTML remains unformatted but
is linted. Generated `dist/` content is excluded. Three CSS `!important` uses
carry reasoned inline ignores because Alpine cloaking and the app's Shiki theme
overrides must beat other display/background declarations.

TypeScript checks the production plain ESM JavaScript through JSDoc with
`allowJs`, `checkJs`, `noEmit`, and full `strict` mode (including
`noImplicitAny`). The root `tsconfig.json` covers `bin/` and `server/` with Bun
globals; `web/tsconfig.json` covers `web/*.js` with DOM libraries and no Bun
globals. `web/globals.d.ts` contains declarations only for the two markdown-it
plugins that do not ship types and the Alpine window global. There is still no
TypeScript compile step.

`test/` is linted and formatted by Biome but is not type-checked. A trial
test-scoped config surfaced roughly 200 diagnostics across the 12 test files:
test fixture/helper parameters, Playwright page-evaluation globals and DOM
assertions, test-only null assertions, and conflicting Bun-vs-DOM stream types
from importing both server and web modules. Closing that separate body of work
would require broad test-harness annotation rather than a small configuration
extension, so issue #16 deliberately limits full-strict checking to production
code.

- `bun run lint` — read-only Biome format, lint, and import-order gate.
- `bun run fix` — apply Biome formatting and safe fixes.
- `bun run typecheck` — run both production JavaScript type-checking environments.
- `bun run check` — the single quality gate: lint, then type-check.

No CI is wired up; the suite runs locally (`bun test`, `bun run test:e2e`).
CI automation is tracked in issue #1.

Known watcher limitation: a directory containing a dangling symlink is
silently unwatched by chokidar (issue #17); tree/file serving is
unaffected, only live updates for that directory.

## Layout invariants

The app never scrolls at the body level: `min-height: 0` on every
grid/flex child in the scroll chain keeps scrolling inside `#tree` and
`#viewer-scroll`, so the app header, pane header, and pinned section
headings always stay put.
