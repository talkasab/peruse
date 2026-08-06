# Dev log

Narrative record of work sessions — what changed, what we learned, and why.
Newest first. (The [CHANGELOG](../CHANGELOG.md) is the user-facing summary;
this is the engineering story.)

## 2026-08-06 — Local branch state in the viewer header (#15)

- The primary Chromium regression created `feature/branch-state` one commit
  ahead of local `main` and failed twice on released code because no branch
  indicator existed. The completed journey measures exact text through live
  transitions: `feature/branch-state · 1 ahead` → `main` → detached `@ <short
  oid>` → the feature branch again → `feature/branch-state · 2 ahead` after a
  new commit.
- Git identity now comes from the existing porcelain-v2 status call's stable
  branch headers. Base discovery considers local `dev`, `main`, then `master`,
  and a differing branch uses the required local-only `rev-list --left-right
  --count base...HEAD`. No upstream, fetch, or network state participates.
- The work is attached to the existing tree/status cadence rather than a new
  endpoint or client poll. `.git` metadata already passes the watcher except
  objects, so ordinary repositories update after the ~200 ms SSE coalescing
  window plus local Git/tree work. Linked-worktree administrative state lives
  outside the served root; there, navigation/reconnect or the next worktree
  event/status refresh is the honest fallback, so metadata-only changes can
  remain until that refresh.
- Spawn accounting stayed flat for the common selected-base case: replacing
  `rev-parse --verify HEAD` with status branch headers makes room for local base
  discovery (four Git processes per status poll, as before). A differing branch
  adds only `rev-list` for five total; detached HEAD needs three. The realistic
  cached/uncached navigation measurements remain 54/134 total Git spawns.
- Placement groups the subdued monospace branch badge with project identity,
  before the header spacer, instead of crowding changed-only. Chromium measured
  a 225.5 px separation from controls at 1,280 px; at 760 px the root label
  hides, the long branch truncates, controls retain an 85.7 px gap, and body
  width remains exactly the 760 px viewport. The layout detector returned no
  findings.
- The branch-state Chromium journey runs in its own Bun process, matching the
  existing project-switcher isolation. Combining it with the core Playwright
  process made the branch test pass but subsequently stalled the shared
  fixture's navigations; isolation preserved the established Bun/Chromium pipe
  boundary and the complete command then passed.
- Final verification: `bun run check` checked 39 files and both TypeScript
  projects; `bun run test` passed 147 tests with 433 assertions; `bun run
  test:e2e` passed 36 Chromium tests with 385 assertions across the isolated
  1-test project-switcher, 1-test branch-state, and 34-test main invocations.

### 2026-08-06 addendum — narrow-header review fix

- Independent review found the long branch badge collapsed to chrome-only width
  at 400 px while worsening header overflow. The focused regression was red at
  that exact seam: a 400 px viewport produced a 407 px document in this run
  (the reviewer measured 433 px with its route/control state).
- The badge now has a 112 px CSS floor—enough for a recognizable monospace
  branch prefix after its 16 px horizontal chrome—and truncates with the full
  label bound to both `title` and `aria-label`. At 440 px and below it yields
  entirely; the header simultaneously tightens gaps/padding, hides the brand,
  and lets the project selector shrink rather than displacing functional
  controls.
- The 645 px-content label measured 360, 228, and 122.3 px at 1280, 760, and
  500 px; every visible state ellipsized with exact hover/accessibility text.
  At 400 and 320 px the badge measured zero and hid cleanly. Document widths
  matched all five viewports exactly, with the theme control remaining inside
  the edge.
- Added direct server oracles for a behind-only branch and a Unicode branch.
  The E2E architecture inventory now records the actual five-file,
  three-process layout and the Bun/Playwright pipe-transport reason for the two
  isolated browser tests.
- The one permitted UI detector pass reported only the established 3 px
  change-mark and blockquote side accents, unrelated to this responsive header
  change. Final fix-round gates: `bun run check` checked 39 files and both
  TypeScript projects; `bun run test` passed 148 tests with 435 assertions; and
  `bun run test:e2e` passed 36 Chromium tests with 411 assertions across the
  isolated 1-test project-switcher, isolated 1-test branch-state, and 34-test
  main invocations.

## 2026-08-06 — Hunk popups flip above short bottom space (#9)

- A focused Chromium regression placed a Markdown rail mark 24 px from the
  pane bottom and failed twice against the released placement code by exactly
  256.75 px: `openPanel()` always used mark-bottom + 6 regardless of rendered
  popup height. Both popup families use that path, so the fix is shared rather
  than renderer-specific.
- Placement now measures the post-render popup and the selected code line or
  rail mark in `#viewer-scroll` coordinates. Below remains the default; above
  is selected only when popup + 6 px cannot fit below and can fit above. If
  neither direction fits, below remains the deliberate fallback so issue #24's
  mark/header ensure-visible behavior handles the over-capacity case.
- Split/unified changes re-render and re-place immediately, then preserve mark
  and header visibility. A resize keeps the popup open as before but now
  observes the scroll viewport as well as viewer content, re-lays Markdown
  rails, and remeasures orientation. Word wrap continues to close popups.
- Chromium measurements (719 px pane, 223.75 px popup) covered both families.
  Markdown below/above spaces were 518/180 px (below, 6 px gap) and 3/695 px
  (above, 6.25 px painted gap); code spaces were 523.625/180.375 px (below,
  5.625 px painted gap) and 9.125/694.875 px (above, 6.125 px painted gap).
  In a 239 px pane neither side fit: Markdown had 100/118 px above/below and
  code 100.375/123.625 px; both retained below placement with painted gaps of
  6 and 5.625 px respectively. Fractional painted values come from line and
  diff layout rounding; style-coordinate placement is exactly 6 px.
- Final gates: `bun run check` clean after formatting the new e2e block;
  `bun run test` 144/0 with 424 assertions; `bun run test:e2e` 41/0 with 405
  assertions (the required project-switcher invocation was 1/0/1 and the main
  invocation 40/0/404).
## 2026-08-06 — Server and project context in page titles (#33)

- `/api/projects` now carries the server's `os.hostname()` so browsers opened
  through localhost, LAN, or other addresses all identify the actual server
  machine consistently.
- The client retains plain `peruse` while that payload is pending, then uses
  `peruse - <hostname>` on the landing page and appends the selected project or
  worktree name. Switcher navigation updates immediately; a route absent
  from the current listing falls back to the landing form.
- The focused Chromium regression was red on the static title: the first
  resolved landing assertion expected `peruse - oidm-dev` and received
  `peruse` (0 passed, 1 failed; 3 assertions reached). Final Chromium values
  were `peruse` before data, `peruse - oidm-dev` on landing,
  `peruse - oidm-dev - alpha` after opening a project,
  `peruse - oidm-dev - beta` after switching projects,
  `peruse - oidm-dev - topic` after selecting its linked worktree, and the
  landing title again after navigating home; no observed title contained
  `undefined` or `null`.
- Final gates: `bun run check` checked 37 files with both typecheck targets
  clean; `bun run test` passed 144/144 with 425 assertions; and
  `bun run test:e2e` passed 35/35 with 385 assertions (1/9 in the isolated
  switcher process and 34/376 in the main process).

### 2026-08-06 addendum — parent-qualified and failure-honest titles

- Independent review found four gaps in the first round: worktrees used the
  branch-only display name, a same-tick A → B request from B lost the final B,
  unavailable project pages had no title, and live project removal left stale
  title/switcher context. The switcher race predates #33: its immutable
  comparison with the page's initial route came from the original
  multi-project switcher and is present on main at `fd227a9`.
- Titles now use the selected `routeName`, so the linked worktree measures
  `peruse - oidm-dev - beta:topic`. Switcher navigation records the latest
  requested route; the deterministic A → B flip finishes at `/p/beta/` with
  `peruse - oidm-dev - beta`. The new worktree assertion was red by timing out
  on round 1's `topic` title (0/1, 5 assertions reached), and the rapid-switch
  assertion was separately red at `/p/alpha/` instead of `/p/beta/` (0/1, 6
  assertions reached).
- An unavailable project-page route now returns a minimal HTML 404 with
  `peruse - oidm-dev` and a one-line `project not found` body; project API
  routes retain their plain 404. When an open project disappears, the first
  EventSource error in a failure streak refetches `/api/projects` once. The
  measured client removed the stale switcher option and changed to
  `peruse - oidm-dev` while retaining its `/p/alpha/` URL and rendered Alpha
  content; repeated 404 reconnects produced no additional project refetch.
- Final fix-round gates: `bun run check` checked 37 files with both typecheck
  targets clean; `bun run test` passed 144/144 with 428 assertions; and
  `bun run test:e2e` passed 35/35 with 395 assertions (1/19 in the isolated
  switcher process and 34/376 in the main process).

## 2026-08-06 — Copy exact raw file contents (#19)

- Added a keyboard-focusable `Copy raw` pane-header chip for every non-binary
  file, including empty text. It copies the loaded `file.content` string rather
  than extracting rendered DOM text, so Markdown rendering, syntax markup,
  line numbers, change marks, and open popups cannot enter the payload; the
  Rendered/Raw state is untouched.
- Secure contexts use `navigator.clipboard.writeText()`. When that API is
  absent on plain-HTTP LAN/Tailscale pages, the click gesture drives a temporary
  textarea plus `execCommand("copy")`; the textarea is removed and focus is
  restored. A denied API call does not silently fall through or alter the view:
  the chip and polite status region tell the user to allow clipboard access.
- The first focused regression was red against the static header: it expected
  one `.copy-raw` control and found none (0 passed, 1 failed; 2 assertions
  reached).
- With clipboard permission granted, Chromium read back the rendered Markdown
  fixture exactly (57 UTF-16 code units / 60 UTF-8 bytes, including `café`, 🚀,
  a literal tab, newlines, and terminal newline), the code fixture exactly (50
  code units / 60 UTF-8 bytes, including Japanese text, a tab, newlines, and
  terminal newline), and the empty fixture as `""`. The Markdown view stayed
  rendered. `Copied` appeared and returned to `Copy raw` after the 1.5 s
  feedback interval.
- With `navigator.clipboard` removed to model plain HTTP, the real
  `execCommand("copy")` returned true and Chromium read back the exact code
  fixture; the temporary textarea count returned to zero and focus returned to
  the button. A fresh context with clipboard permission omitted reported
  `prompt`, rejected the write, showed `Copy failed — allow clipboard` plus its
  live-region guidance, and left Markdown rendered. The binary fixture hid the
  button.
- Final gates: `bun run check` checked 37 files with both typecheck targets
  clean; `bun run test` passed 144/144 with 424 assertions; and
  `bun run test:e2e` passed 37/37 with 401 assertions (1/1 in the isolated
  switcher process and 36/400 in the main process).

### 2026-08-06 addendum — independent-review hardening

- Three focused regressions reproduced the review findings against the first
  implementation. A delayed denied write settling after a newer success changed
  `Copied` back to the failure label (0 passed, 1 failed; 2 assertions reached).
  The textarea fallback cleared a rendered-text Selection (0/1; 3 assertions),
  and the denied state at a real 500 px viewport widened the document to 565 px
  (0/1; 4 assertions).
- Copy attempts now carry an increasing token; a completion may update feedback
  only while its token is current. The compatibility textarea clones all
  Selection ranges before focusing itself and restores those ranges after it is
  removed, alongside the existing focus restoration.
- Failure feedback keeps the pane-header button at `Copy failed` and exposes the
  actionable sentence in a wrapping live status below the header. Pane controls
  wrap at narrow widths, and shrinkable path labels prevent header text from
  forcing document overflow. Chromium measured a 500 px document in a 500 px
  viewport, a 220/220 px pane-header client/scroll width, and the rightmost
  control at 385.5 px inside the pane's 500 px right edge.
- Final review-round gates: `bun run check` checked 37 files and both TypeScript
  projects; `bun run test` passed 144/144 with 424 assertions; and
  `bun run test:e2e` passed 39/39 with 413 assertions (1/1 in the isolated
  switcher process and 38/412 across the other three browser files).

## 2026-08-06 — Every Markdown change gets a reachable mark (#24)

- Reproduced the collapse with one fixture containing seven separated edits
  across frontmatter, one paragraph, one list item, and one fence: the header
  reported 7 changes but the scalar block mapping rendered only 3 rail marks.
  The regression now also changes an HTML comment, which produces no rendered
  element, for 8 total changes and an explicit fallback-anchor case.
- Markdown blocks now carry lists of hunk indices. Innermost ownership is
  resolved independently per hunk, so a nested block can own one change while
  an ancestor remains the correct anchor for another. Frontmatter cards gained
  exact source ranges; any still-unrendered hunk is assigned to the nearest
  source-mapped block (or the article when there are none).
- The initial rail rendered one bar per hunk at a source-line fraction of its
  shared block. That passed the first/last paragraph, list, and fence fixture,
  but round-2 review showed the geometry model itself was wrong; the final
  compact model is recorded below.
- Initial Chromium verification measured 8 header changes, 8 marks at x=290,
  direct mark → popup indices 0 through 7, and an arrow cycle of 0…7→0. The
  historical first red fixture had 7 counted changes / 3 marks; adding the
  no-output HTML-comment case made the current regression 8 / 3 before the
  ownership fix. This supersedes the shorter `7/3` wording in the early plan.

### 2026-08-06 addendum — collision-safe shared-block geometry

- Adversarial review found two release blockers in the proportional model. A
  21 px paragraph with nine alternating `-U0` hunks produced overlapping 6 px
  marks whose centers hit later changes. A three-source-line paragraph with a
  heavily wrapped middle line produced marks roughly one third of the 4,242 px
  block—far from either short changed line.
- Shared blocks now use a deliberately compact representation: fixed 6 px
  marks, stacked in source order with 2 px gaps. A stack begins at its block
  when possible and moves as a unit to the nearest free rail segment if it
  would collide with another block's marks. It says “changes in this block, in
  order” rather than claiming false visual-line coverage. Single-change bars
  stay fixed at the original full-block geometry. Nearest-block fallback marks
  are hollow/dashed to identify their approximate placement.
- Coordinate-level Chromium verification found no overlapping rectangles and
  exact center-hit/popup/diff mappings for all 9 dense changes, both uneven
  changes, and all 8 original changes. The dense stack ran from y=105 through
  y=175 in 6 px bars with 2 px gaps; the uneven 4,242 px block used only y=123–
  137. Existing single-change guide geometry remained `(x,y,h)` `(290,302,55)`,
  `(290,367,21)`, `(290,442,21)`, identical to the released 1.0.0 measurements.
- Final round-2 gates: `bun run check` clean; `bun run test` 144/0 with 424
  assertions; `bun run test:e2e` 30/0 with 279 assertions.

### 2026-08-06 addendum — global ordering and over-capacity navigation

- Round-3 review found that reserving full-block bars before placing compact
  stacks could move an early 30-change stack 1,422 px below a later change. It
  also found that arrows still scrolled the owning block, leaving change 120's
  displaced mark and popup offscreen, and that one hunk spanning sibling list
  items acquired two marks whose popup used only the first anchor.
- The final packer flattens compact and full-block bars into one source-ordered
  sequence. Each bar uses the greater of its natural top or the preceding
  bar's bottom plus the 2 px gap. Overflow therefore cascades later entries
  downward instead of inverting source order; where natural bars do not
  compete, their geometry is unchanged. A cross-sibling hunk belongs once to
  the innermost block containing its first changed line.
- Mark clicks and arrows now use the selected rail mark for vertical popup
  anchoring and adjust `#viewer-scroll` after insertion so both the mark and
  popup header intersect the viewport. In the 120-hunk fixture, forward and
  reverse selection of hunk 119 put the mark at y=607–613 and the header at
  y=620–648.25 inside the y=81–800 pane (`scrollTop=450`).
- Red proof against round-2 geometry: `bun run test:e2e` passed 31 and failed
  3 of 34 tests with 338 assertions. The failures measured the early stack at
  y=1,527 instead of its y=105 block, left both late mark and header invisible
  at `scrollTop=0`, and rendered two marks for the one sibling-spanning hunk.
- Final Chromium measurements placed the two competing four-mark stacks at
  y=105–167 in strict 8 px steps; placed the 30 early bars at y=105–343 and
  the later full-block bar at y=345 without crossing; retained one sibling
  mark, one header change, and the popup's 6 px anchor gap; and preserved
  ordered 9- then 10-mark layouts through wrap and SSE re-render. The released
  guide fixture remained exactly `(x,y,h)` `(290,302,55)`, `(290,367,21)`,
  `(290,442,21)`.
- Final round-3 gates: `bun run check` clean; `bun run test` 144/0 with 424
  assertions; `bun run test:e2e` 35/0 with 377 assertions (the required
  project-switcher invocation was 1/0/1 and the main invocation 34/0/376).

## 2026-08-06 — 1.0.0 released; npm trusted publishing automated (#2)

- First public release: `@talkasab/peruse@1.0.0` on npm (`latest`), GitHub
  Release v1.0.0 with notes extracted from the changelog section.
- Release automation is GitHub Actions + npm OIDC trusted publishing — no
  tokens. Key constraint learned: npm only offers trusted-publisher settings
  on an already-published package, so 1.0.0 was bootstrapped with one manual
  `npm publish` and the workflow's publish step is an idempotent guard
  (`npm view` before `npm publish`); its "already on the registry — skipping"
  path was exercised by the real 1.0.0 run. Later releases are fully
  automatic: roll changelog → `npm version` → `git push --follow-tags`.
- `npm pkg fix` normalized the `repository` field before tagging so the
  published package.json byte-matches the repository's. Reminder that
  `git push --follow-tags` only pushes *annotated* tags — recreating a
  deleted npm-version tag by hand needs `git tag -a`.

## 2026-08-05 (integration) — Four-branch batch merged: #17, #28, #18, #25

- Landed in the order #17 → #28 → #18 → #25, chosen so the watcher branch's
  readiness contract (`RuntimeClosedError` on close) was on main before the
  enumeration cache's invalidation paths began closing runtimes. The order and
  every conflict resolution were rehearsed beforehand with real three-way
  merges in a scratch tree.
- The `server/index.js` composition was the only judgment-laden resolution:
  one `closed` state (the rebase initially left two declarations — caught by
  Biome exactly as the rehearsal predicted), #17's `readyReject` as the first
  transition inside #28's memoized `closePromise`, and `resolveProject()`
  keeping #17's typed catch ahead of #28's combined post-success guard, with
  the typed-error path routed through the tracked `closeRuntime` helper.
- `renderCode()` keeps #25's `wrapAvailable` and #18's `plainFallback(f)` —
  reverting to the generic size expression would have silently dropped the
  .svx 3,500-line ceiling.
- Added `test/integration/composed-lifecycle.test.js` for the scenarios that
  can only exist with both server branches present: route invalidation
  settling a scan-broken runtime's pending readiness, runtime-level startup
  coalescing across cold and post-invalidation waves, and SSE EOF when a
  fallback-recovered runtime is invalidated. Plus one combined e2e case:
  the wrap toggle operating on grammar-highlighted `.svx` output.
- Every branch had been through adversarial review/fix cycles (two independent
  reviewer sessions; 40+ confirmed findings fixed across the batch) before
  merging; the full merged tree passes check, 144 unit/integration tests, and
  27 browser tests.

## 2026-08-05 — Word wrap toggle (#25)

- Wrapping is entirely CSS off a `data-wrap` attribute on `#viewer`: `hlCode()`,
  the large-file `plainPre()` fallback, and markdown fences all emit the same
  `.shiki > code > .line` markup, so one rule set covers every code path with no
  re-render. State mirrors the theme toggle (`peruse-wrap` in `localStorage`).
- The subtlety the issue flagged is real and now has a regression test. Shiki
  separates `.line` spans with literal `\n` text nodes; with `display: block` on
  a wrapping line each of those newlines becomes its own empty line box and the
  file renders at double spacing. `inline-block` avoids that while still
  honoring `width`/`padding`/`text-indent`. The test measures it structurally
  rather than by eye: `<code>`'s height in line-height units must equal the sum
  of its lines' heights in line-height units, which doubling breaks. On the new
  `docs/wide.txt` fixture with wrap on, the lines occupy 1 + 8 + 4 + 1 + 1 = 15
  rows and `<code>` is 291px = 15 × 19.375px; with wrap off, 5 rows and 97px.
- Range client rects are per *token*, not per visual row — the first attempt at
  measuring "how many rows did this line wrap to" counted Shiki spans and
  reported 30 rows for an 8-row line. Grouping the rects by rounded `top` gives
  real rows and, more usefully, each row's left edge, which is how the hanging
  indent is verified: all 8 rows of the wrapped line start at x=350, the same x
  the unwrapped line started at — under the code, not under the 70px
  line-number gutter. Markdown fences suppress the line number
  (`content: none`), so they reset the indent to 0 and are asserted separately.
- Toggling drops any open hunk popup — its `top` came from `anchor.offsetTop`
  when it opened, and every offset below the first wrapped line moves — and
  re-runs `layoutRails()` for markdown, where fence blocks change height.

### 2026-08-05 addendum — adversarial fix round

- Wrap toggles now preserve a logical viewport anchor: the first fully visible
  code line or rendered Markdown block, falling back to the first intersecting
  item when a wrapped item is taller than the viewport. In Chromium, placing
  line 150 of a 200-long-line fixture at the top left it topmost after both
  transitions; its measured offset was -0.625 px after wrapping and -1.125 px
  after unwrapping (one line-height is 19.375 px).
- Wrapped added/modified marks moved from the one-row line-number pseudo-element
  to a full-height positioned bar. The regression fixture's modified line was
  eight visual rows / 155 px high, and its mark measured the same 155 px;
  deletions retain one first-row wedge and no full-height bar.
- The 44 px line-number box could not fit a six-digit label (45.156 px in the
  test font). That limitation predates this branch, but wrapping made gutter
  geometry a shared dependency, so the number box is now 52 px inside one
  78 px `--code-gutter`. The same variable drives the hanging indent, popup
  offset, and gutter click target; the documented budget is six digits.
- The wrap chip is hidden where it cannot affect content: binary and empty
  files, and rendered Markdown without a fenced code block. It remains visible
  for rendered Markdown with a fence and for any nonempty raw/code view.
- Chromium coverage asserts viewport anchoring in both directions, mark height
  relative to the wrapped logical line, the single deletion wedge, six-digit
  fit and shared gutter/indent geometry, and all chip-visibility cases without
  relying on fixed viewport or font pixel values.
- Final verification: `bun run check` passed; `bun run test` passed 67/67
  unit/integration tests; `bun run test:e2e` passed its isolated 1-test switcher
  run and 15-test browser run (16/16 total).

### 2026-08-05 second addendum — viewport-edge hardening

- Sticky headings cannot be treated as ordinary viewport rectangles: CSS
  paints them away from their normal flow position. The anchor search now
  compares each sticky h1/h2 with its containing section's undisplaced offset
  and excludes it when those positions differ. A fence taller than the viewport
  then reaches the documented first-intersecting fallback. Its original top was
  0.25 px and all three wrap/unwrap cycles measured 0.25 px in both directions;
  before the correction every return landed 26 px low.
- Start and EOF are explicit anchors rather than incidental code-line/block
  choices. The 220-line code fixture stayed at `endGap = 0` while its scroll
  maximum changed from 3,568 to 20,618 px; rendered Markdown likewise stayed at
  `endGap = 0` while its maximum changed from 659 to 4,004 px. At file start,
  the natural first-line inset measured 14 → 12 → 14 px and `scrollTop` stayed
  zero throughout, removing the prior accumulated 2 px drift.
- The common line-anchor oracle now requires logical line 150 itself—not a
  neighbor—to remain topmost, within 15% of the measured line height (2.906 px
  in Chromium). Coverage now also includes a same-tick double toggle, an
  ordinary Markdown block below changing content, three viewport-tall fence
  cycles, exact EOF in code and Markdown, file start, and a short file with no
  vertical scrollbar.
- Final verification: `bun run check` passed; `bun run test` passed 67/67 with
  194 assertions; `bun run test:e2e` passed 18/18 with 120 assertions across
  the required isolated browser invocations.

### 2026-08-05 third addendum — start/EOF classification

- A pane with no vertical overflow is simultaneously at its start and end.
  EOF previously won that tie, so wrapping one enormous line created a
  4,498 px scroll range and immediately moved to its bottom. START now wins:
  the measured transition was `scrollTop 0 → 0`, `maxScroll 0 → 4,498`.
- EOF is a reading region, not a one-pixel coordinate. The edge classifier now
  uses one measured content line height; actual end gaps 0, 1, and 2 px all
  restored to end gap 0 after wrapping. The control position 706 px above EOF
  remained logical line 148 at essentially the same viewport offset
  (0.125 → -0.375 px), rather than being absorbed into EOF.
- The file-top oracle now requires `scrollTop === 0`. Dedicated Chromium
  regressions cover the no-overflow-to-overflow transition, 0/1/2 px end gaps,
  and a clearly non-EOF logical anchor.
- Final gates: `bun run check` passed; unit/integration passed 67/67 (194
  assertions); the separately invoked browser suites passed 20/20 (134
  assertions).

### 2026-08-05 fourth addendum — continuous bottom-region anchoring

- The one-line-height EOF bucket still had a discontinuity: with a 19.375 px
  line height, a 19 px gap snapped to EOF while a 21 px gap landed 2,890 px
  away after wrapping. The bottom region is now the final reader viewport
  (`endGap <= clientHeight`), and its anchor stores the measured end gap rather
  than collapsing the whole region to zero. Exact EOF remains the natural
  zero-gap case; positions beyond one viewport continue to use a logical
  top-line/block anchor.
- Chromium measured actual end gaps for 0.5×, 0.9×, 1.1×, and 1.5× line height
  as 10, 17, 21, and 29 px before wrapping and the same 10, 17, 21, and 29 px
  afterward. The half-viewport regression is derived from the live reader
  geometry and uses the same bounded end-relative assertion.
- At a 639 px reader viewport, the 706 px control remained logical line 193 at
  a 17 px top offset before and after wrapping; its end gap changed from 706 to
  5,978 px as the long lines below expanded, confirming the top anchor remained
  in control outside the bottom region. Fixture trailing content now keeps the
  established line-150 and viewport-tall-fence regressions outside that region.
- Edge-case replay retained exact file top (`scrollTop 0 → 0`), exact EOF
  (`endGap 0 → 0`), the non-overflowing huge-line START transition
  (`maxScroll 0 → 4,578`, `scrollTop 0 → 0`), and a short non-overflowing file.
  The Markdown fence grew 39 → 3,384 px while its top stayed at 0.25 px,
  confirming sticky-heading exclusion and the viewport-tall fallback.
- Final gates: `bun run check` passed; unit/integration passed 67/67 with 194
  assertions; the separately invoked browser suites passed 20/20 with 137
  assertions.

### 2026-08-05 fifth addendum — visible-end anchoring

- The fourth-round `endGap <= clientHeight` classifier preserved a scalar gap
  while losing the reader's content at its inside edge: at a 719 px viewport,
  699 px from EOF changed visible code lines 188–225 into 246–253 with no
  overlap. The end anchor is now semantic: it applies only when the final
  meaningful logical code line or rendered Markdown block intersects the
  current viewport. Otherwise the existing top-line/block anchor applies. The
  end case still stores and restores its measured gap; START, clamping, and
  sticky-only heading exclusion are unchanged.
- The replacement Chromium regression captures visible logical-line sets on
  both sides of the old distance boundary. With a measured 19.375 px line
  height and 719 px reader, the derived gaps were `719 - ceil(19.375) = 699`
  and `719 + ceil(19.375) = 739` px. After wrapping, 699 px retained lines
  188–196 from the prior 188–225 range (9 shared), and 739 px retained 186–194
  from 186–223 (9 shared). Under the fourth-round classifier the same focused
  tests failed with zero overlap at 699 px.
- A separate fixture has 80 short lead lines and one final line that becomes
  taller than the viewport. At the derived 21 px gap the final line was
  visible before wrapping: lines 44–81 became line 81, keeping the end visible
  and preserving `endGap 21 → 21`. At 699 px the final line was absent: lead
  lines 9–46 remained lines 9–46 after wrapping (38 shared), instead of being
  replaced by the giant final line. That hidden-final-line assertion also
  failed with zero overlap under the fourth-round classifier.
- Resize classification uses live geometry. While the giant final line
  remained visible, reducing `clientHeight` 719 → 718 naturally changed its
  gap 21 → 22 px; unwrap and rewrap both preserved 22 px. Replays also retained
  the ordinary 21 → 21 → 21 stored-gap round trip, no-overflow START
  (`scrollTop 0`, `maxScroll 0 → 4,498`), clamp-to-START on shrink, exact code
  and Markdown EOF (`endGap 0 → 0`), exact file top (`scrollTop 0 → 0`), line
  150 as the first visible logical line, the 0.25 px viewport-tall Markdown
  fence anchor across wrap cycles, its displaced sticky heading exclusion, an
  8-row/155 px change mark, and popup closure (`1 → 0`).
- Final gates: `bun run check` passed (Biome checked 29 files; both production
  type-check configurations passed); unit/integration passed 67/67 with 194
  assertions; the separately invoked browser suites passed 21/21 with 155
  assertions (1/1 switcher, then 20/20 core/navigation/sanitization). The first
  full browser invocation encountered a Bun subprocess with no stdout and
  cascaded to three shared-page failures; an immediate full-command replay was
  clean.

## 2026-08-05 — mdsvex `.svx` highlighting (#18)

`.svx` was falling through to `text`. The issue proposed two options in order:
map it to the bundled Svelte grammar, or build a small composite. Both were
measured rather than argued about, by tokenizing a representative `.svx` file
and printing every token's colour.

- **Svelte alone is not viable.** Script, style, tags, directives and mustaches
  come out right, but frontmatter, headings, emphasis, links, lists and tables
  are *all* the default foreground — the whole prose half of the format is
  invisible. Worse, it actively misreads fenced code: a `{` inside a fenced JS
  block is claimed as a Svelte mustache, so the rest of the fence tokenizes as
  an expression. **Markdown alone** is the mirror image: prose and fences are
  right, every Svelte construct is plain.
- So: a composite (`web/langs/mdsvex.js`), built mainly from `include`s of the
  bundled grammars, plus small delimiter/tag-guard rules where their syntax
  differs. It continues to use the themes' existing scopes.
- Three things were learned the hard way, all recorded in the file's comments:
  1. Listing the Svelte rules alongside `text.html.markdown#block` doesn't
     work. Markdown's `#paragraph` is a begin/**while** rule that owns every
     continuation line, so nothing listed as a sibling ever sees inside prose.
     The Svelte rules had to become a TextMate *injection*, which does.
  2. A grammar's own `injections` map only fires when that grammar is the
     tokenization root. Svelte embeds `<script lang="ts">` bodies that way, so
     with `source.mdsvex` as the root the bodies silently stayed plain until
     mdsvex re-declared those injections. They are reused verbatim; with the
     app's eager grammar set, script JavaScript/TypeScript and style
     CSS/SCSS/PostCSS are colorized. Other style languages remain plain inside
     the block.
  3. `L:source.mdsvex` alone blows the stack. The tag rules re-tokenize their
     own begin captures, the injection matches again at the same position, and
     it recurses forever. Every scope those rules push is excluded in the
     selector — that list is a correctness fix, not tidiness.
- One deliberate deviation from Svelte's grammar: its tag rule accepts an empty
  tag name, so `a < b and 5 > 3` in prose would be eaten as a tag hunting for
  its `>`. A one-line `match` claims those as text first.
- Tests measure rather than eyeball, per the practice that has paid off here.
  The unit suite asserts each region has more than one colour, that no two
  regions share a palette, and that the output reproduces the source line for
  line — under both Catppuccin themes. The browser test repeats the palette
  measurement on `getComputedStyle` in the live DOM. Both would pass trivially
  on "it produced tokens" and both fail on the real defect, which is regions
  that tokenize fine and all render the same grey.
- `bun run test` 94/94, `bun run test:e2e` 14/14, `bun run check` clean.
  Bundle: +25 KB raw, +4.5 KB gzipped (the Svelte grammar; its embedded
  JS/TS/CSS were already loaded).

### 2026-08-05 addendum — adversarial fix round

- The base grammar now mirrors Markdown's YAML begin/while frontmatter path for
  mdsvex `+++` TOML. Browser measurements of the TOML title produced three
  distinct computed colours in both Latte and Mocha. The Svelte injection also
  delegates Markdown URL/email autolinks before its generic tag rules; scope
  probes now report Markdown link scopes while `<a href>`, single-letter and
  multiline components, and 100-deep nested tags retain Svelte scopes.
- A `.svx`-specific 3,500-logical-line plain-source boundary replaces the
  generic 10k limit for this composite. Representative direct highlighting at 3,497 lines
  took 289 ms (the old 9,026-line case took 705 ms); Chromium rendered the
  balanced 3,500-logical-line boundary in 481 ms, compared with 562 ms for a 10k-line
  raw Markdown control. The 3,501-line fixture used plain source in 110 ms.
- Shiki's post-construction `loadLanguage` plus Bun code splitting now defer
  Svelte/mdsvex registration and network chunks until the first highlightable
  `.svx`. The initial JS transfer fell from 2,808,181 to 2,782,177 bytes raw
  (431,986 to 427,344 gzip); first `.svx` use fetched 26,251 bytes raw / 5,566
  gzip. TOML was already an eagerly supported standalone grammar, so the new
  frontmatter include adds no separate startup grammar.
- Fixtures now cover TOML, both autolink forms, multiline and deeply nested
  tags, lazy chunk requests, and both sides of the mdsvex line boundary.
- Final verification: `bun run check` passed; `bun run test` passed 99/99;
  `bun run test:e2e` passed 16/16 (81 assertions across its two invocations).

### 2026-08-05 addendum — return to the single-bundle build

- The grammar work held up, but the build splitting used to defer roughly 5 KB
  gzip did not earn its lifecycle complexity. The split builder deleted
  `dist/chunks` before knowing a replacement build would succeed, exposed
  missing chunks during a live rebuild, and removed arbitrary files it did not
  own. A transient build failure could therefore leave `dist/app.js` pointing
  at chunks that no longer existed. The deliberate tradeoff is to restore
  main's one-command, single-bundle eager build and static Svelte/mdsvex
  registration. There is no pre-build cleanup, dynamic import, or `dist/chunks`.
- Two consecutive eager builds produced byte-identical files and exactly
  main's five-file layout (`app.js` plus four CSS/HTML assets). With
  `gzip -9 -n`, main measured 2,781,326 bytes raw / 421,031 gzip and this branch
  measured 2,807,461 / 426,216: an eager cost of 26,135 raw / 5,185 gzip.
- Repeating the review's browser shape with no lazy request involved, the first
  eligible 3,500-logical-line `.svx` navigation after app boot measured 626.9, 630.4,
  and 639.7 ms; warm navigation measured 454.3, 455.4, and 477.3 ms. Eager
  loading removed the chunk fetch but did not materially reduce the cold
  end-to-end result, so the former 481 ms “worst case” claim is withdrawn. The
  3,500-logical-line cutoff remains the smallest honest mitigation pending issue #8.
- Checkout freshness now walks regular files recursively below `web/`. A unit
  regression makes a nested grammar newer than the top-level entry, and a real
  startup probe with only `web/langs/mdsvex.js` moved forward rebuilt
  `dist/app.js`; the old immediate-child check did not.
- Lazy-chunk request assertions were removed. Grammar scopes, TOML/autolink
  behavior, source fidelity, gutter interaction, and both sides of the cutoff
  remain covered in unit and Chromium suites.
- Final gates: `bun run check` passed; unit/integration passed 100/100 (257
  assertions); the separately invoked browser suites passed 16/16 (78
  assertions).

### 2026-08-05 addendum — logical-line boundary and supported styles

- The fallback classifier counted `split("\n")` elements, so a conventional
  newline-terminated 3,500-line file appeared to contain 3,501 lines. The
  boundary fixture had hidden this by removing its terminal newline. The
  shared classifier now ignores exactly one terminal LF or CRLF; `.svx` uses
  the 3,500-line limit and other code uses the same rule at 10,000 lines.
- The browser fixture now exercises terminated and unterminated `.svx` files
  at both 3,500 and 3,501 logical lines. Against the old expression, the
  terminated 3,500-line case took plain fallback and failed immediately with
  an unexpected notice; after the fix both at-limit shapes highlight and both
  over-limit shapes render plain. Shiki preserves a terminal newline as an
  empty final DOM row, independently of fallback classification.
- Reusing Svelte's injection selectors does not load every grammar they name.
  With the app's eager set, CSS, SCSS, and transitively available PostCSS style
  bodies are colorized; LESS, indented Sass, Stylus, and other unloaded style
  languages remain plain within their block. A two-theme token test verifies
  the supported palettes, a flat LESS body, and intact surrounding
  Markdown/Svelte highlighting. Issue #18 already asks for “supported
  preprocessors,” so its acceptance wording needs no amendment.
- Final gates: `bun run check` checked 32 files; unit/integration passed
  103/103 (281 assertions); the separately invoked browser suites passed
  16/16 (82 assertions).

## 2026-08-05 — Enumeration cache: 440 git spawns per page load → 0 (#28)

- Every `/p/<name>/…` request resolved its route by re-enumerating projects,
  and enumeration spawns two sequential git processes per registered project.
  Measured on a synthetic 10-project registry, one markdown-page-shaped load
  (tree + file + 20 `/raw/` assets) issued **440 enumeration spawns in 131 ms**
  of request time; with the cache, **0 spawns in 4 ms** (4 git spawns total,
  all status/diff work for the tree and file requests).
- The design question was what the key should be. A pure TTL would have made
  `peruse add`/`rm`/`prune` and `lastOpened` updates briefly invisible, so the
  **registry snapshot is the key** and the TTL only ages out git-derived
  worktree discovery. That removes the whole class of "why is my project list
  stale" bugs and left the default TTL free to be short (2 s), overridable via
  `PERUSE_ENUM_TTL_MS` or `startServer`'s `enumerationTtlMs`.
- Caching the *resolved array* would not have helped the case that motivated
  the issue: a page's 20 asset requests arrive concurrently, so every one of
  them would still have missed and enumerated. The cache holds the **in-flight
  promise**, which is what actually collapses the burst — an integration test
  fires 20 concurrent `/raw/` requests and asserts exactly one enumeration.
- A cached enumeration can name a target that has since vanished, so route
  resolution re-`stat`s the path before building a runtime; without that, a
  deleted project would get a chokidar watcher on a path that is gone instead
  of a 404.
- Spawn counting in tests works by patching `Bun.spawn` (it is writable) and
  counting only argv containing `--show-toplevel` or `worktree` — request-path
  git calls (`rev-parse --show-prefix`, `status`, `ls-files`, `diff`) never use
  those, so the count isolates enumeration. The per-enumeration cost is
  measured at setup rather than assumed: a non-git project costs one spawn, not
  two, because `rev-parse` fails and the worktree listing is skipped.
- `bun run test` 77 pass / 0 fail, `bun run test:e2e` 11 pass / 0 fail,
  `bun run check` clean.

### Adversarial fix-round addendum — 2026-08-05

The “440 → 0” headline above measured only a partial, warmed request shape and
is superseded by a cold realistic sequence: root, project navigation,
`/api/projects`, tree, file, and 20 concurrent raw assets across 10 Git repos.
With settled-result reuse disabled, mandatory in-flight coalescing reduces the
concurrent asset burst to one enumeration: **100 enumeration / 134 total Git
spawns**. With the default cache, the same sequence is **20 enumeration / 54
total Git spawns**. This includes navigation and both enumeration and non-cache
Git work.

The fix round also made in-flight reuse independent of TTL and starts the TTL
when enumeration settles; keyed the cache only on canonical project name/path
identity so `lastOpened` cannot invalidate it mid-navigation; moved TTL timing
to a monotonic clock; made environment parsing strict; and verifies cached
linked worktrees by their `.git` gitdir/branch linkage before serving them. A
recreated unrelated directory now 404s inside the TTL. Focused tests cover all
of those cases, including the full strict environment-value table. Final
verification: `bun run check` clean; `bun run test` 81/81; `bun run test:e2e`
11/11 across the required isolated browser invocations.

### Second adversarial fix-round addendum — 2026-08-05

A second replay found that the first route guard established path/linkage, not
incarnation: registered roots were accepted unconditionally, and deleting and
recreating an entire repository could reproduce a linked worktree's gitdir path
text. Cached targets now carry private filesystem-object identities for the
served directory and Git administrative directory. The guard covers registered
Git and non-Git roots as well as linked worktrees. Device/inode/birth-time data
is deliberately documented as best effort, not a permanent repository UUID: a
filesystem that supplies no stable identity, or immediately reuses all three,
can retain stale identity until the short TTL expires.

The same replay exposed three independent cache-state defects. Missing state is
now recomputed for every listing instead of copied from discovery; cached arrays
and targets are immutable, with each caller receiving isolated `lastOpened` and
missing-state overlays; and pending promises are kept per registry key until
settlement, so A/B/A interleaving still makes only two enumerator calls. Settled
storage remains one-entry and rejected work is removed. Environment parsing now
matches the documented canonical contract exactly: only unpadded digit strings
are accepted, and only exact `0` disables settled reuse.

Regressions reproduce same-path registered-root and full repository/worktree
replacement, stale missing listings, concurrent metadata snapshots plus caller
mutation, A/B/A pending interleaving, wall-clock rollback, and the full strict
environment table. The realistic sequence remains **100 enumeration / 134 total
Git spawns** with settled reuse disabled and **20 / 54** with the default cache.
The six report scenarios failed before the second fix and passed afterward.
Final verification: `bun run check` clean; `bun run test` 87/87 with 272
assertions; `bun run test:e2e` 11/11 with 54 assertions across the required
isolated browser invocations.

### Third adversarial fix-round addendum — 2026-08-05

Runtime invalidation previously stopped its ping timer and watcher but left
every attached SSE response open. A real-CLI regression starts a server with a
60-second enumeration TTL, opens and consumes the `/api/events` preamble, runs
`peruse rm` in a separate process, and triggers the removed route. Before the
fix the next stream read remained pending past the one-second oracle; afterward
it reached EOF in roughly 52 ms. Teardown now closes each controller, clears the
client set, and rejects late client attachment through the same closed state, so
invalidation, listing cleanup, and server stop share one complete lifecycle.

Route reconciliation is target-aware as well as name-aware. A regression
creates `one/topic` and `two/topic` linked worktrees, opens SSE on
`project:topic`, removes the first worktree, and waits for the second to inherit
that route from `project:topic-2`. Refreshing the listing now closes the former
runtime and its stream rather than retaining it because the route string still
exists. Each runtime captures the target identity it was created for.

Resolution also re-verifies registry name/path identity, the exact mapped
runtime, and captured filesystem/Git identity after watcher readiness. Runtime
startup is coalesced per route so concurrent first requests all await the same
runtime; this preserves the realistic measurement at **100 enumeration / 134
total Git spawns** with settled reuse disabled and **20 / 54** with the default
cache rather than paying a second enumeration for post-await validation.
Final verification: `bun run check` clean; `bun run test` 89/89 with 281
assertions; `bun run test:e2e` 11/11 with 54 assertions across the required
isolated browser invocations.

### Fourth adversarial fix-round addendum — 2026-08-05

The third round's “one complete lifecycle” statement was premature. Per-route
startup coalescing introduced a `runtimeStarts` map, but `stop()` observed only
already-mapped runtimes. A start delayed at runtime `git status` therefore
survived shutdown, created a watcher, and entered the route map afterward.
Separately, invalidation removed a runtime from the map before its watcher
close settled, making that close invisible to shutdown; a second `close()` saw
the boolean closed state and returned before the first teardown finished.

Runtime close is now promise-idempotent: the first call synchronously marks the
runtime closed, clears ping/flush timers, closes and clears SSE controllers,
then awaits the watcher; every later call returns that same promise. Detached
close promises remain in a shutdown-owned set until settlement. `stop()` marks
the server stopped, force-closes its HTTP listener, and drains pending starts,
mapped runtimes, and detached closes until none remain. A delayed start checks
the stopped state before it can be mapped and closes its newly produced
runtime instead.

The delayed-start and detached-close regressions failed before the fix because
`stop()` fulfilled inside their independent 75 ms pending oracles. The direct
double-close regression additionally restored the boolean early return and
failed because the second call returned a distinct, already-settled promise
while the first remained pending. With the final implementation restored, the
three focused paths completed in 98.39 ms, 101.03 ms, and 164.34 ms,
respectively, including the deliberate 75 ms pending checks; every watcher
close completed exactly once.

Readiness cancellation remains deliberately outside this branch. Its
post-ready identity/mapping guard runs only after `ready` settles; issue #17's
typed `RuntimeClosedError` settlement must land first, and the composed
pending-ready invalidation regression belongs to that merge phase. This round
adds no competing readiness resolution or rejection path.

Final gates: `bun run check` checked 31 files; unit/integration passed 92/92
(295 assertions); the separately invoked browser suites passed 11/11 (54
assertions).

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
