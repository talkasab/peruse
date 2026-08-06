# Issue #9 — Popup orientation

Status: complete (2026-08-06)

## Plan

1. Record this plan, then keep it and the repository's user-facing and engineering documentation synchronized as implementation findings land.
2. Build focused Chromium regression coverage that measures popup/anchor geometry for both popup families and navigation visibility; run the near-bottom case against the unfixed client to capture a deterministic red result.
3. Inspect the shared popup placement and ensure-visible paths, rank falsifiable causes, and implement measured post-render orientation without changing the below-first fallback for over-capacity popups.
4. Verify mid-pane below placement, near-bottom above placement, arrow-navigation visibility, code-line placement, over-capacity fallback, resize behavior, and split/unified behavior with DOM measurements.
5. Run `bun run check`, `bun run test`, and `bun run test:e2e` separately; record exact results and resolve every failure encountered.
6. Update `ARCHITECTURE.md`, `[Unreleased]` in `CHANGELOG.md`, the dated `docs/DEVLOG.md` entry, and this plan with the final behavior and verification state; review all documentation for accuracy and mark the plan complete.

## Decisions and findings

- Both popup families remain on the shared `openPanel()` path. Placement is a
  post-render measurement: prefer below, flip above only when popup + 6 px does
  not fit below and does fit above, and retain below when neither side fits.
- Split/unified toggles remeasure immediately because diff2html output height
  changes between modes; the selected mark and popup header are revealed again
  after placement.
- Pane resize keeps the popup open, matching prior behavior, and now observes
  both viewer content and the scroll viewport before re-laying/repositioning.
  Wrap continues to close popups before its measured reflow.
- The released code failed the focused near-bottom Markdown test twice by
  256.75 px, proving the regression test catches the reported below-only
  behavior.
- Untouched issue #24 cases for shared-block marks, over-capacity navigation,
  and sibling-spanning ownership remain green. Their +6 assertions describe
  mid-pane or neither-side-fits cases, so no existing expectation changed.

## Verification

- Red proof: the near-bottom Markdown test failed twice on the unfixed client
  with the flipped-gap assertion off by 256.75 px.
- Focused popup suite: 6/0 with 28 assertions. Untouched focused #24 suite:
  3/0 with 53 assertions.
- Chromium probe measurements are recorded in `docs/DEVLOG.md`; both popup
  families cover below, above, and neither-side-fits geometry.
- `bun run check`: clean (37 files checked; both production type-checks pass).
- `bun run test`: 144/0 across 18 files, 424 assertions.
- `bun run test:e2e`: 41/0, 405 assertions total (1/0/1 project-switcher plus
  40/0/404 main invocation).
- Documentation review complete: architecture behavior/testing, user-facing
  changelog, engineering log, and this plan all reflect the final state.
