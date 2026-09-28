# Issue #48 browser-suite follow-up

1. Record the review's two reproducible test defects and the intended three-process browser command here.
2. Give each SVG security beacon a random URL prefix, assert requests only under that prefix, and close beacons in `afterAll`. Keep the OS-assigned port.
3. Poll for the SVG Source chip to disappear after opening a binary file. Restore the third Bun process to the `dev` file list plus the `.peruseshow` browser file.
4. Run the full browser command three consecutive times. Record each result and exact counts. If it still fails, record the exact failure without splitting processes.
5. Update `docs/DEVLOG.md` with the actual defects and fixes. Review this plan, the dev log, and the user-facing changelog against the final state, then mark this plan complete.

Status: complete. `bun run check` passed (54 Biome files and both TypeScript
projects); `bun run test` passed (186 tests, 638 assertions). Three consecutive
`bun run test:e2e` runs each passed 72 tests, 0 failures, and 708 assertions
across three Bun processes. The dev log reflects the final test fixes. The
user-facing changelog already describes the feature and needs no test-only entry.
