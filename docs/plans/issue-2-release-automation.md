# Issue #2: Release automation — npm trusted publishing on tag

Status: complete (1.0.0 released 2026-08-06; workflow verified end-to-end)
Date: 2026-08-06

## Decision: GitHub Actions + npm trusted publishing (OIDC)

Verified against npmjs.com docs (2026-08-06): npm CLI ≥ 11.5.1 (Node ≥
22.14; we use Node 24), workflow needs `permissions: id-token: write`,
provenance is automatic for public repos/packages, cloud-hosted runners only,
and configurations created after 2026-05-20 must explicitly tick at least one
allowed action (`npm publish`). No long-lived tokens anywhere — the right
call after the 2025 npm supply-chain incidents, and the reason we don't use
a granular-token workflow instead.

**Constraint discovered:** a trusted publisher cannot be configured for a
package that has never been published — the settings only appear on an
existing package. Therefore the first release is bootstrapped manually and
the workflow guards for idempotency (skips `npm publish` when the version
already exists on the registry), so the bootstrap and all reruns are safe.

## Plan

1. Write this plan (this file).
2. Add `publishConfig: { "access": "public" }` to package.json (scoped
   packages default to restricted; first publish would otherwise fail).
3. Add `.github/workflows/release.yml`, triggered by `v*` tags:
   - **gates job**: bun install → `bun run check` → `bun run test`
     (unit/integration; e2e stays local — Chromium in CI is issue #29's
     territory and the tag is cut from an already-verified main).
   - **publish job** (needs gates): setup-bun + setup-node (Node 24,
     registry-url), `npm install -g npm@latest` (≥ 11.5.1), bun install,
     version-exists guard via `npm view`, then `npm publish` (OIDC; no
     token; `prepublishOnly` runs `bun run build`).
   - **release job** (needs publish): extract this version's section from
     CHANGELOG.md and create the GitHub Release with those notes.
4. Test the changelog-extraction command locally against a synthetic rolled
   changelog.
5. Update docs/RELEASING.md: the bootstrap sequence, the exact trusted
   publisher registration values, and the steady-state release steps.
6. Close out: mark this plan complete; no CHANGELOG entry (release tooling
   only, not user-facing — same call as #16).

## Bootstrap sequence (first release only, owner actions marked ●)

1. Land this workflow on main.
2. Roll CHANGELOG + `npm version X.Y.Z` (see RELEASING.md).
3. ● `npm publish` locally (Node ≥ 24; `--access public` is covered by
   publishConfig). Package now exists on the registry.
4. ● On npmjs.com → package → Settings → Trusted publisher: GitHub Actions,
   org `talkasab`, repository `peruse`, workflow `release.yml`, no
   environment, allowed action **npm publish** (must be ticked explicitly).
5. `git push --follow-tags`. The workflow runs: gates pass, publish is
   skipped (version exists), the GitHub Release is created from the
   changelog. Every subsequent release is steps 2 + 5 only.
