# CLAUDE.md

peruse is a lightweight local directory viewer web server. Read
ARCHITECTURE.md before making changes — it describes the system **as
implemented** and is the source of truth.

## Documentation system (keep it this way)

- **ARCHITECTURE.md** — the system as built. Update it in the same commit
  as any change to behavior or structure.
- **CHANGELOG.md** — Keep a Changelog format, SemVer. Every user-facing
  change adds an entry under `[Unreleased]` in the same commit. Rolled
  into GitHub release notes at release time (docs/RELEASING.md).
- **docs/DEVLOG.md** — narrative engineering log; add/extend a dated entry
  per work session (what changed, what was learned, why).
- **Future work → GitHub issues.** Never park ideas, backlogs, or specs in
  repo documents; file or update an issue instead.
- **docs/design-history.md** — the original design document; historical,
  do not update.

## Core principles (from the original design conversation)

- **Minimum code, maximum leverage.** Assemble best-in-class libraries
  (markdown-it, Shiki, diff2html, chokidar, Alpine); if you find yourself
  writing a lot of code, question the approach.
- **Bun-native.** Use Bun built-ins (Bun.serve, Bun.file, Bun.spawn,
  bun build); chokidar is the only allowed server dependency.
- **Never a whole-page diff view.** Subtle marks on exactly the changed
  lines/blocks; clicking opens that individual change's diff in a popup
  anchored at the mark. Additions and wholly-new files get marks/badges
  only, no popups. This is a core interaction principle.
- **Catppuccin only**: Latte (light) / Mocha (dark), via @catppuccin/palette
  CSS variables and Shiki's bundled catppuccin themes, dual-theme CSS trick.
- Plain ESM JavaScript, no TypeScript compile step; JSDoc types where useful.
- Read-only tool: peruse never writes to the directory it serves.

## Practices that have paid off here

- Verify UI changes by driving Chromium (Playwright) and **measuring** the
  DOM (positions, counts), not eyeballing; send the user tight crops of
  the relevant region, not full-page screenshots.
- When a bug report contradicts your model, reproduce under the reported
  conditions before theorizing (the fd-exhaustion saga was solved by
  reading /proc fd tables under a simulated ulimit).
- Prove every new regression test RED against the unfixed code before
  trusting it, and have implementation and review done by different
  agents/sessions — green suites repeatedly concealed confirmed defects
  that independent adversarial review then found (60+ across the
  2026-08-05..07 releases).
- A first `bun run test:e2e` invocation can fail with a Bun/Playwright
  pipe stall (subprocess with missing stdout, cascading shared-page
  errors) and pass unchanged on rerun. Rerun the exact command before
  diagnosing; evidence ledger in issue #29.

## Publishing

npm name `peruse` is squatted → publish as `@talkasab/peruse`, bin `peruse`.
Distribution is npm only — `bunx @talkasab/peruse` needs no install. Compiled
standalone binaries were considered and dropped (YAGNI: 61 MB per platform to
serve users who already have Bun). Release steps: docs/RELEASING.md.
