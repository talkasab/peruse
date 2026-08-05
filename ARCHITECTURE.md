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
bin/peruse.js         CLI: registry verbs, args, fd-limit re-exec, URL printing
server/projects.js    project registry + live worktrees + landing git summaries
server/index.js       Bun.serve: multi-root routes + git + lazy chokidar→SSE
web/{index.html,app.js,style.css}   client source
dist/                 prebuilt client (bun build; auto-rebuilt when stale)
```

One external runtime dependency: **chokidar** (Bun's native watcher drops
events). Client libraries (markdown-it + plugins, Shiki, diff2html,
DOMPurify, Alpine.js, @catppuccin/palette) are devDependencies bundled into
`dist/`.

## CLI (`bin/peruse.js`)

`peruse [path] [--port 7440] [--host 127.0.0.1]`

`peruse add <path> | rm <name-or-path> | list | prune`

- The registry is a JSON array at `~/.config/peruse/projects.json`; each public
  entry has `path`, collision-safe `name`, and ISO `lastOpened`. `peruse <path>`
  canonicalizes and auto-registers the directory, then prints URLs pointing at
  `/p/<encoded-name>/`. With no path the URLs point at the landing page `/`.
- Missing projects are retained and shown dimmed. The first observed miss adds
  an internal `missingSince`; automatic maintenance removes it only after 30
  days continuously absent. `peruse prune` explicitly removes all currently
  missing projects immediately. `PERUSE_CONFIG_DIR` overrides the config
  directory for tests and isolated environments.

- If the soft fd limit is low (<4096), re-execs itself once through `sh`
  with `ulimit -n` raised toward the hard limit (watcher fds; stock macOS
  shells allow 256). Guarded by `PERUSE_FDS_RAISED`.
- Default port walks forward to the next free one (up to +20); an explicit
  `--port` is pinned and fails loudly.
- Binding `0.0.0.0`/`::` prints every reachable URL (localhost + each
  non-internal IPv4: LAN, Tailscale, …). **No auth** — exposing beyond
  localhost is an explicit opt-in.
- The CLI never opens a browser (owner decision 2026-08-05): peruse's home
  use case is remote — the machine running the server is not the machine
  running the browser. It prints clickable URLs and nothing else.

## Server (`server/index.js`)

All rendering is client-side. One server exposes every registered project at
`/p/<encoded-name>/`; `/` is the project landing page and `/api/projects`
returns the landing/switcher model. Every file request is resolved under its
selected project root (traversal guard); `.git/` is never listed or served.
Symlinks are followed for file access — deliberately including links whose
target lies outside the served root (owner decision 2026-07-25;
characterized in the integration suite; network-mode confinement is issue
#21). Symlink entries do not appear in the tree (dirents are neither file
nor directory), but direct paths through them serve normally.

| Endpoint | Returns |
|---|---|
| `GET /` + assets | landing/client bundle from `dist/` (auto-rebuilt at startup if `web/` is newer — checkout runs only) |
| `GET /api/projects` | registered projects plus live worktrees, missing state, last-opened time, and brief branch/change summary |
| `GET /p/<name>/` | project viewer client; opening it updates the registered parent's `lastOpened` |
| `GET /p/<name>/api/tree` | nested JSON tree; per-file git status letter; gitignored flags; per-dir `dirty` flag; ignored dirs listed but not walked; ≤500 entries per dir |
| `GET /p/<name>/api/file?path=` | text content, size, binary flag, status, hunks |
| `GET /p/<name>/raw/<path>` | raw bytes, correct MIME (images, markdown assets) |
| `GET /p/<name>/api/events` | project-scoped SSE change stream |

Worktrees are discovered with `git worktree list --porcelain` whenever the
project model is requested or a route is resolved. They are grouped under
their registered parent and receive transient `<parent>:<branch-or-directory>`
route names; they never enter `projects.json`. If the registered path is below
the repository root, the equivalent subdirectory is selected in each linked
worktree, so discovery never broadens the directory the user chose to expose.

### Enumeration cache

Enumeration costs two sequential git spawns per registered project
(`rev-parse --show-toplevel`, `worktree list --porcelain`), and every request
under `/p/<name>/` resolves its route through it. Each server memoizes one
settled enumeration plus currently pending identity keys (issue #28):

- The cache key is the sorted set of canonical **project name/path identities**.
  `add`, `rm`, `prune`, renames, path changes, and another process's identity
  edits invalidate immediately; `lastOpened` and missing-state bookkeeping do
  not discard identical Git discovery work during navigation.
- A settled result ages out after a 2 s TTL measured with a monotonic clock.
  `PERUSE_ENUM_TTL_MS` accepts only canonical, unpadded non-negative integer
  strings; blank, whitespace-padded, signed, negative, or malformed values use
  the default. Exact `0` disables settled-result reuse. `startServer`'s
  `enumerationTtlMs` option provides the same numeric override for tests and
  embedders.
- Pending promises are retained by identity key and reused regardless of
  elapsed time, including when keys interleave or the configured TTL is 0.
  Each pending entry is removed when it settles, its TTL starts at that point,
  and a rejection is never retained.
- Cached discovery arrays and targets are immutable. Every request receives
  copies with current `lastOpened` and filesystem-derived missing state, so
  concurrent registry snapshots and callers cannot mutate shared cache data.
- Route resolution validates every target against private filesystem-object
  identities (device/inode/birth time). Git targets additionally retain their
  administrative-directory object and `.git` linkage; named linked worktrees
  retain the branch ref. This rejects normal same-path replacement of plain
  roots, repositories, and linked worktrees inside the TTL. It is a best-effort
  incarnation signal rather than a persistent repository UUID: a filesystem
  that reports no stable identity, or reuses the same inode and birth time
  inside the TTL, can leave a residual stale window until fresh enumeration.
- Runtime resolution re-verifies the unchanged registry identity, mapped
  runtime, and target incarnation after watcher readiness settles. Project
  listing reconciliation compares each route's enumerated target with the
  runtime's captured path and identity—not only the route name—so collision
  suffix reassignment closes a runtime that belongs to the former target.

The integration measurement uses a cold 10-repository registry and the real
request sequence (root, project navigation, `/api/projects`, tree, file, and 20
concurrent raw assets). Disabling settled-result reuse costs 100 enumeration / 134
total Git spawns; the default cache costs 20 enumeration / 54 total spawns.

### Git

Plain `git` subprocesses, cwd = served root: `status --porcelain=v2 -z
-uall` (statuses; repo-prefix aware), `ls-files -o -i --exclude-standard
--directory` (ignored set, dirs collapsed). Diff base is worktree-vs-`HEAD`
(empty-tree hash when HEAD is unborn); untracked files diff against
`/dev/null` via `--no-index`. Non-git directories degrade gracefully
(no statuses, no hunks, no warning). Every invocation passes
`--no-optional-locks`: without it, `git status` opportunistically rewrites
`.git/index`, which both violates peruse's read-only contract and echoes
back through the watcher as a git-change event, re-rendering clients whose
request triggered the status call in the first place.

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

Each project/worktree gets an isolated chokidar watcher only on first access;
landing-page listing alone starts none. Events are coalesced into ~200 ms batches:
`{"changed": [paths], "git": bool}` (`.git/*` changes set `git`, are never
forwarded as file events). Clients re-fetch the tree on any event and
re-fetch the open file when it changed (preserving scroll + open popup).

Robustness (each learned from a real failure):
- `followSymlinks: false`; skip sockets/FIFOs/devices; watcher errors are
  rate-limit logged, never fatal.
- Never watch gitignored dirs (they're never shown expanded). Ignore set
  refreshed from every git status call.
- Watch budget: at most ⅛ of the real fd limit in distinct admitted paths,
  shared by chokidar discovery and recovery fallback handles
  (chokidar holds fds per watched *file* under Bun and doesn't reliably
  pass `stats` to the ignore callback — admission is by first sight).
  `PERUSE_WATCH_BUDGET` overrides; `startServer`'s `watchBudget` option (used
  by tests) takes precedence over both.
- Below ~1024 fds even the initial scan can starve the process: watching
  is disabled entirely with a clear message instead.
- The first project request waits for that project's lazy watcher's initial
  scan (or the no-watch fallback) before responding, so an SSE client cannot
  mutate a file in the gap between connecting and watcher readiness. Closing a
  runtime always settles pending readiness with a distinct closure error;
  request resolution converts only that signal to not-found and rechecks the
  closed state after a fulfilled wait, so awaiters neither hang nor receive a
  closed runtime. The readiness rejection has a permanent observer so closing
  an unused runtime cannot emit an unhandled rejection. Runtime
  teardown clears its ping, pending-flush, and recovery timers, closes and
  forgets every attached SSE controller, closes its fallback watches, then
  awaits watcher close. Every caller receives
  the same close promise. Route invalidation and listing reconciliation remove
  the runtime from the route map immediately but keep that promise registered;
  the ended response lets browser `EventSource` reconnect to the route's
  current runtime (or receive its current not-found response) instead of
  remaining attached to a silent obsolete watcher.
- Server shutdown first marks the lifecycle stopped and force-closes the HTTP
  listener, then drains pending runtime starts, mapped runtimes, and detached
  close promises until all three sets are empty. A start that finishes after
  shutdown begins closes its produced runtime before resolving and can never
  enter the route map. Consequently `await stop()` means no watcher startup or
  teardown remains in flight.
- Stall watchdog (issue #17). chokidar's scanner resolves every symlink it
  meets with `realpath()` and survives only ENOENT/EPERM/EACCES/ELOOP; any
  other errno (ENOTDIR in practice — a link pointing *through* a regular
  file) destroys that directory's listing, silently and without an `error`
  event. That listing both registers the watches and decrements chokidar's
  ready count, so one such link leaves the directory unwatched *and* 'ready'
  pending forever — and since the first request awaits `ready`, the project
  would serve nothing at all. The ignore callback cannot prevent it (the link
  is resolved before any filter runs), so the scan is watched for a stall
  instead: every filtered path is a heartbeat, and 3 s of silence with
  'ready' still pending triggers an inspection. Recovery names the offending
  links (`findScanBreakingLinks`) and covers each admitted stranded directory
  with a plain `fs.watch`, then resolves `ready`. The fallback treats the
  platform event as an invalidation hint and diffs guarded `lstat` directory
  snapshots, so rename-over atomic saves report the replaced target rather
  than only the temporary filename. New directories are checked before being
  handed to chokidar; a later poisoned directory moved into a recovered
  directory therefore receives the same fallback. Fallback and traversal use
  the normal skip/budget policy, and direct chokidar events are suppressed
  wherever snapshot reconciliation owns coverage, making late completion
  idempotent.

  Snapshot reconciliation cannot see a same-inode, same-length in-place
  rewrite whose nanosecond mtime is restored, because its
  `dev:ino:mode:size:mtimeNs` signature is unchanged. Timestamp-preserving
  deployment tools can create that shape; normal chokidar coverage misses it
  too, so this is a general watcher limitation rather than a recovery
  regression.

  Three seconds is deliberately a quiet-time heuristic, not proof that a scan
  is dead. A healthy scan blocked in one unusually slow filesystem operation
  can release the waiting request early; if inspection finds no culprit the
  server warns that live coverage may remain incomplete while chokidar finishes
  normally. Recovery never installs duplicate handles, and all timer-driven
  filesystem operations tolerate deletion and permission changes.

## Client (`web/`)

Alpine.js component; no framework build. At `/`, it renders registered projects
with path, git summary, last-opened date, dimmed missing state, and grouped live
worktrees. At `/p/<name>/`, state is tree + flattened visible rows
(depth-annotated), selection via `location.hash` (`#/path`), a grouped project /
worktree dropdown in the header, and theme in `localStorage`.

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
oversized dirs). No socket/FIFO is included: the shared fixture stays portable
and therefore does not directly cover the stats-based special-file skip. Raw
chokidar reached `ready` without error with a pre-existing FIFO under both Bun
1.3.14 and Node 26.6.0 (defaults, `ignoreInitial`, `followSymlinks:false`, and
both options); a standalone server probe separately confirms peruse filters
the FIFO and serves the tree normally. The contrary premise recorded in issue
#20 did not reproduce in this verification matrix.
Regression assertions are tagged with the commit that fixed the incident
they guard.

- `bun run test` → **unit** (`test/unit/`: project registry/pruning/worktree
  discovery, enumeration cache (TTL, registry-key invalidation, interleaved
  pending coalescing, immutable overlays, target incarnation checks),
  parseHunks, withContext, safePath, buildTree, gitStatus porcelain-v2
  parsing, web/lib.js helpers, rendered HTML sanitization and compatibility) +
  **integration** (`test/integration/`: real server + real git over HTTP —
  encoded multi-root routes, landing data, tree/file/raw contracts, enumeration
  and total Git spawns for a realistic navigation counted through patched
  `Bun.spawn`, cached target identity/missing state, SSE coalescing and gitignore-skip,
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
`noImplicitAny`). The root `tsconfig.json` covers all JavaScript in `bin/` and
`server/` (including the registry/worktree module) with Bun
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

No CI is wired up; the suite runs locally (`bun run test`, `bun run test:e2e`).
CI automation is tracked in issue #1.

Known watcher limitation: on a server that never entered recovery, a
scan-breaking link created directly inside an already-watched directory may
still be missed (chokidar's re-listing dies before emitting it). Once recovery
is active, newly moved/created directories observed by a fallback are checked
recursively; this does not claim to turn chokidar's normal post-ready scans
into a fully supervised scanner.

## Layout invariants

The app never scrolls at the body level: `min-height: 0` on every
grid/flex child in the scroll chain keeps scrolling inside `#tree` and
`#viewer-scroll`, so the app header, pane header, and pinned section
headings always stay put.
