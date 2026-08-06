# Issue #33: Contextual page titles

Status: Complete after independent-review fixes (2026-08-06)

## Plan

1. Record this plan after reading the repository guidance, architecture, issue decision, and relevant server/client/test paths.
2. Add an end-to-end regression covering the pre-data title, landing page, project opening, switcher navigation, and return to landing; run it against the unfixed client to capture red evidence.
3. Add the server hostname to `/api/projects` and update the title when that payload establishes the current project context, including missing project routes.
4. Measure every required title transition in Chromium and run `bun run check`, `bun run test`, and `bun run test:e2e` as separate commands.
5. Update ARCHITECTURE.md, CHANGELOG.md, docs/DEVLOG.md, and this plan with the final contract and results; audit the diff, worktree scope, and commit state.
6. Add red regressions for worktree route-name titles and same-tick final-selection
   wins, then fix the inherited switcher guard by tracking the latest requested
   route.
7. Add a hostname-titled minimal HTML response for unavailable project-page
   routes and cover the real server 404.
8. On a project EventSource failure, refresh `/api/projects` once, recompute
   switcher/title context without navigating, and cover live project removal
   without introducing a retry loop.
9. Re-run the required gates separately, measure all four review scenarios,
   reconcile architecture/changelog/devlog claims, and complete this plan only
   after the final diff and repository-boundary audit.

## Decisions

- Keep the focused regression in the existing isolated project-switcher E2E
  process. Its fixture exposes the registered names directly, and a delayed
  `/api/projects` response makes the pre-data state deterministic.
- Capture `os.hostname()` once when the server module initializes and expose it
  beside `projects`. Retain it in Alpine state so both initial context setup and
  switcher changes use one title formatter.
- Treat only a present, non-missing listing entry as project context. This
  gives stale or unavailable project routes the landing-title fallback.
- Use `routeName` in titles so linked worktrees retain parent context. Track
  the latest requested switcher route separately from the page's initial route
  so same-tick changes are last-selection-wins; the faulty guard predates this
  branch and is present on main at `fd227a9`.
- Keep unavailable project API responses plain, but return a minimal
  hostname-titled HTML 404 for the unavailable page route. On EventSource
  failure, refetch project context at most once until a successful reconnect;
  update title/switcher state without navigating or clearing rendered content.

## Results

- Red proof on the static client failed the first resolved landing assertion:
  expected `peruse - oidm-dev`, received `peruse` (0 passed, 1 failed; 3
  assertions reached).
- Chromium measured `peruse` before project data, `peruse - oidm-dev` on the
  landing page, `peruse - oidm-dev - alpha` after opening a project,
  `peruse - oidm-dev - beta` after the switcher changed projects,
  `peruse - oidm-dev - topic` after selecting its linked worktree, and
  `peruse - oidm-dev` after returning home. No measured title contained
  `undefined` or `null`.
- `/api/projects` exposes the server hostname and the client formats titles
  only after it is known. A selected route absent from the listing uses the
  landing form.
- Final verification: `bun run check` checked 37 files with both typecheck
  targets clean; `bun run test` passed 144/144 with 425 assertions; and
  `bun run test:e2e` passed 35/35 with 385 assertions.
- Documentation review updated the payload schema and client contract in
  ARCHITECTURE.md, the user-facing CHANGELOG entry, this dated DEVLOG entry,
  and this completed plan.

## Independent-review fix results

- Worktree red check: the route-name expectation waited for
  `peruse - oidm-dev - beta:topic` but round 1 retained `topic` (0 passed, 1
  failed, 5 assertions reached). Rapid-switch red check: from beta, same-tick
  alpha → beta ended at `/p/alpha/` (0 passed, 1 failed, 6 assertions reached).
- Final Chromium values were `peruse - oidm-dev - beta:topic` for the worktree
  and `peruse - oidm-dev - beta` at `/p/beta/` after the rapid flip. The real
  unavailable route returned status 404, title `peruse - oidm-dev`, and body
  `project not found`.
- Removing the open alpha project caused exactly one client `/api/projects`
  refresh. The alpha option disappeared and the title became
  `peruse - oidm-dev`, while URL `/p/alpha/` and rendered Alpha content stayed
  in place; a 1.5 s repeated-404 observation added no second refresh.
- Final verification: `bun run check` checked 37 files with both typecheck
  targets clean; `bun run test` passed 144/144 with 428 assertions; and
  `bun run test:e2e` passed 35/35 with 395 assertions (1/19 isolated switcher,
  34/376 main Chromium invocation).
- Final documentation, diff, worktree-boundary, no-debug-marker, and no-commit
  audits completed after the expanded regressions passed.
