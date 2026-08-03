# Issue #16: Biome and JavaScript type checking

Status: Complete
Date: 2026-08-03

## Goal

Add one Bun-native quality gate for formatting, linting, import organization,
and full-strict JSDoc-aware type checking without introducing a TypeScript
compile step or changing runtime behavior.

## Plan

1. Verify the current Biome 2.x and TypeScript releases and their official CLI
   and configuration guidance, then add the development dependencies and Bun
   scripts specified by issue #16.
2. Add `biome.json`, a Bun/server `tsconfig.json`, and a DOM-only
   `web/tsconfig.json`, excluding generated `dist/` content and leaving HTML
   formatting disabled.
3. Run Biome's writer once, review its mechanical changes, and run it again to
   prove formatting and safe fixes are idempotent.
4. Run the combined quality gate at full strictness. Fix every diagnostic with
   minimal code or JSDoc types; add declaration stubs only for dependencies that
   genuinely lack types, and document any unavoidable suppression inline.
5. Verify `dist/` remains untouched, then run the build, startup smoke check,
   and complete existing test suite.
6. Update `ARCHITECTURE.md` with the development tooling contract and add a
   dated `docs/DEVLOG.md` entry. Do not add a changelog entry because this phase
   changes development tooling only.
7. Review the final diff and documentation, record exact verification results
   here, mark the plan complete, and stop before any issue #3 implementation.
8. Close the test coverage gap with the smallest suitable `checkJs` config,
   fix all proportionate diagnostics, rerun the quality gate and full suite,
   and document the exact type-checking boundaries before marking this plan
   complete again.

## Findings and verification

- Installed Biome 2.5.6, TypeScript 7.0.2, `@types/bun` 1.3.14,
  `@types/alpinejs` 3.13.11, and `@types/markdown-it` 14.1.2. The Biome config
  uses its package-local schema and the current `preset: "recommended"` form.
- Added `lint`, `fix`, `typecheck`, and combined `check` scripts. `dist/` is
  excluded from Biome and has no tracked diff.
- Both TypeScript configs finish at full `strict` with `noImplicitAny: true`.
  JSDoc now documents server/client tree, file, hunk, git, SSE, and startup
  shapes. `web/globals.d.ts` provides only the two missing plugin declarations
  and the Alpine window property.
- Test coverage addendum: a test-scoped config extending the Bun config with DOM
  libraries was tried and removed after it surfaced roughly 200 diagnostics
  across all 12 test files. The errors span test fixture/helper annotations,
  Playwright evaluation globals and DOM assertions, test-only null assertions,
  and Bun-vs-DOM stream conflicts caused by tests importing both server and web
  modules. Fixing that would be a disproportionate test-harness typing effort,
  so `test/` is explicitly excluded from tsc while remaining covered by Biome.
  Production coverage is exact: root tsc checks `bin/` and `server/`; web tsc
  checks `web/*.js` and `web/*.d.ts`.
- Fixed all diagnostics. Runtime-relevant cleanups include safe caught-error
  narrowing, explicit text-content narrowing before hunk generation, numeric
  directory-sort booleans, optional server watcher budget typing, explicit
  button types, and DOM null/subtype checks.
- Exactly three `biome-ignore` comments remain, each explaining an intentional
  CSS `!important` needed for Alpine cloaking or Shiki inline-style overrides.
  There are no `@ts-expect-error` directives.
- Verification:
  - `bun run fix`: passed twice with no fixes on the final tree (idempotent).
  - `bun run check`: passed (Biome plus both full-strict type configs).
  - `bun run build`: passed.
  - Startup smoke: `bun run start . --no-open --port 0` served `/` and
    `/api/tree` successfully.
  - `bun test` with the installed Chromium 1232 executable: 66 passed, 0 failed.
  - `git diff --check`: passed; `dist/` remains untouched in the tracked diff.
- Documentation review completed. `ARCHITECTURE.md` and `docs/DEVLOG.md`
  describe the final tooling; `CHANGELOG.md` is unchanged because this work is
  developer-facing only.
- Phase 2 / issue #3 was not started.
