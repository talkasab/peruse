# Issue #3 — Multi-root project serving

Status: complete (Phase 2 and addenda, 2026-08-04)

## Scope and decisions

- Store registered projects in `~/.config/peruse/projects.json`; tests and
  embedders may override the directory with `PERUSE_CONFIG_DIR` or an explicit
  server option so they never touch the real user configuration.
- Keep the public entry fields `path`, `name`, and `lastOpened`. While a path is
  absent, persist an internal `missingSince` timestamp so the automatic grace
  period is measured from the first observed miss instead of from last use.
- Use a 30-day automatic missing-entry grace period. `peruse prune` is the
  explicit override and removes all currently missing entries immediately.
- Derive names from the directory basename. Resolve collisions deterministically
  with `-2`, `-3`, and so on; an already-registered canonical path keeps its
  existing name.
- Discover linked worktrees live with `git worktree list --porcelain`. They are
  transient children of the registered parent and receive collision-safe route
  names derived from `<parent>:<worktree>`; they are never written to the
  registry.
- Serve every project and discovered worktree beneath `/p/<encoded-name>/`.
  The root is the project landing page; static client assets stay at `/`.
- Start each project's chokidar watcher only when that project is first opened.
  Keep watcher clients, ignored paths, and event batching isolated per project.
- Preserve `peruse <path>` by auto-registering the path, starting the same
  multi-root server, and opening that project's `/p/<name>/` URL. With no path,
  open `/`.

## Implementation plan

1. Add a typed registry/worktree module with atomic config writes, canonical
   path registration, collision-safe naming, missing-state tracking, explicit
   pruning, live porcelain parsing, and brief git summaries.
2. Refactor the server around resolved project contexts: global project-list
   API and landing route, encoded project routing, scoped tree/file/raw/SSE
   endpoints, last-opened updates, and lazy isolated watchers.
3. Extend the CLI with `add`, `rm`, `list`, and `prune`; make no-argument startup
   show the landing page and path startup auto-register and open its project.
4. Adapt the client to a landing/project split, fetch scoped APIs, render grouped
   registered projects and worktrees, and place a grouped project switcher on
   every project page.
5. Add focused unit and integration coverage for registry persistence and
   auto-registration, encoded project names, live worktree enumeration, landing
   data/rendering, and explicit/aged pruning. Keep all test config in temporary
   directories.
6. Run and repair `bun run check` and `bun test`, then run the relevant browser
   suite after rebuilding the client.
7. Update `ARCHITECTURE.md`, `CHANGELOG.md` `[Unreleased]`, and `docs/DEVLOG.md`
   to describe the implemented behavior. Review this plan against the final
   state and mark it complete.

## Completion review

- Implemented the registry, all four CLI verbs, no-argument landing page,
  encoded multi-root routing, live grouped worktrees, project dropdown,
  project-scoped lazy watchers, and `peruse <path>` auto-registration.
- Used `missingSince` as private lifecycle metadata and a 30-day automatic
  grace period; explicit `prune` removes currently missing entries immediately.
- Preserved registered subdirectory boundaries across linked worktrees and
  close lazy runtimes when their project/worktree disappears.
- Added the required unit, integration, and rendered-browser coverage with all
  registry writes isolated beneath temporary config directories.
- Updated `README.md`, `ARCHITECTURE.md`, `CHANGELOG.md`, and `docs/DEVLOG.md`.
- Final verification: `bun run check` passed with Biome and both full-strict
  production `checkJs` configs; `bun test` exited successfully with all unit,
  integration, and E2E tests passing.

## Project-switcher selection addendum

1. Add a self-contained Chromium regression with two registered projects and a
   linked worktree, navigate directly to the worktree's colon-bearing route,
   and assert the native select value matches that route name.
2. Confirm the regression fails against option-zero fallback, then bind
   selection on each asynchronously rendered project/worktree option.
3. Run `bun run check` and the full `bun test`, then mark this addendum complete.

Result: the subprocess regression failed before the fix with exit code 1 after
the serving line, then passed after making the opener spawn best-effort. The CLI
now warns and stays alive when the platform opener is missing. `bun run check`
and the full `bun test` both passed afterward.

Result: the Chromium regression failed before the fix with expected
`beta:topic` / received `alpha`, then passed after moving selection binding to
the asynchronously rendered project and worktree options. `bun run check` and
the full `bun test` both passed afterward.

## Missing browser-opener addendum

1. Add a subprocess integration regression that runs the real CLI with an empty
   `PATH`, waits for successful server startup, and asserts a missing platform
   opener does not terminate the process.
2. Make automatic browser launch best-effort while retaining the printed URL
   and the existing `--no-open` opt-out.
3. Run `bun run check` and the full `bun test`, then mark this addendum complete.

## Stabilization addendum (2026-08-04)

E2E flake hunt after Phase 2: fixed peruse's `git status` writing `.git/index`
(`--no-optional-locks`; also a read-only-contract fix) and hardened the suite
against Bun's Playwright pipe-transport stall (landing test on its own page;
centralized `launchBrowser()`); full story in the DEVLOG entry. Complete.

**Superseded 2026-08-05:** auto-open (and `--no-open`) removed entirely —
peruse is remote-first; the CLI prints URLs and never opens a browser. The
empty-`PATH` regression test went with the code path it guarded.

## Code-review fixes addendum (2026-08-05)

Status: complete

1. Add focused unit regressions for non-directory registered roots, removal
   name precedence, and removal through a symlink selector; confirm each test
   fails for the reported reason.
2. Treat non-directory roots as missing before Git discovery and summaries;
   make removal select one exact name first, otherwise compare canonical paths.
3. Run the focused unit suite, `bun run check`, and the full `bun test` suite.
4. Review and update this plan, `CHANGELOG.md`, and `docs/DEVLOG.md` so the
   documentation reflects the verified final behavior.

Result: all three regressions failed for the reported reasons before the fix
and passed afterward. `bun run check` passed, as did all 11 tests through the
repository's isolated E2E pipeline. Two exact all-in-one `bun test` runs passed
all unit and integration coverage but hit the documented Bun/Playwright
combined-process transport stall in different browser tests (75/78 and 77/78),
so that command did not produce a fully green run.
