# Release process

Versioning: [SemVer](https://semver.org/). Changelog:
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), maintained
continuously — every user-facing change lands with an entry under
`[Unreleased]` in [CHANGELOG.md](../CHANGELOG.md).

## Cutting a release

1. Roll the changelog: rename `[Unreleased]` to `[X.Y.Z] - YYYY-MM-DD`,
   add a fresh empty `[Unreleased]` above it, update the link references.
2. `npm version X.Y.Z` (updates package.json, commits, tags `vX.Y.Z`).
3. `git push --follow-tags`.
4. The tag triggers `.github/workflows/release.yml`:
   - quality gates (`bun run check`, `bun run test`; the browser suite runs
     locally before tagging, not in CI — see issue #29);
   - `npm publish` via OIDC **trusted publishing** — no tokens, provenance
     automatic, `prepublishOnly` runs the client build. The step verifies the
     tag matches `package.json` and skips publishing if that version already
     exists on the registry (idempotent reruns; bootstrap below);
   - a GitHub Release created from this version's CHANGELOG section.

## One-time bootstrap (first release only)

npm only offers trusted-publisher settings on a package that already exists,
so the first publish is manual:

1. After step 2 above (version committed and tagged, tag not yet pushed):
   `npm publish` locally from a Node ≥ 24 environment. `publishConfig` in
   package.json makes the scoped package public.
2. On npmjs.com → `@talkasab/peruse` → Settings → Trusted publisher →
   GitHub Actions: organization `talkasab`, repository `peruse`, workflow
   `release.yml`, environment blank. Explicitly tick the allowed action
   **npm publish** (required for configurations created after 2026-05-20).
3. `git push --follow-tags`. The workflow's publish step sees the version
   already on the registry and skips it; the GitHub Release is still created.

Every later release is just "Cutting a release" — no manual publishing.

## Distribution decisions

Distribution is npm only (`bunx @talkasab/peruse` needs no install).
Compiled standalone binaries were considered and dropped as a YAGNI
violation: at 61 MB each (Bun embeds its runtime), five platforms would add
~300 MB of assets per release to serve an audience that already has Bun or
Node. npm name `peruse` is squatted, hence the scope.
