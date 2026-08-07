# Issue #35 — Running version indicator

Status: Complete after review fixes (2026-08-06)

## Plan

1. Record this plan after reading the repository contracts and complete issue design; keep it synchronized with implementation, measurements, and final documentation.
2. Add red integration coverage for the `/api/projects` version field, plus focused resolution tests for clean and dirty checkout timestamps, packaged non-Git layouts, and Git-command failure.
3. Resolve peruse's package root from `server/index.js`, read that root's package version, and compute the display string once during server startup. Clean checkouts use the HEAD commit timestamp; dirty checkouts use the newer of HEAD and Git-reported modified/untracked file mtimes, through the existing bounded Git subprocess conventions and only against that source root.
4. Carry the cached version through `/api/projects`, render a subdued landing version, expose it as project-page brand hover text, and print it once in CLI startup output.
5. Drive Chromium to verify the landing value matches the payload and the project brand title without changing the document-title contract; measure visual hierarchy and responsive containment.
6. Update ARCHITECTURE.md, CHANGELOG.md, docs/DEVLOG.md, and this plan with the final behavior and evidence.
7. Run `bun run check`, `bun run test`, and `bun run test:e2e` separately; audit the diff, worktree boundaries, HEAD, and no-commit state before marking this plan complete.

## Review-fix plan

1. Replace the landing version's low-contrast token with a subordinate Catppuccin text token that measures at least 4.5:1 against the landing background in both Latte and Mocha.
2. Add a Chromium regression that computes the rendered foreground/background contrast in both themes and requires at least 4.5:1.
3. Add the owner-directed mid-flight design history to the DEVLOG: the discarded Git-describe/SHA form, the cross-machine staleness goal, and the fresh-clone mtime trap that led to commit-time/dirty-mtime timestamps.
4. Sweep changed implementation, tests, and issue-35 documentation for stale SHA-era behavior or wording.
5. Run the three required gates separately, record final measurements and totals, then audit scope and return this plan to complete.

## Decisions

- The landing version is informational metadata, rendered as a small muted monospace line after the project list so it remains subordinate to the landing content.
- Project pages reuse the existing brand link and expose the version only through its `title`; `document.title` remains exclusively hostname/project context.
- Checkout timestamps are compact UTC seconds. A clean checkout trusts the
  commit epoch rather than clone-sensitive filesystem mtimes; a dirty checkout
  considers only Git-reported paths and uses `lstat` so a changed symlink cannot
  substitute its target's timestamp.

## Results

- Review red proof: the new computed-style contrast regression failed against
  round one at 2.3015:1 in Latte (0/1; 5 assertions reached). After switching
  only the color token, Chromium measured 5.5298:1 in Latte and 9.2625:1 in
  Mocha while retaining the 11 px subordinate type and existing placement.
- Red payload proof: the focused landing/API integration test received
  `undefined` instead of the required `v…` string (0/1; 4 assertions reached).
- Deterministic resolution fixtures produced
  `v9.8.7-dev.20260806200000` (clean commit),
  `v9.8.7-dev.20260806210144-dirty` (newest reported path mtime), `v4.5.6`
  (non-Git package), and `v7.8.9 (dev)` (checkout Git failure).
- Three payload requests returned one identical cached checkout value after
  only the startup `log` and `status` calls. Chromium matched landing and brand
  values to the payload/server, retained the hostname/project document title,
  and measured the 11 px landing metadata 18 px after the final card with no
  overflow at 1280 or 320 px.
- Final gates: `bun run check` passed across 40 files and both TypeScript
  projects; `bun run test` passed 151 tests with 447 assertions across 20
  files; `bun run test:e2e` passed 46 Chromium tests with 497 assertions across
  five files and the required three isolated Bun invocations.
