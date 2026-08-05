# Issue #25 fix round

Status: fifth fix round complete (2026-08-05)

## Fifth fix round

1. Replace the distance-boundary E2E oracle with measured visible-content
   continuity regressions on both sides of the semantic boundary and for the
   viewport-tall-final-line visible/hidden pair; run them against the round-four
   classifier and record the expected red result.
2. Classify a wrap toggle as bottom-anchored only when the last meaningful
   logical code line or rendered Markdown block intersects the viewport;
   preserve the stored end gap inside that case and retain START, clamping,
   sticky exclusion, popup closure, resize handling, and logical top anchoring.
3. Drive Chromium probes from `/tmp/adv-review/` to capture before/after visible
   logical-line ranges and overlap for the 699 px and 739 px cases, the
   viewport-tall-final-line pair, and the behaviors retained from rounds 2–4.
4. Update ARCHITECTURE, CHANGELOG, DEVLOG, and this plan with the visible-end
   rule, measured results, and honest completion state.
5. Run `bun run check`, `bun run test`, and `bun run test:e2e` separately;
   audit documentation, changed-file scope, other worktrees, and uncommitted
   state.

Fifth-round outcome: the end-relative anchor now applies only while the final
meaningful logical line/block intersects the live viewport. At the measured
719 px reader, the former distance boundary's 699 px case retained lines
188–196 from 188–225 and its 739 px case retained 186–194 from 186–223 (9
shared lines on each side). With an 80-line lead and viewport-tall final line,
a visible 21 px-gap final line remained visible with `endGap 21 → 21`; when the
final line was absent at 699 px, lead lines 9–46 remained unchanged (38 shared).
The focused content-continuity tests failed 0/2 under the fourth-round
classifier, then passed 2/2 with 30 assertions after the change. Final gates:
`bun run check` passed, `bun run test` passed 67/67 with 194 assertions, and the
clean `bun run test:e2e` replay passed 21/21 with 155 assertions.

## Fourth fix round

1. Add red Chromium regressions at measured end gaps of 0.9× and 1.1× line
   height plus a half-viewport gap, asserting bounded end-relative movement.
2. Replace the one-line EOF bucket with a bottom-region anchor that preserves
   the reader's measured end-relative position within one viewport of EOF;
   retain START for no-overflow and top-line anchoring outside that region.
3. Measure 0.5×, 0.9×, 1.1×, and 1.5× line-height gaps plus the 706 px control
   in Chromium, and replay the round-two/three anchor edge cases.
4. Update ARCHITECTURE, CHANGELOG, DEVLOG, and this plan with the implemented
   boundary, measured results, and final behavior.
5. Run `bun run check`, `bun run test`, and `bun run test:e2e` separately;
   audit documentation, changed-file scope, other worktrees, and uncommitted
   state.

Fourth-round outcome: positions within one reader viewport of EOF now preserve
their measured end gap instead of collapsing to a binary EOF anchor; positions
outside that region retain the logical top anchor. Chromium restored measured
0.5×/0.9×/1.1×/1.5× line-height gaps as 10→10, 17→17, 21→21, and 29→29 px.
With a 639 px viewport, the 706 px control retained logical line 193 at a 17 px
top offset. File START, no-overflow START, exact EOF, sticky-heading exclusion,
and the viewport-tall fence all retained their earlier behavior. Final gates:
`bun run check` passed, `bun run test` passed 67/67 with 194 assertions, and
`bun run test:e2e` passed 20/20 with 137 assertions.

## Third fix round

1. Add red Chromium regressions for a non-overflowing single long line that
   gains overflow when wrapped, near-EOF gaps of 0/1/2 px, and exact file top.
2. Make start win the start/EOF tie when there is no vertical overflow, and
   classify near-EOF using a measured line-height tolerance.
3. Verify positions clearly above the last line still use the logical anchor.
4. Update ARCHITECTURE, CHANGELOG, DEVLOG, and this plan with the precise
   no-overflow and EOF contracts and measured browser results.
5. Run `bun run check`, `bun run test`, and `bun run test:e2e` separately;
   audit documentation, worktree scope, and uncommitted state.

Earlier-round record follows.

Third-round outcome: START now wins the non-overflow start/end tie, EOF uses a
measured line-height tolerance, and positions farther above the end retain a
logical anchor. Chromium measured `scrollTop 0 → 0` while a single wrapped
line's maximum grew `0 → 4,498`; end gaps 0/1/2 all restored to zero; line 148
stayed anchored within 0.5 px from a 706 px end gap. Final verification:
`bun run check` passed, `bun run test` passed 67/67 with 194 assertions, and
`bun run test:e2e` passed 20/20 with 134 assertions.

1. Add measured Chromium regressions for logical viewport anchoring, full-height
   wrapped change marks, six-digit gutter capacity, and useful chip visibility.
2. Preserve a stable code-line or Markdown-block anchor across wrap re-layout.
3. Unify gutter and hanging-indent geometry, extend the documented line-number
   capacity, and make modified/added marks span wrapped rows while keeping one
   deletion wedge.
4. Limit the wrap control to content it can affect and document the choice.
5. Update ARCHITECTURE, CHANGELOG if user-facing wording changes, and add a
   dated DEVLOG addendum with measured results.
6. Run `bun run check`, `bun run test`, and `bun run test:e2e` separately;
   review documentation and mark this plan complete.

Completed 2026-08-05. Chromium measurements and all requested regressions are
recorded in the DEVLOG addendum; checks and both test commands pass.

## Second fix round

1. Add red Chromium regressions for viewport-tall sticky-fence cycling, exact
   EOF in code and Markdown, file-top stability, Markdown block anchoring,
   rapid double-toggle, and a short non-scrolling file.
2. Exclude sticky-only visual intersections from logical anchor selection and
   preserve explicit EOF state after wrap re-layout.
3. Replace the loose ±1-line/full-line-height oracle with same-line geometry
   and a tolerance derived from the measured line height.
4. Re-run the review scenarios and record three-cycle fence offsets, code and
   Markdown end gaps, and any remaining top-of-file displacement.
5. Correct ARCHITECTURE, CHANGELOG, and a dated DEVLOG addendum to match the
   verified anchor contract.
6. Run `bun run check`, `bun run test`, and `bun run test:e2e` separately,
   audit documentation and worktree state, and mark this plan complete.

## Second-round completion review

- Displaced sticky headings are excluded using their section's normal-flow
  offset, so a viewport-tall fence remains the logical intersecting anchor.
- Exact start and EOF states restore zero or the new scroll maximum after
  reflow; code and Markdown both retain `endGap = 0`.
- The browser oracle requires the same logical line within 15% of measured line
  height and covers tall fences, Markdown blocks, EOF, file top, rapid toggles,
  and a short non-scrolling file.
- Three wrap/unwrap fence cycles stayed at 0.25 px; file-top scroll remained
  zero and returned from its natural 14 → 12 px wrap inset to 14 px.
- Final verification: `bun run check` passed; `bun run test` passed 67 tests
  with 194 assertions; `bun run test:e2e` passed 18 tests with 120 assertions.
