# Release process

Versioning: [SemVer](https://semver.org/). Changelog:
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), maintained
continuously — every user-facing change lands with an entry under
`[Unreleased]` in [CHANGELOG.md](../CHANGELOG.md).

To cut a release:

1. Roll the changelog: rename `[Unreleased]` to `[X.Y.Z] - YYYY-MM-DD`,
   add a fresh empty `[Unreleased]` above it, update the link references.
2. `npm version X.Y.Z` (updates package.json, commits, tags `vX.Y.Z`).
3. `git push --follow-tags`.
4. The tag triggers the release workflow (issue #2, once built):
   - `npm publish` via OIDC trusted publishing (no tokens; provenance
     automatic)
   - GitHub Release created with the notes extracted from this version's
     CHANGELOG section.

Distribution is npm only. Compiled standalone binaries were considered and
dropped as a YAGNI violation: at 61 MB each (Bun embeds its runtime), five
platforms would add ~300 MB of assets per release to serve an audience that
already has Bun or Node — `bunx @talkasab/peruse` needs no install at all.

Until #2 lands, steps 4's pieces are run by hand (`npm publish` from a
Node ≥ 24 environment; `bun run build` first is handled by
`prepublishOnly`).
