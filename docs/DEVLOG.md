# Dev log

Narrative record of work sessions — what changed, what we learned, and why.
Newest first. (The [CHANGELOG](../CHANGELOG.md) is the user-facing summary;
this is the engineering story.)

## 2026-07-21 (latest) — Rendering pill pins to viewport (#14)

- Bug: `.render-wait` was `position: absolute` inside `#viewer-scroll`, so
  it scrolled away with the content — scrolled-down users got no render
  feedback.
- Fix: `position: sticky; top: 14px` with `width: fit-content;
  margin-inline: auto` (sticky is in-flow, so the pill needs explicit
  shrink-wrapping to stay centered). Chosen over `position: fixed`, which
  needed a hardcoded `calc(50vw + 140px)` to clear the 280 px tree column
  and overlapped the app header; sticky anchors to the pane naturally and
  survives layout changes.
- Verified in Chromium by measuring, not eyeballing: scrolled 2000 px deep
  with a throttled `/api/file` (2 s route delay to hold the loading state),
  pill measured at viewport top 91, centered at pane center x=780; same
  position at scroll 0.

## 2026-07-21 (later) — "Serves nothing" investigation

User-reported total hang on their repo. Investigation notes:
- A pristine clone of the tip verified green end-to-end; `git diff` proved
  the server code was identical to the last version confirmed working on
  the user's machine → environmental, not a regression.
- First theory (git stderr piped-but-unread filling the 64 KB pipe) was
  **disproved by experiment**: Bun drains unread pipes internally. Worth
  remembering: test the deadlock story before shipping it.
- Shipped bounded git subprocesses (30 s kill, stderr ignored) + slow-phase
  logging for `/api/tree`; the hang cleared and the instrumentation
  surfaced the real residual bug: **Bun.serve's default 10 s `idleTimeout`**
  had been killing every idle SSE connection (30 s pings never arrived in
  time) and could axe slow first responses. `idleTimeout: 0`; verified an
  SSE connection now outlives 10 s idle.
- Follow-up experiment (challenged on certainty): the default idleTimeout
  also kills *pending-handler* requests at 10 s with that same log line —
  so it cannot explain the original indefinite hang, and the earlier
  speculation linking them is retracted. The original hang remains
  unexplained but is now bounded (30 s git cap) and instrumented
  (slow-phase logs), so any recurrence self-identifies. Note: with the
  idle timeout off, dead SSE sockets are reaped by the 30 s ping erroring
  out — the ping loop is now the reaper.

## 2026-07-21 — Markdown rendering hardening; docs reorganization

- Change marks moved to a **fixed overlay rail**: JS-measured absolute bars
  in a gutter column left of all content, one x at any nesting depth,
  re-laid via ResizeObserver. Replaced two failed approaches: per-block
  borders (specificity fights with heading margins/blockquote borders put
  bars off-rail) and inset bars on nested items (bar landed between bullet
  and text).
- Marking rule inverted from outermost to **innermost** intersecting block
  — a `<ul>`'s line range spans the whole list, so one edited bullet was
  painting a bar down every item.
- Sticky h1/h2 scoped by wrapping each section in a `<section>` — stacked
  stickies of different heights ghosted through each other.
- Found and fixed the root layout flaw: `min-height:auto` on grid/flex
  children let the pane grow past the viewport, silently moving scrolling
  to the body (headers scrolled away; sticky never engaged).
- Docs reorganized: ARCHITECTURE.md (as-built), CHANGELOG.md
  (Keep a Changelog), this dev log, docs/RELEASING.md; DESIGN.md retired to
  docs/design-history.md; RESEARCH-v1.1.md dissolved into GitHub issues
  #1–#12.

## 2026-07-20 (evening) — First real-repo dogfooding: crashes, freezes, UI

Running against a real repo (`imaging-problem-list`) surfaced a cascade:

- **Crash**: Chrome's `SingletonSocket` (symlink → unix socket) blew up
  chokidar's scanner (`EOPNOTSUPP` from `realpath` on macOS). Fixed with
  `followSymlinks:false`, special-file skips, and a never-fatal error
  handler.
- **Hang** ("connects, never loads"): fd exhaustion. Learned empirically —
  under Bun each watched path holds fds (files too, ~2–3 each), stock macOS
  shells give 256, and chokidar doesn't reliably pass `stats` to the
  ignore callback (an early budget undercounted). Landed four layers: CLI
  `ulimit` re-exec, never watch gitignored dirs, fd-derived watch budget
  counting by first sight, and a no-watch fallback below ~1024 fds. Also:
  `pkill -f` matching the invoking shell's own cmdline produced misleading
  exit-144s during debugging.
- **Tree redesign** after review: explorer conventions (icons, indent
  guides, uniform rows), dirty-dir dots, dead chevrons removed from
  unexpandable ignored dirs, label-only dimming.
- **Marks philosophy** settled through review rounds: additions show marks
  but no popups; wholly-new files show nothing in-file; frontmatter became
  a card (with blank-line padding to keep `data-lines` honest);
  auto-rebuild of stale `dist/` after a pull burned us once.
- Rendering pill for the synchronous Shiki freeze (compositor-animated so
  it spins through the block); real fix (worker) filed as #8.

## 2026-07-20 (afternoon) — v1 implementation and interaction iteration

- v1 built and verified end-to-end in Chromium (~950 lines): CLI, server
  (tree/file/raw/events + git porcelain v2 + hunk parsing), client
  (Alpine tree, markdown-it with line maps, Shiki dual theme, diff2html
  popups, SSE).
- Change indication iterated under review: editor-convention colors (blue
  modified — yellow was the explorer-badge palette misapplied), exact
  changed lines from `-U0` (a `-U3` hunk merged everything into one bar),
  in-flow panels → anchored popups, popup scoped to only the clicked
  change, then 3 context lines spliced in server-side without re-merging
  neighbors.
- Networking: port auto-fallback, multi-URL printing for `0.0.0.0`
  (LAN/Tailscale), clean pinned-port errors.
- v1.1 research: npm trusted publishing, project picker, Herdr interview
  (topology, dispatch = copy-prompt + send-to-pane, open-in-Neovim, agent
  notes read-only via hunk's sidecar format), keyboard shortcut
  conventions. All since migrated to issues.

## 2026-07-20 (morning) — Design finalized

- DESIGN.md §8 open questions resolved (gitignored dimmed+toggle,
  worktree-vs-HEAD only, Mermaid/KaTeX deferred, non-git graceful).
- Repo scaffolding: README, license, gitignore.
