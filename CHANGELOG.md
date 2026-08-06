# Changelog

All notable changes to peruse are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project adheres to [Semantic Versioning](https://semver.org/).
Process: every user-facing change lands with an entry under
**[Unreleased]**; at release time the section is renamed to the version +
date and becomes the GitHub release notes (see
[docs/RELEASING.md](docs/RELEASING.md)).

## [Unreleased]

## [1.0.0] - 2026-08-06

### Fixed
- A broken symlink that points *through* a file (for example
  `dist/bundle.js/index.js`) no longer stops a project from loading. Such a
  link silently aborted the file watcher's startup scan, and because the first
  page load waits for that scan, the project hung instead of serving. peruse
  now detects the stalled scan, names the offending link on the console, and
  keeps admitted files live through atomic saves and later poisoned
  subdirectories (#17)
- Pages no longer run a git process per request per registered project — with
  several projects registered, a page with many images could start hundreds of
  them and load slowly. Newly created worktrees still appear in the landing page
  and switcher within a couple of seconds; deleted or replaced project roots are
  no longer served from that brief cache window (#28)
- Live views now disconnect and retry when their project is removed, replaced,
  or reassigned to another worktree route instead of remaining silently stuck
  on the obsolete watcher (#28)
- Registered project roots replaced by files no longer break the project list,
  and `peruse rm` now removes exactly one name-or-canonical-path selection,
  including projects registered through symlinks
- peruse's own git status polling no longer writes to `.git/index`
  (`--no-optional-locks`), which had made the live view re-render spuriously
  right after opening a page — peruse now never writes inside a served
  directory, `.git` included
- Opening a file no longer snaps back to the previous file when a live update
  arrives at the same moment (#26)
- Rendered Markdown now removes executable HTML and Alpine directives while
  preserving supported README HTML, task lists, anchors, and highlighted code
  (#23)
- "Rendering …" pill now pins to the top of the viewport while scrolled
  (previously it sat at the top of the page content and was invisible when
  scrolled down) (#14)

### Added
- mdsvex `.svx` files are syntax highlighted instead of shown as plain text.
  YAML/TOML frontmatter, Markdown prose and autolinks, Svelte tags, directives
  and `{expression}` blocks, `<script>` (JavaScript and TypeScript), `<style>`
  (CSS, SCSS, and PostCSS), and fenced code are coloured distinctly in both
  themes; other style languages remain plain within their style block. `.svx`
  stays a code view; files over 3,500 logical lines use the plain-source
  fallback regardless of a terminal newline, and nothing is compiled (#18)
- Word-wrap toggle for the file view: a `Wrap` / `No wrap` chip in the pane
  header soft-wraps long lines instead of scrolling them horizontally, with
  continuation rows and change marks aligned across the full wrapped line.
  Toggling retains visible logical content: it preserves the end gap when the
  final line or Markdown block is visible and otherwise keeps the top visible
  line or block anchored. This includes files that gain a scrollbar when
  wrapped and viewport-tall Markdown fences. The chip appears only for
  nonempty code/raw views and rendered Markdown containing a code fence. Off
  by default and remembered across sessions (#25)
- Multi-project serving with an auto-maintained project registry, `add`, `rm`,
  `list`, and `prune` CLI commands, a project landing page, shareable
  `/p/<name>/` URLs, live grouped Git worktrees, a header project switcher, and
  project-scoped lazy file watching (#3)
- v1 of peruse: two-column directory browser (tree + rendered file) served
  by a ~5-route Bun server; GFM markdown (markdown-it) and code (Shiki,
  Catppuccin dual-theme) rendering; git status in the tree with a
  changed-only filter; live updates over SSE via a chokidar watcher;
  Latte/Mocha theming with a persisted toggle; localhost-only by default
- Per-change gutter marks (blue modified / green added / red deletion
  wedge) on exactly the changed lines; markdown change marks on a fixed
  rail left of all content, marking the innermost changed block
- Click a mark → that change's diff in an anchored popup (unified/split),
  with 3 context lines and neighboring changes never merged in; `‹ N
  changes ›` header navigation; pure additions and wholly-new files show
  marks/badges only, no popups
- YAML frontmatter rendered as a key/value card; h1/h2 headings pin to the
  pane top while their section scrolls; "rendering …" pill during heavy
  highlights
- Directory tree per VS Code explorer conventions: icons, indent guides,
  rotating chevrons, dirty-dir dots, muted gitignored entries with a hide
  toggle
- CLI: port auto-fallback (pinned `--port` fails loudly), `--host 0.0.0.0`
  prints every reachable URL (LAN/Tailscale), fd-limit auto-raise
- Resilience: symlink/socket-proof watcher, gitignored dirs never watched,
  fd-derived watch budget (`PERUSE_WATCH_BUDGET`), no-watch fallback under
  hard fd caps, 500-entry per-directory tree cap, automatic client rebuild
  when running from a checkout with stale `dist/`, git subprocesses bounded
  at 30 s with slow-phase logging, SSE connections exempt from Bun's 10 s
  idle timeout; a failed startup (e.g. a pinned port already in use) now
  closes the watcher and ping timer instead of leaking them
- Test suite: unit (diff parsing, context arithmetic, path guards, render
  helpers), integration (server + git + SSE contracts over HTTP), and core
  Playwright E2E journeys, with regression tests tagged to past incidents

[Unreleased]: https://github.com/talkasab/peruse/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/talkasab/peruse/releases/tag/v1.0.0
