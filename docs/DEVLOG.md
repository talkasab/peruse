# Dev log

Narrative record of work sessions — what changed, what we learned, and why.
Newest first. (The [CHANGELOG](../CHANGELOG.md) is the user-facing summary;
this is the engineering story.)

## 2026-08-02 — A "flaky test" that was an application race (#26)

- The E2E suite sat at 2 pass / 5 fail. It failed identically on the untouched
  `dev` baseline, so it was filed as pre-existing harness flakiness caused by
  the shared page and hash-only navigation. That diagnosis was wrong.
- Running the journeys individually was what broke it open: six of seven passed
  alone, and the seventh (markdown review) failed only intermittently — 2 of 3
  isolated runs, then 2 of 8 in a tight loop. A single comparison run had made
  it look like our own change had caused it; repetition showed otherwise.
- Instrumenting the page found the click always reached the handler, and the
  failures correlated with 3-5 re-renders arriving right after it. The cause:
  `selectFile` awaits a fetch and two frames before writing `location.hash`.
  An SSE silent refresh carries the path loaded when it fired, so one landing
  during a navigation re-rendered the file the user had just left and wrote
  that path back to the hash. The click was not lost; it was undone.
- Fix: a real navigation records `wanted` and takes a `nav` token; a silent
  refresh drops out if `wanted` has moved on, and never writes `location.hash`.
  A first attempt guarded only against *stale* calls and did nothing, because
  the refresh is the *newer* call — the guard had to be asymmetric.
- Result: 0/8 in the loop that reproduced it, then seven consecutive clean
  suite runs (9 pass). `navigation.test.js` drives the race deterministically
  via `Alpine.$data` and fails without the fix.
- Lesson: "fails the same on baseline" proves it is not a regression; it does
  not prove the tests are at fault. Also, the first version of the new test
  reused the heavy shared fixture and destabilized the suite through resource
  contention — self-contained means lightweight too.

## 2026-08-02 — Rendered Markdown sanitization (#23)

- Added DOMPurify at every file-derived rich HTML insertion boundary:
  markdown-it output (including raw HTML and highlighted fences), Shiki code
  output, and diff2html popup bodies. The remaining `innerHTML` uses either
  clear content or construct static cards whose displayed text is escaped and
  whose file paths are URL-encoded.
- The default DOMPurify HTML policy already preserves the README vocabulary we
  need: details/summary, keyboard/subscript/superscript markup, sized and
  aligned images, badges, picture/source variants, named anchors, HTML tables,
  disabled task-list checkboxes, heading and footnote IDs/fragment links, and
  Shiki classes/inline dual-theme styles. The only peruse-specific policy is a
  sanitizer hook removing Alpine directives (`x-*`, `@*`, and `:*`), because
  Alpine mutation-observes inserted DOM and could otherwise evaluate them.
- Tests render hostile Markdown containing image and SVG handlers, scripts,
  blocked embed elements, active URLs, and Alpine directives, then inspect the
  sanitized DOM. A positive fixture uses the real markdown-it plugins and the
  real Shiki dual-theme highlighter and must survive sanitization unchanged.
  The test also confirms markdown-it itself still rejects `javascript:` link
  destinations before sanitization.
- Added a self-contained Chromium regression using a private temp fixture,
  server, browser page, and real initial navigation. It proves the image handler
  and Alpine directive do not execute, `/raw/secret.env` is not captured, live
  active attributes are absent, and details/summary, kbd/sub/sup, tables,
  disabled task inputs, and Shiki-styled tokens all remain. Temporarily bypassing
  only Markdown sanitization made this test fail immediately on the executed
  image handler; restoring the backed-up source byte-for-byte made it pass.
- Chromium was available through the established `PERUSE_CHROMIUM` path even
  though Playwright's registry fallback did not find its expected executable.
  A CSP remains deliberately unshipped: a candidate would still require
  `unsafe-eval` for Alpine, inline styles for Shiki, external image allowances
  for badges, and same-origin connections for SSE, and this test-only follow-up
  did not expand #23 into an HTTP policy change.
- The existing core E2E harness shares one page across journeys and races
  hash-only navigation against Alpine state updates. The identical 2-pass /
  5-fail result on the untouched `dev` baseline and a clean five-navigation
  browser probe separate that harness behavior from #23 and from browser
  crashes. Filed #26 with the observed first timeout and isolation/synchronizing
  directions; no harness behavior was changed here.

## 2026-07-29 — v1 on main, `dev` opened, adversarial review triaged

- **Branching**: the 32-commit `claude/design-doc-clarification-x5d8ia`
  branch (all of v1, the test suite, every hardening pass) fast-forwarded
  onto `main` and the branch retired; `dev` opened from `main` as the
  integration branch, feature work branches from there. Note this makes
  #15's "base branch = `dev` if it exists, else `main`" rule resolve to
  `dev` the moment that issue is implemented. Suite verified green before
  landing (54 unit+integration, 7 E2E).
- **`PERUSE_CHROMIUM` is effectively required on this machine**: the repo's
  `playwright-core` pins Chromium build 1228 and the local cache holds
  1229/1232, so a bare `bun run test:e2e` prints Playwright's "just
  installed, run `npx playwright install`" banner even though six usable
  builds are already present. Point the env var at a cached build instead
  of downloading.
- **An independent adversarial review was triaged finding by finding.**
  The single most useful thing learned: *the review was run against a stale
  checkout* — it asserted "`bun test` reports no tests found" and that
  package.json had no test scripts, both false since 42b78c6. Its line
  references sat ~10 lines off current files. Every remaining finding was
  therefore re-verified at HEAD rather than accepted or dismissed wholesale.
  It also re-raised the symlink escape as an open P1, unaware of the
  2026-07-25 ruling.
- **Confirmed at HEAD** (943ab48): Markdown `html: true` + `innerHTML`
  executes inline handlers — demonstrated end to end in Chromium, where a
  README's `onerror` read a *different* file through `/api/file` and had
  its contents ready to send anywhere; no `Host` validation (`Host:
  evil.example.com` → 200); deleted files parsed correctly by `gitStatus`
  then dropped by `buildTree`; one-change-per-block Markdown mapping; `git
  status` without `--no-optional-locks`; `/raw/%ZZ` serving Bun's debug
  page; `decodeURIComponent` throwing on a literal `%` in a filename.
- **Owner ruling — Markdown sanitization (#23)**: fix it, but removing HTML
  support is not an acceptable fix. Sanitizing costs nothing real (GitHub
  has always allowlist-sanitized Markdown HTML; `<details>`, sized images,
  `<picture>` dark-mode sources and badges all survive). peruse-specific
  wrinkle recorded there: Alpine directives (`x-*`, `@*`, `:*`) must also
  be stripped, since Alpine mutation-observes the DOM and generic
  sanitizers won't know to remove them.
- **Owner ruling — compiled binaries dropped with prejudice** as a YAGNI
  violation. Measured 61 MB per binary (Bun embeds its runtime), so five
  platforms ≈ 300 MB of assets per release, aimed at an audience that
  already has Bun. `bunx @talkasab/peruse` needs no install. Struck from
  CLAUDE.md, README, and RELEASING.md; #2 rescoped to npm-only. The latent
  defect went with it: compiled binaries never embedded the client, so `/`
  returned `500 no built client found` while the API worked fine.
- **Provenance lesson.** That five-platform spec was never a product
  decision — an agent elaborated it from a research document into
  RELEASING.md and issue #2, where it acquired the authority of written
  scope. This is the second instance of the pattern after the CI workflow
  removed on 07-25 for shipping unauthorized. Repo-documented scope is not
  automatically an owner decision; check `git log --diff-filter=A` and
  issue creation timestamps before treating it as one (#1–#12 were filed
  programmatically in 51 seconds).
- Issue housekeeping: #11 rewritten (its premise — that deleted files
  appear with a placeholder — was false; they are absent entirely), #24
  filed for the Markdown multi-change collapse, #14 closed as fixed by
  1bb8cb2, #23 filed, #2 rescoped.

## 2026-07-25 (later) — Symlink policy decided

- Owner ruling on the review's symlink-escape finding: **follow symlinks,
  including out of the served root** — appropriate for a personal
  read-only viewer; the network-mode exposure is now documented in the
  README caveat, characterized by three integration tests (in-root link
  serves, out-of-root link serves, symlink entries absent from the tree),
  and opt-in confinement for `--host 0.0.0.0` is filed as issue #21.
- Owner ruling on the `.git` case-sensitivity finding: **won't fix** (the
  finding applies only to case-insensitive volumes and was code-reading
  inference, never demonstrated live).

## 2026-07-25 — Review-driven test hardening (58 tests)

An independent review of the suite (commit 42b78c6) found 7/10 injected
mutants killed and a cluster of dead/vacuous assertions; worked through its
priority list end to end.

- Dead assertions made real: the `/raw` traversal test used a literal
  `../../etc/passwd`, which `fetch`'s own URL parser collapses to
  `/etc/passwd` *before* the request leaves the client — never reaching
  `safePath` at all. Percent-encoding the slashes too (`%2f`) keeps `..`
  inside an opaque path segment the URL parser won't normalize, so it now
  verifiably reaches the guard. Same pattern for `dirty`/`ignored`
  negatives (added a committed-and-untouched `cleandir` fixture — `bigdir`
  looked clean but is actually untracked, so `dirty: true`), the
  `safePath` leading-slash test (was slicing the slash off in the test
  itself), and the "Next/Previous change" arrow test (asserted popup
  *presence* twice, which can't fail — now asserts the popup's hunk index
  actually changes).
- SSE test hardening: frame reads now buffer until a newline instead of
  `JSON.parse`-ing a possibly chunk-split line; the gitignored-dir negative
  test gained a positive control (a sibling file that must still fire) so
  it can't pass by having simply missed everything; `nextEvent`'s deadline
  is now computed after `act()` runs, not before.
- Product fixes (the three sanctioned by review): `startServer` now closes
  the watcher and ping timer before rethrowing on a failed bind (was
  leaking both when a pinned `--port` was busy); it returns a `ready`
  promise that resolves on chokidar's initial-scan-complete (or
  immediately if watching is disabled), so tests await a real signal
  instead of a guessed sleep; a new `watchBudget` option takes precedence
  over `PERUSE_WATCH_BUDGET`, so the fixture no longer mutates
  `process.env` around an `await` (was a latent race).
- New unit coverage: `buildTree` (dirs-first sort, dirty propagation
  through nested clean dirs, ignored-dir walk skip, the 500-cap row) and
  `gitStatus`'s porcelain-v2 parsing (staged rename incl. the `-z`
  origPath field skip, repo-prefix slicing for a served subdirectory,
  unborn-HEAD empty-tree base) — both were previously exercised only
  incidentally through the HTTP-level integration tests.
- Attempted, reverted: adding a FIFO to the fixture (to exercise the
  watcher's `!isFile && !isDirectory` skip) hangs chokidar's initial scan
  indefinitely under Bun on Linux — reproduced in isolation
  (`chokidar.watch()` never fires `ready` on a directory containing one).
  Since fixing that would mean changing watcher behavior beyond the three
  sanctioned product fixes, the fixture stays without socket/FIFO coverage
  and the docs say so plainly instead of overclaiming it.
- E2E: the `pageerror` listener used to `throw`, which doesn't fail a test
  (listeners aren't on the test's call stack) — now collects into an array
  asserted empty in `afterEach`. The pinned-header scroll test used a
  magic `scrollTop = 5000`; now derives the target from the last
  section's real `offsetTop`. Added a theming journey (toggle Latte/Mocha,
  assert a Shiki token's and an open popup's computed colors both flip) —
  its first version was flaky for a subtle reason: `page.goto()` to the
  *same* URL/hash as the previous test is a no-op (no real reload), so a
  popup left open by the prior test survived into this one and the test's
  own click toggled it *closed* instead of open. Fixed with an explicit
  `Escape` before asserting a known starting state.
- Verification: `bun test test/unit test/integration` green across 4
  consecutive runs (~14 s each, dominated by the guarded 11.5 s idle-SSE
  test); `bun run build && bun test test/e2e` green across 2 runs (~3 s
  each). Mutation spot-check on a throwaway `/tmp` copy: all three
  previously-surviving mutants (`/raw` guard removed, `buildTree` dirty
  always true, `buildTree` ignored always true) are now killed.

## 2026-07-21 (night) — Rendering pill pins to viewport (#14)

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

## 2026-07-21 (evening) — Test suite

- Landed the three-tier suite (45 tests as landed; 58 after the 2026-07-25
  hardening pass): unit for owned logic (hunk
  parsing, context-header arithmetic, path guards, render helpers, after
  extracting `web/lib.js` so tests skip the Shiki boot), integration as
  the center of gravity (real server + git over HTTP; SSE coalescing,
  gitignore-skip, 11 s idle survival, port fallback, tiny-budget
  survival), and four core Chromium journeys carrying the session's
  incident regressions (rail single-x, innermost marks, popup scope,
  pinned-header singleton, no body scroll). `startServer` gained a
  `stop()` handle for tests. CI workflow added (closes #1).
- Mutation-tested the suite and it earned its keep twice: a wrong
  assertion (context lines legitimately include neighbor text) and a
  masked mutation that led to a real discovery — chokidar silently drops
  the watch on any directory containing a *dangling symlink*, no error
  event (#17). Fixture now quarantines symlinks in `linkfarm/` so the
  dead zone can't mask watcher assertions.

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
