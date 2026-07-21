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
Alpine.js, @catppuccin/palette) are devDependencies bundled into `dist/`.

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
  `PERUSE_WATCH_BUDGET` overrides.
- Below ~1024 fds even the initial scan can starve the process: watching
  is disabled entirely with a clear message instead.

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
- **Feedback**: selecting a file shows a floating "rendering …" pill; its
  spinner is transform-animated so the compositor keeps it moving while
  Shiki blocks the main thread. Shown for silent refreshes only >300 KB.
- **Binary/images**: images render via `/raw/`; other binaries show a
  metadata card with a download link.

## Theming

`@catppuccin/palette` CSS variables; semantic vars mapped per
`data-theme` (latte/mocha) on `<html>`; Shiki dual-theme variables and
diff2html `--d2h-*` overrides key off the same attribute — one attribute
flip restyles everything.

## Layout invariants

The app never scrolls at the body level: `min-height: 0` on every
grid/flex child in the scroll chain keeps scrolling inside `#tree` and
`#viewer-scroll`, so the app header, pane header, and pinned section
headings always stay put.
