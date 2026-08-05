# Issue #28 fix round

Status: fourth fix round complete (2026-08-05)

## Fourth fix round

1. Add three bounded red lifecycle regressions: shutdown during a delayed
   runtime start, shutdown during a detached delayed close, and two concurrent
   close callers observing the same teardown completion.
2. Make shutdown own `runtimeStarts` and every detached close promise; prevent
   starts completed after shutdown begins from entering `runtimes`, closing
   their produced runtime instead.
3. Preserve the merge-order contract: do not add readiness settlement here,
   and keep runtime teardown structured so #17's typed closure rejection can
   land without conflict.
4. Correct ARCHITECTURE's exact timers → controllers → watcher ordering and
   shutdown ownership; add a dated DEVLOG correction and make this plan's
   lifecycle completion claim conditional on the new regressions.
5. Run `bun run check`, `bun run test`, and `bun run test:e2e` separately;
   audit documentation, changed-file scope, unchanged HEAD, and other
   worktrees.

Fourth-round outcome:

- Runtime close now returns one memoized teardown promise. Its ordering is
  timers, SSE controllers/client-set clearing, then awaited watcher close;
  invalidation and supersession register detached promises until settlement.
- `stop()` marks lifecycle state stopped, force-closes HTTP, and drains pending
  starts, mapped runtimes, and close promises until all are empty. A start that
  completes during shutdown closes its runtime before resolving and never maps
  it.
- All three regressions were red against the former lifecycle: delayed-start
  and detached-close stops fulfilled inside 75 ms, while direct double-close
  returned a distinct settled promise. They are green with exactly one watcher
  close each and independent 1.5 s deadlines.
- Readiness settlement is intentionally unchanged so issue #17's typed
  `RuntimeClosedError` contract can land first; the combined pending-ready
  invalidation regression remains a merge-phase responsibility.
- Final verification: `bun run check` checked 31 files; `bun run test` passed
  92/92 with 295 assertions; `bun run test:e2e` passed 11/11 with 54 assertions
  when invoked separately as required. CHANGELOG needed no expansion for this
  internal shutdown guarantee.

## Third fix round

1. Add a red integration regression that opens a real SSE response, removes
   the registered project through the CLI against a 60-second enumeration
   cache, triggers invalidation, and requires the stream to reach EOF.
2. Make runtime teardown terminate and forget every SSE client, and re-verify
   the mapped runtime and target after awaiting watcher readiness.
3. Reconcile enumerated route names against their target paths/identities,
   closing reused-name mismatches through the same teardown path; add a cheap
   collision-suffix reassignment regression if the fixture permits it.
4. Update ARCHITECTURE, CHANGELOG, DEVLOG, and this plan with teardown,
   reconnection, reconciliation, and measured verification behavior.
5. Run `bun run check`, `bun run test`, and `bun run test:e2e` separately;
   audit documentation, worktree scope, unchanged HEAD, and the honest
   100/134 → 20/54 enumeration/total-spawn measurement.

Third-round outcome: runtime teardown now closes and clears every SSE client;
the real-CLI invalidation regression reaches EOF instead of timing out. Route
listing compares the runtime's captured target path/identity with the newly
enumerated target, and a constructed collision-suffix reassignment closes the
former route's stream. Resolution coalesces runtime startup and re-verifies the
registry identity, exact mapping, and target incarnation after readiness. The
realistic measurement remains 100/134 enumeration/total Git spawns without
settled reuse and 20/54 with the default cache. Final verification:
`bun run check` passed; `bun run test` passed 89/89 with 281 assertions; and
`bun run test:e2e` passed 11/11 with 54 assertions.

1. Add red-capable regression coverage for in-flight TTL coalescing, stable registry identity keys, monotonic timing, strict environment parsing, stale worktree identity, and the realistic browser-request sequence.
2. Correct enumeration caching and route validation, then run the focused regression loop until green.
3. Re-measure enumeration and total Git spawns for the realistic 10-repository sequence.
4. Update ARCHITECTURE, CHANGELOG if user-facing behavior changed, and add a dated DEVLOG addendum with the measured result.
5. Run `bun run check`, `bun run test`, and `bun run test:e2e` separately; review documentation and mark this plan complete.

## Completion review

- Pending work now coalesces until settlement, with a monotonic result-time TTL
  and strict environment parsing.
- Canonical project name/path identity drives invalidation, so `lastOpened`
  writes do not trigger duplicate discovery while add/rm/prune still do.
- Cached linked-worktree routes validate private gitdir/branch identity and
  reject replacement directories before runtime reuse.
- The cold realistic 10-repository sequence measured 100 → 20 enumeration Git
  spawns and 134 → 54 total Git spawns.
- ARCHITECTURE and the dated DEVLOG addendum describe the final contract and
  replace the earlier partial-load headline with the measured sequence.
- Final verification: `bun run check` passed; `bun run test` passed 81 tests
  with 247 assertions; `bun run test:e2e` passed 11 tests with 54 assertions
  across its two required isolated invocations.

## Second fix round

1. Add red regressions for registered-root replacement, cached missing-state
   listings, overlay isolation and caller mutation, A/B/A pending coalescing,
   whitespace-padded environment values, and monotonic default-clock behavior.
2. Make cached discovery immutable, retain pending enumerations per identity
   key, and validate both registered-root and linked-worktree incarnations.
3. Align environment parsing and its test table, then replay every scenario
   from the second adversarial report against the focused regression loop.
4. Correct ARCHITECTURE and add a dated DEVLOG addendum covering the actual
   identity boundary, listing refresh, coalescing guarantee, and measurements;
   review CHANGELOG for user-facing accuracy.
5. Run `bun run check`, `bun run test`, and `bun run test:e2e` separately,
   audit all documentation and worktree state, and mark this plan complete.

## Second-round completion review

- Registered Git and non-Git roots and linked worktrees retain private,
  best-effort filesystem incarnation signals; same-path replacements fail
  validation, with the inode-reuse residual documented explicitly.
- Missing state and `lastOpened` are recomputed on isolated per-call copies;
  cached discovery is immutable and caller mutation cannot poison it.
- Distinct pending registry keys coexist until settlement, so A/B/A coalesces
  to two enumerations; the single settled entry and result-time TTL remain.
- Canonical environment parsing rejects padded numeric values, and the suite
  now covers the default monotonic clock under wall-clock rollback.
- The realistic sequence remains 100/134 enumeration/total Git spawns with
  settled reuse disabled and 20/54 with the default cache.
- Final verification: `bun run check` passed; `bun run test` passed 87 tests
  with 272 assertions; `bun run test:e2e` passed 11 tests with 54 assertions.
