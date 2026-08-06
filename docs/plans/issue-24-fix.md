# Issue 24: Preserve every Markdown change mark

Status: Complete

## Plan

1. Read the repository guidance, architecture contract, issue report, and relevant rendering/tests.
2. Add focused end-to-end fixtures and regression assertions for multiple changes per block, frontmatter reachability, mark placement, and full navigation; demonstrate they fail before the fix.
3. Implement the smallest multi-anchor change that preserves current single-change geometry and popup behavior.
4. Measure the required interactions in Chromium and run the complete check, unit, and end-to-end suites separately.
5. Update ARCHITECTURE.md, CHANGELOG.md, docs/DEVLOG.md, and this plan with the final decisions and results; audit the diff and repository state.

## Decisions

- Store a comma-separated list of hunk indices on each rendered Markdown
  anchor and resolve innermost ownership independently for each hunk.
- Preserve full-block rail geometry for the existing one-change case. When a
  block owns several changes, use an ordered compact stack of fixed 6 px bars
  with 2 px gaps while keeping the fixed rail x. Flatten compact and full-block
  entries into one source-ordered sweep and place each at the greater of its
  natural top or the previous entry's bottom plus the gap. Overflow cascades
  later entries downward without ever inverting source order. This supersedes
  round 1's misleading source-line-fraction geometry and round 2's future-bar
  reservation.
- Give the frontmatter card its exact source range. Assign a change with no
  rendered element to the nearest source-mapped block, falling back to the
  article only when no such block exists, and style that approximate mark as
  hollow/dashed.
- Keep additions visible but non-reviewable as before. Mark clicks and header
  arrows resolve modified/deleted hunks through the complete anchor mapping;
  clicking a shared block chooses its nearest reviewable mark. A hunk crossing
  siblings is owned once by the innermost block containing its first changed
  line. Navigation uses the actual rail mark vertically, then reveals both the
  mark and popup header inside the scroll pane.

## Results

### Round 3

- Independent round-2 verification confirmed compact geometry and prior
  ownership/fallback behavior, but found global source-order inversion from
  pre-reserved future single bars, invisible late popups in a 120-mark stack,
  and duplicate ownership when one hunk crosses sibling blocks.
- Red proof against round-2 geometry passed 31 and failed 3 of 34 E2E tests
  with 338 assertions: the early stack appeared at y=1,527 rather than y=105,
  hunk 119's mark and popup header were both invisible at `scrollTop=0`, and a
  sibling-spanning hunk rendered two marks.
- The unified sweep placed competing stacks at y=105–167, the early 30-mark
  stack at y=105–343, and the later full-height bar at y=345. Forward and
  reverse navigation to hunk 119 placed its mark at y=607–613 and popup header
  at y=620–648.25 inside the y=81–800 pane. The cross-sibling fixture measured
  one header change, one mark owned by the first list item, and a 6 px popup
  gap. Wrap retained nine ordered dense marks; SSE re-render retained those and
  added the tenth in source order.
- The released guide fixture remained exactly `(x,y,h)` `(290,302,55)`,
  `(290,367,21)`, `(290,442,21)`. Final checks are recorded in the DEVLOG.
- Final gates: `bun run check` clean; `bun run test` 144/0 with 424
  assertions; `bun run test:e2e` 35/0 with 377 assertions.

### Round 2

- Independent verification confirmed ownership, navigation, frontmatter, and
  fallback behavior, but found two release-blocking geometry cases: nine marks
  overlap inside a 24 px paragraph and intercept one another's clicks, while
  source-line fractions produce ~850 px marks far from short edits around a
  heavily wrapped middle line.
- Red proof on round-1 geometry: in one E2E run the dense fixture failed
  pairwise separation (`bottom 111 > next top 107.328125`) and the uneven
  fixture's first mark was 1,408 px taller than the required 6 px compact mark.
- The compact implementation measured nine non-overlapping dense bars from
  y=105 through y=175 and two uneven bars at y=123–129 / 131–137 inside a
  4,242 px wrapped block. Coordinate hit-testing, real center clicks, popup
  indices, and unique diff text all matched 9/9, 2/2, and the original 8/8.
- Final round-2 verification: `bun run check` clean; `bun run test` 144/0
  with 424 assertions; `bun run test:e2e` 30/0 with 279 assertions across its
  two mandated invocations.

### Round 1

- Historical red test on the unfixed renderer: `7 changes` in the header but
  only 3 rail marks. The fixture subsequently added the no-output HTML-comment
  hunk, so the current regression's released-code red is `8 / 3`; the earlier
  `7 / 3` result is superseded rather than a second final fixture.
- Final fixture covers 8 separated changes: frontmatter, an HTML comment with
  no rendered output, and first/last edits in one paragraph, list item, and
  fence. Chromium measured 8 marks at one x, distinct pair positions, direct
  mark-to-popup indices 0–7, and an arrow cycle 0…7→0. A legacy single-change
  list-item mark retained the block's exact 21 px height.
- `bun run check` passed; `bun run test` passed 144 tests / 424 assertions;
  `bun run test:e2e` passed 28 tests / 230 assertions across its two mandated
  invocations.
- ARCHITECTURE.md, CHANGELOG.md, and docs/DEVLOG.md describe the final model.
