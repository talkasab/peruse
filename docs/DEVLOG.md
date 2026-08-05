# Dev log

Narrative record of work sessions — what changed, what we learned, and why.
Newest first. (The [CHANGELOG](../CHANGELOG.md) is the user-facing summary;
this is the engineering story.)

## 2026-08-05 (later) — The watcher dead zone was worse, and different, than filed (#17)

Readiness-settlement addendum, 2026-08-05:

- Runtime teardown cleared the stall timer and watcher handles but left a
  pending `ready` promise unresolved. If another operation invalidated a
  runtime during its stalled initial scan, the request already awaiting that
  runtime could therefore wait forever.
- `close()` now rejects pending readiness with a typed closure signal instead
  of fulfilling it: fulfillment would make a closed runtime indistinguishable
  from a ready one. A permanent no-op rejection observer covers teardown with
  zero waiters, while request resolution catches only the closure signal and
  also checks for a close immediately after successful readiness.
- The isolated ENOTDIR regression removes the project 300 ms into the stalled
  scan and reconciles the runtime through the project listing. Before the fix,
  the waiting request exceeded its independent 1 s deadline; after the fix it
  returned HTTP 404 in 4.94 ms, with no `unhandledRejection` event.
- Final gates: `bun run check` checked 31 files; unit/integration passed 80/80
  (219 assertions); the separately invoked browser suites passed 11/11 (54
  assertions). One initial browser run reported shared-page errors in the code
  review journey; the prescribed command passed unchanged on rerun.

Adversarial follow-up, 2026-08-05:

- The first fallback trusted `fs.watch`'s optional filename. A measured
  write-temp-then-rename save consequently reported only `.target.tmp`, not the
  replaced `target.txt`. Recovery now treats every platform event as a hint,
  diffs guarded `lstat` snapshots, and emits the paths whose identities or
  metadata actually changed. A vanished/unreadable directory simply loses its
  fallback instead of throwing from a timer.
- Recovery is repeatable for directories introduced beneath recovered
  coverage: each new directory gets a bounded scan-breaking-link check before
  chokidar owns it. A pre-populated ENOTDIR-poisoned directory moved into the
  fixture now reports subsequent edits. Discovery and fallback handles share
  the normal ignore/admission budget; the budget-1 probe admitted one root
  candidate and skipped 120 rejected poisoned subtrees instead of opening 121
  unbudgeted handles.
- The heartbeat is a three-second quiet-time heuristic, not a proof of death.
  A slow-but-live filesystem operation can release the first request early;
  recovery is idempotent, snapshot-owned paths suppress overlapping chokidar
  events, and a late `ready` is harmless, but coverage can be incomplete until
  that healthy scan finishes. This corrects the earlier “never mistaken” and
  “live updates throughout” wording.
- FIFO correction: the earlier raw-chokidar claim was false in the verified
  environment. With a FIFO present before `watch()`, Bun 1.3.14 reached
  `ready` in 3.1–4.0 ms and Node 26.6.0 in 3.3–6.2 ms, without errors, under
  defaults, `ignoreInitial`, `followSymlinks:false`, and both options. The true
  production half remains: peruse's stats filter excludes the FIFO and the
  server returned HTTP 200 for `/api/tree`. This eight-run matrix disproved the
  raw/peruse contrast that the earlier single probe and issue #20 recorded.
- Snapshot reconciliation compares `dev:ino:mode:size:mtimeNs`. An in-place
  equal-length rewrite that restores the original nanosecond mtime is therefore
  invisible. Raw chokidar and healthy peruse coverage miss the same
  timestamp-preserving deployment shape, so it is a general watcher caveat,
  not a fallback regression.
- Final gates: `bun run check` passed; unit/integration passed 79/79 (213
  assertions); the separately invoked browser suites passed 11/11 (54
  assertions).

- The bug report said "a dangling symlink silently unwatches its directory."
  Reproduction says otherwise: a plain dangling link (ENOENT) is harmless —
  seven variants (relative, absolute, nested, loop, created after ready,
  followSymlinks both ways, polling) all watched normally, and so did the real
  fixture through the real server. Reproducing before theorizing paid off
  again; the filed cause was a near miss.
- Reading readdirp's source found the real rule. Its `_getEntryType` calls
  `realpath()` on every symlink and treats only ENOENT/EPERM/EACCES/ELOOP as
  survivable; any other errno calls `destroy()` on the directory's stream, and
  chokidar's error handler then swallows ENOENT/ENOTDIR without emitting
  `error`. The wild case is **ENOTDIR** — a link whose target path runs through
  a regular file. The ignore callback cannot defend against it: readdirp
  resolves the link *before* any filter is consulted.
- **Identical under Node v26 and Bun 1.3.14** — upstream chokidar/readdirp, not
  a Bun quirk. Worth filing there.
- The impact was much worse than "lost SSE freshness". The destroyed listing is
  also what decrements chokidar's ready count, so `ready` never fires — and
  `resolveProject` awaits it on the first request. A single such link means the
  project **serves nothing at all**; `/api/tree` hangs forever. Verified
  end-to-end, and it belongs on the short list of candidate explanations for
  the still-unexplained "serves nothing" hang of 2026-07-21.
- Fix: treat the scan as dead when it goes quiet. Every path already passes
  through the ignore callback, so that became the scan's heartbeat — 3 s of
  silence with `ready` still pending triggers recovery inspection. Recovery walks for the
  culprits, names them, covers each stranded directory with a plain `fs.watch`,
  and hands its subdirectories back to chokidar. Measured on the recovered
  directory: changes, new files, deletions, pre-existing subdirectories, and
  subdirectories created afterwards (those need the explicit re-add — `fs.watch`
  is not recursive) all report in the original fixture; nothing spurious fires at recovery time,
  because `ignoreInitial` still holds while `ready` is pending.
- Rejected alternatives, each disproved by experiment: a polling watcher on the
  stranded dir (readdirp destroys the stream there too — polling changes the
  backend, not the listing), filtering the link via `ignored` (runs too late),
  and a mandatory startup pre-scan (a second full walk on every start, to pay
  for a rare pathology; the stall signal is free).
- Residual gap: unless recovery is already active, a scan-breaking link
  introduced directly into an existing watched directory may not itself be
  announced. A stall from any other cause degrades to a warning plus a running
  server instead of a hang.
- Also checked: a FIFO in the tree does *not* hang peruse; the ignore
  callback's stats check filters it. Later verification also found raw
  chokidar itself reaches `ready` with that FIFO in the current Bun/Node
  environment, correcting the initial contrast. The fixture's claim that
  dangling links strand their directory was corrected.

## 2026-08-05 — Multi-root code-review hardening

- Registered roots that still exist as non-directories were reaching Git as a
  working directory and throwing `ENOTDIR`, which could prevent enumeration of
  every healthy project. Git-facing discovery and summaries now require a
  directory and report other filesystem entries as missing; the same check is
  used for discovered worktree targets.
- `peruse rm` now treats an exact registered name as the selector mode and only
  falls back to path matching when no name matches. Path selectors use the same
  realpath canonicalization as registration, so the symlink spelling used to
  add a project also removes its canonical registry entry.
- Three focused unit regressions failed with the reported `ENOTDIR`, 2-vs-1
  removal, and 0-vs-1 symlink-removal results before the fix, then passed after
  it. `bun run check` passed. The repository's isolated `test:e2e` pipeline
  passed all 11 browser tests; two exact all-in-one `bun test` runs passed every
  unit/integration test but each hit the already documented Bun/Playwright
  combined-process stall in a different browser test (75/78, then 77/78).

## 2026-08-05 — Auto-open removed entirely (owner decision)

- Yesterday's opener fix stopped a missing `xdg-open` from killing the server,
  but the owner's reaction to the resulting warning reframed the question:
  peruse's home use case is *remote* — SSH into the machine with the files,
  click the printed URL in a local browser. A browser opened on the server
  host would be useless even where it's possible. v1's auto-open (and
  `--no-open`) assumed a local-viewer model that doesn't match how the tool
  is actually used, and nothing has shipped, so both are gone rather than
  deprecated: the CLI prints URLs, full stop.
- With no opener code path, the empty-`PATH` CLI regression lost its subject
  and was removed with it.

## 2026-08-04 — E2E destabilization hunt: one real bug, one Bun bug

After #3 landed in the working tree, the previously rock-solid e2e suite began
failing most full runs with 30-second Playwright timeouts (`goto`, clicks
"not stable", `waitForFunction` never satisfied) that moved between tests on
every run, while every failing test passed in isolation. A control run of the
pre-#3 tree in the same environment was 4/4 green, so the change — not the
machine — was implicated. Instrumenting the server (request ledger), the
client (init-milestone console probes), and the tests (console/pageerror
forwarding) repeatedly showed the same paradox: server ledger complete in
milliseconds, page console proving init finished — and Playwright blind to
all of it.

Two genuine causes fell out, plus a graveyard of falsified theories:

- **Real regression #1 (product): peruse's git polling wrote `.git/index`.**
  `git status` opportunistically refreshes the index; the watcher forwarded
  that write as a git-change event; clients responded by re-fetching the tree
  and open file — whose handlers run `git status` again. Measured 3–5
  self-inflicted git-change SSE messages per page load; one landed mid-test
  and detached the element under Playwright's cursor (`boundingBox()` null).
  Multi-root amplified it (`gitSummary` per project per `/api/projects`), but
  the write predates #3. Fixed with `--no-optional-locks` on every git
  invocation — which is also what the read-only contract always demanded.
  Self-inflicted messages measured zero afterward.
- **Real trigger #2 (harness): Bun's Playwright pipe transport stalls.**
  The dominant failure was CDP messages sitting unread while page and server
  stayed healthy — same family as oven-sh/bun#27977. `connectOverCDP` over a
  websocket is not an escape hatch (Playwright's ws client never connects
  under Bun, oven-sh/bun#9911), and once wedged a fresh *page* does not
  recover — the stall is connection-scoped (a 3-attempt fresh-page retry
  still timed out). What the suite's shape controls is exposure: the landing
  test's extra SSE-less hop in core's shared tab (~1 in 3 core-only failures;
  10/10 green without it, twice over) and the standalone switcher file's
  fourth per-process browser lifecycle (pre-#3 the suite ran three) were the
  two reliable tickles. Merging the switcher test into core (own page,
  shared browser) traded the stall for instant `net::ERR_EMPTY_RESPONSE`
  from the *fixture* server once a second `Bun.serve` had started in the
  process — a different Bun soft spot, so that shape was abandoned. Final
  arrangement, 8/8 full `test:e2e` runs green: the landing test drives its
  own page; the switcher file runs first in its own `bun test` process
  (never failed pristine; the `test:e2e` script encodes the split); core's
  `afterAll` bounds teardown with a race so a Bun-stalled `browser.close()`
  cannot fail an otherwise green run. Browser launching is centralized in
  `launchBrowser()` (fixture.js) where the caveat is documented.
- **Falsified along the way** (each by direct experiment): git-spawn churn
  starving the loop (cached enumeration to ~baseline spawn counts — still
  failed), lazy-watcher timing (eager runtimes at boot — still failed), a
  keepalive timer (25 ms interval — still failed), environment drift
  (baseline green), inotify exhaustion (21 instances of 1M). `DEBUG=
  pw:protocol` masked the bug entirely — 8/8 green — which is what finally
  pointed at loop-servicing rather than any of the above.
- Bare `bun test` (all suites in one process) still wedges occasionally under
  accumulated multi-file load and is not the supported pipeline; the
  documented gate remains `bun run test` + `bun run test:e2e` as separate
  processes, which is what CI-style validation should use.

## 2026-08-04 — Missing browser opener no longer kills the server

- A Linux host without `xdg-open` reproduced a sharp CLI failure: peruse bound
  successfully and printed its URL, then the optional browser-launch spawn
  threw `ENOENT` and terminated the whole process.
- Automatic opening is now best-effort. A synchronous platform-opener failure
  prints a short warning directing the user to the already printed URL while
  leaving the server alive; `--no-open` remains available for intentional
  headless use.
- A subprocess integration test drives the real CLI with an empty `PATH` and a
  temporary config directory. It failed before the fix with exit code 1 and
  now asserts the process remains alive after the serving line appears.

## 2026-08-03 — Multi-root project serving (#3)

- Replaced the single-root server URL model with a persistent registry at
  `~/.config/peruse/projects.json` and shareable `/p/<encoded-name>/` routes.
  `peruse <path>` still performs the familiar open-and-serve flow, but now
  canonicalizes and auto-registers the path; no arguments opens the new project
  landing page. Added `add`, `rm`, `list`, and explicit `prune` verbs.
- Missing paths are deliberately soft state: the landing API records a first
  `missingSince`, renders the entry dimmed, and automatic maintenance waits 30
  days of continuous absence. Explicit prune is immediate. Tests and embedders
  use an explicit config file or `PERUSE_CONFIG_DIR`, and every test registry is
  under a temporary directory.
- Worktrees are enumerated live from `git worktree list --porcelain`, grouped
  beneath their registered parent, and assigned transient route names without
  registry writes. Registered subdirectories map to the same relative
  subdirectory in linked worktrees rather than exposing the repository root.
- Server state is isolated per resolved project. Tree/file/raw/SSE endpoints
  are project-prefixed, ignored-path caches and SSE clients do not cross roots,
  and chokidar starts lazily on first project access. The landing page alone has
  no watcher cost.
- The Alpine client now has explicit landing and project modes, uses scoped API
  and raw URLs, and renders a grouped project/worktree dropdown on project
  pages. Existing shared E2E fixtures moved to project-prefixed bases; the two
  standalone regressions were likewise updated from the old root URL.
- New tests cover registry canonicalization/reopen/collision behavior,
  first-miss and aged pruning, immediate prune, porcelain parsing, real linked
  worktree discovery without registration, encoded project names, scoped
  routing, and landing missing/summary data.

## 2026-08-03 — Biome and full-strict JavaScript checking (#16)

- Added Biome 2.5.6 for formatting, recommended lint rules, and import
  organization, plus TypeScript 7.0.2 for `allowJs`/`checkJs` analysis with no
  emit. `bun run check` is the read-only combined gate; `bun run fix` applies
  formatting and safe fixes. Generated `dist/` output is excluded.
- Split type environments so the CLI/server see Bun globals while the bundled
  client sees only browser globals. Both configs run full `strict`, including
  `noImplicitAny`; the client declaration file stubs only the two markdown-it
  plugins without bundled types and declares `window.Alpine`.
- A follow-up trial brought `test/` under a mixed Bun+DOM config and immediately
  surfaced roughly 200 diagnostics across all 12 test files: fixture/helper
  parameters, Playwright evaluation globals and DOM assertions, test-only null
  assertions, and conflicting stream types from importing server and web code.
  That is a separate test-harness typing project, not a small config gap, so the
  scope is explicit: production JavaScript is full-strict; tests are Biome-only.
- Full strictness turned previously implicit server/client JSON contracts into
  JSDoc shapes for trees, files, hunks, git state, SSE events, and server start
  options. It also required safe narrowing of caught errors and DOM query
  results, made `watchBudget` correctly optional to callers, replaced boolean
  subtraction in the directory sort with numeric conversion, and tied hunk
  generation to non-null text content rather than relying on indirect binary
  narrowing.
- Biome identified five buttons without explicit `type="button"`; those are now
  safe if the header is ever embedded in a form. CSS ordering was corrected for
  the ignored-row selectors. Three `!important` declarations remain with
  reasoned inline ignores: Alpine cloaking and the two necessary overrides of
  Shiki-generated inline backgrounds.
- Biome's enforced initial formatting touched the repository JavaScript and CSS
  mechanically; a second writer run made no changes. The final gate passed,
  startup served both `/` and `/api/tree`, the build succeeded, and the complete
  suite passed 66 tests including Chromium.

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
- Attempted, reverted at the time: adding a FIFO to the fixture was reported
  to hang chokidar's initial scan under Bun on Linux. The 2026-08-05 issue #17
  follow-up disproved that result in an eight-run Bun/Node configuration
  matrix: every raw watcher reached `ready` without error. The fixture still
  omits sockets/FIFOs to remain filesystem-portable, not to avoid a reproduced
  hang; peruse's special-file filter is characterized by standalone probes.
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
