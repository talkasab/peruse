# Issue #15 — Branch state display

Status: complete, including independent-review fix round (2026-08-06)

## Plan

1. Record this plan and keep it synchronized with implementation findings, user-facing documentation, architecture reference, and the dated engineering log.
2. Add focused server and Chromium regressions for base selection, ahead/behind formatting, base-only state, detached HEAD, non-git omission, per-project state, and live branch switching; capture the primary browser assertion failing against the unfixed client.
3. Inspect the existing git-status cadence, subprocess wrapper, watcher admission/event paths, project API shape, header structure, and spawn-accounting tests; rank and test falsifiable integration hypotheses.
4. Implement branch-state computation by piggybacking on existing git-status polling, preserving the 30 s/slow-log/`--no-optional-locks` conventions and avoiding additional request cadence.
5. Place a compact, non-interactive branch indicator in the tree header with existing Catppuccin typography and spacing; verify wide and constrained layouts in Chromium and run the interface detector once.
6. Run `bun run check`, `bun run test`, and `bun run test:e2e` separately; resolve every failure and record exact counts and spawn impact.
7. Review and finalize `ARCHITECTURE.md`, `CHANGELOG.md`, `docs/DEVLOG.md`, and this plan; audit the full diff, repository boundaries, and no-commit state, then mark the plan complete.

## Independent-review fix round

1. Add a red Chromium geometry regression for the reviewer's 645 px branch
   label at 1280, 760, 500, 400, and 320 px, including overflow, readable
   truncation, recoverable full text, and clean hiding.
2. Give the branch badge a readable minimum width while space permits, then
   remove it below a content-driven floor before it can displace header
   controls; expose the full label through title and accessible-name bindings.
3. Add the optional behind-only and Unicode branch-state fixtures.
4. Correct the architecture E2E inventory and responsive contract, append the
   dated DEVLOG findings, and synchronize this plan with final measurements.
5. Run the interface detector once, then `bun run check`, `bun run test`, and
   `bun run test:e2e` separately; audit scope, whitespace, debug markers, HEAD,
   and both worktrees.

## Decisions and findings

- Branch identity comes from `status --porcelain=v2 --branch
  --no-ahead-behind`; its stable headers replace the former standalone HEAD
  verification. Local base discovery and the required `rev-list` share the
  existing status/tree request cadence rather than adding a client endpoint or
  timer.
- Base selection is strict `dev`, `main`, `master`. Detached HEAD skips base
  work and displays a seven-character OID; no recognized base means branch name
  only.
- Ordinary `.git` metadata is already admitted by chokidar except objects, so
  the existing ~200 ms SSE batch refreshes the display after branch switches
  and commits. Linked-worktree administrative directories are outside the
  served root; their fallback is the next existing worktree event/status poll,
  navigation, or reconnect, with no stronger latency guarantee for a
  metadata-only change.
- The indicator belongs to the project-identity group after the root label and
  before the spacer. It uses the existing surfaces and monospace data styling;
  long names truncate with full hover/accessibility text, and the root label
  hides below 850 px. The badge keeps a 112 px readable floor, then hides at
  440 px and below while tighter header spacing and a shrinkable selector keep
  the remaining controls in-view.
- Spawn counts per status poll are 4 on the selected base (unchanged), 5 on a
  differing branch (the required `rev-list`), and 3 detached. Existing realistic
  cached/uncached navigation totals remain 54/134.
- The primary exact-display test failed twice on unfixed code with element
  count 0, then passed through branch, base, detached, switch-back, and new
  commit states.
- Independent review's narrow-width regression failed at 400 px with a 407 px
  document before the fix. The completed five-width pass uses a 645 px-content
  Unicode label: badge widths 360/228/122.3 px at 1280/760/500, hidden at
  400/320, and document width exactly equal to every viewport. Behind-only and
  Unicode branch-state server oracles now close the two trivial review gaps.

## Verification

- Red check: the primary Chromium test failed twice on the unfixed client with
  `.branch-state` count `0` (expected `1`).
- Focused checks: branch-state integration `3/3` with 7 assertions; API plus
  branch-state integration `14/14` with 56 assertions; project switching and
  branch-state Chromium journeys `2/2` with 9 assertions; realistic navigation
  retained cached/uncached Git spawn totals of 54/134.
- Visual checks: Chromium crops are in `/tmp/adv-review/branch-state-header.png`
  and `/tmp/adv-review/branch-state-header-constrained.png`; the one permitted
  layout-detector run returned no findings.
- Final gates: `bun run check` checked 39 files and completed both TypeScript
  projects; `bun run test` passed 147 tests with 433 assertions; `bun run
  test:e2e` passed 36 tests with 385 assertions across its required isolated
  Chromium invocations.
- Documentation, changed-file scope, debug-marker, whitespace, HEAD, and
  no-commit audits completed after the final implementation.
- Fix-round gates: `bun run check` checked 39 files and both TypeScript
  projects; `bun run test` passed 148 tests with 435 assertions; `bun run
  test:e2e` passed 36 tests with 411 assertions. The responsive screenshots are
  `/tmp/adv-review/issue15-500.png` and
  `/tmp/adv-review/issue15-400.png`; the UI detector's three warnings were
  existing change-mark/blockquote side accents outside this fix.
