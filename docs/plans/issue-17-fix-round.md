# Issue #17 fix round

Status: readiness-settlement fix round complete (2026-08-05)

## Readiness-settlement fix round

1. Add a red integration regression using the ENOTDIR stalled-scan fixture:
   close the runtime while a request awaits readiness, require prompt request
   completion, and independently bound the unhandled-rejection assertion.
2. Reject pending readiness with a distinguishable runtime-closed error from
   `close()`, while pre-attaching a rejection observer for the zero-waiter case.
3. Audit every readiness await/continuation in `server/index.js` so closure
   becomes a clean 404 or retry signal and cannot serve a closed runtime.
4. Update ARCHITECTURE, DEVLOG, and this plan with the detectable-settlement
   invariant and measured formerly-hanging path; leave CHANGELOG unchanged
   unless branch-local user behavior changes.
5. Run `bun run check`, `bun run test`, and `bun run test:e2e` separately;
   audit docs, changed-file scope, unchanged HEAD, and other worktrees.

Outcome:

- `close()` rejects pending readiness with a typed closure signal and a
  permanent rejection observer; request resolution maps only that signal to
  not-found and rejects the fulfilled-then-closed race through a state check.
- The ENOTDIR teardown regression exceeded its 1 s request deadline before the
  fix. Afterward it returned HTTP 404 in 4.94 ms with no unhandled rejection;
  the full regression completed in 315 ms including its deliberate 300 ms
  stalled-scan window.
- Final verification: `bun run check` checked 31 files; `bun run test` passed
  80/80 with 219 assertions; `bun run test:e2e` passed 11/11 with 54 assertions
  when invoked separately as required. The first e2e invocation reported
  shared-page errors in one test and passed unchanged on the prescribed rerun.
- ARCHITECTURE and DEVLOG now state the readiness-settlement invariant.
  CHANGELOG remains unchanged in this round because the user-visible
  invalidation behavior depends on issue #28's cache lifecycle.

Documentation correction, 2026-08-05: the production FIFO result remains
valid, but the claimed raw-chokidar contrast did not survive independent
Bun/Node matrix verification. ARCHITECTURE, fixture rationale, and DEVLOG now
record that raw chokidar reaches `ready` with a pre-existing FIFO in the tested
environment; issue #20 retains the disproved older narrative and needs a
separate issue update by the session lead. The general timestamp-preserving,
metadata-identical rewrite limitation is also documented.

1. Add red integration regressions for atomic rename-over saves, poisoned
   subtrees introduced after recovery, fallback watch-budget exhaustion,
   vanished recovery directories, and bounded per-assertion SSE waits.
2. Replace filename-forwarding fallback behavior with guarded directory
   snapshot reconciliation and coalesced path emission.
3. Reuse one admission/budget policy for chokidar and fallback coverage, and
   make post-recovery poisoned-subtree detection repeatable and idempotent.
4. Exercise a deliberately delayed live scan when feasible; otherwise make
   overlapping late completion harmless and document the 3-second heuristic.
5. Reproduce the FIFO behavior directly and align server comments,
   ARCHITECTURE, CHANGELOG, and a dated DEVLOG addendum with measured behavior.
6. Run `bun run check`, `bun run test`, and `bun run test:e2e` separately;
   audit documentation and worktree state, then mark this plan complete.

Outcome:

- Fallback events now reconcile guarded directory snapshots; atomic
  rename-over saves identify the replaced path and vanished directories are
  harmless.
- Recovery rechecks new directories, shares chokidar's admission budget, and
  suppresses overlapping direct chokidar events. A deliberately blocked
  chokidar filesystem call was not injected because doing so would require a
  production watcher seam solely for the test; idempotence is instead enforced
  structurally by one fallback handle per directory and one event owner per
  direct path, while the heuristic limitation is explicit in ARCHITECTURE.
- Verification: `bun run check` passed; `bun run test` passed 79/79 with 213
  assertions; `bun run test:e2e` passed 11/11 with 54 assertions. The focused
  recovery suite passed 12/12, and the standalone FIFO server probe returned
  HTTP 200.
