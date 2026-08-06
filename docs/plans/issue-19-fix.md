# Issue #19: Copy raw file contents

Status: Complete (2026-08-06)

## Plan

1. Record this plan after reading the repository guidance, architecture, full issue specification, and browser-testing instructions.
2. Add focused Chromium regressions for exact rendered-Markdown and code payloads, transient success feedback, denied/unavailable clipboard behavior, binary visibility, and empty text; demonstrate the payload test is red before implementation.
3. Add a pane-header `Copy raw` chip that copies `file.content` without changing rendered/raw state, preferring `navigator.clipboard.writeText()` and falling back to a temporary textarea plus `document.execCommand("copy")`.
4. Measure the required browser states and run `bun run check`, `bun run test`, and `bun run test:e2e` as separate commands.
5. Update ARCHITECTURE.md, CHANGELOG.md, docs/DEVLOG.md, and this plan with final behavior and results; audit the diff, worktree scope, and commit state.
6. Add red Chromium regressions for out-of-order async completions, fallback
   selection preservation, and denied-copy containment at 500 px.
7. Guard feedback with a latest-attempt token, preserve/restore Selection
   ranges around the compatibility textarea, and keep the failure button label
   compact while leaving actionable guidance in the wrapping live region.
8. Re-run the required gates separately, correct the architecture wording,
   add a dated DEVLOG addendum, and complete this plan only after final
   documentation and repository-boundary audits.

## Decisions

- Empty non-binary files show the control and copy an empty string; empty text is still valid source content.
- The fallback is attempted only when the async Clipboard API is unavailable. A failed or denied available API reports an error instead of bypassing an explicit permission decision.
- Concurrent copy attempts remain enabled; monotonically increasing attempt
  tokens make the latest user action authoritative without introducing a
  disabled-control state.
- The compact failure label stays in the pane header, while the actionable
  guidance occupies a wrapping live status row below it.

## Results

- Red proof on the static header expected one `.copy-raw` control and found
  zero (0 passed, 1 failed; 2 assertions reached).
- Granted-permission Chromium reads matched both exact source fixtures:
  rendered Markdown was 57 code units / 60 UTF-8 bytes and code was 50 code
  units / 60 UTF-8 bytes, including Unicode, literal tabs, multiline content,
  and terminal newlines. Empty text copied as an empty string; binary hid the
  control; the rendered Markdown state did not change.
- Success showed `Copied` and restored `Copy raw` after 1.5 s. With the async
  API removed, the actual textarea fallback returned true, produced the same
  exact code payload, removed its textarea, and restored button focus. A fresh
  omitted-permission context reported `prompt`, rejected the write, and showed
  visible button and live-region guidance without changing the rendered view.
- Final verification: `bun run check` checked 37 files with both typecheck
  targets clean; `bun run test` passed 144/144 with 424 assertions; and
  `bun run test:e2e` passed 37/37 with 401 assertions.
- Documentation review updated ARCHITECTURE's header-control contract, the
  user-facing CHANGELOG entry, the dated DEVLOG entry, and this completed plan.
- Review-round red proof reproduced all three findings against the first
  implementation: the delayed first denial overwrote the second success (0/1;
  2 assertions reached), fallback selection became empty (0/1; 3 assertions),
  and a real 500 px denial viewport produced a 565 px document (0/1; 4
  assertions).
- Focused fixed-code checks keep final feedback at `Copied` after the older
  denial, preserve the exact `Unicode: café 🚀` Selection as one range through
  the fallback, and show the actionable denial status without changing the
  rendered view. The 500 px layout measured document width 500 px, pane-header
  client/scroll widths 220/220 px, control right edge 385.5 px, and pane right
  edge 500 px.
- Final review-round verification: `bun run check` checked 37 files with both
  TypeScript projects clean; `bun run test` passed 144/144 with 424 assertions;
  and `bun run test:e2e` passed 39/39 with 413 assertions (1/1 in its isolated
  switcher process and 38/412 across the remaining three browser files).
- The final documentation audit corrected the fallback-position wording and
  recorded attempt ordering, Selection restoration, narrow feedback layout,
  the user-facing CHANGELOG entry, and this completed plan.
