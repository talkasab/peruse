# Issue #18 fix round

Status: third fix round complete (2026-08-05)

Third-round plan:

1. Add newline-terminated and unterminated boundary cases at 3,500 and 3,501
   logical lines, plus a cheap CRLF case, and confirm the terminated-at-limit
   assertion fails against the current counting expression.
2. Replace the split-based count with the smallest shared logical-line helper
   that ignores one LF or CRLF terminator, preserving the `.svx` 3,500 and
   generic 10,000 limits.
3. Add focused grammar/browser coverage proving CSS, SCSS, and PostCSS style
   bodies are colorized while an unsupported `less` body remains plain without
   disrupting surrounding mdsvex highlighting.
4. Correct ARCHITECTURE, CHANGELOG, DEVLOG, and this plan so the supported
   style-language set and newline-independent “over the limit” behavior are
   explicit; retain the issue wording because it promises only supported
   preprocessors.
5. Run `bun run check`, `bun run test`, and `bun run test:e2e` separately;
   audit documentation, changed-file scope, unchanged HEAD, and other
   worktrees.

Third-round outcome:

- One shared helper now ignores exactly one terminal LF or CRLF when applying
  both the 3,500-logical-line `.svx` limit and generic 10,000-logical-line
  limit. The browser fixture covers terminated and unterminated 3,500/3,501
  shapes; unit cases add CRLF and both configured thresholds.
- The terminated 3,500-line browser case failed against the old expression
  with an unexpected fallback notice, then highlighted after the fix. Both
  3,501-line shapes continue to render plain.
- CSS, SCSS, and PostCSS bodies are verified as colorized in both themes;
  LESS remains the default foreground without disrupting surrounding Markdown
  expressions or Svelte tags. Documentation now names only that supported set.
- Final verification: `bun run check` checked 32 files; `bun run test` passed
  103/103 with 281 assertions; `bun run test:e2e` passed 16/16 with 82
  assertions when invoked separately as required.

Second-round plan:

1. Reproduce the split-build lifecycle defects from the verification report
   and capture main's single-bundle build layout as the differential baseline.
2. Restore the main build command and eager mdsvex/Svelte registration while
   preserving the verified grammar rules and 3,500-logical-line cutoff.
3. Make checkout freshness scanning recursive over `web/`, with a focused
   nested-mtime regression if the existing server seam can express it without
   disproportionate scaffolding.
4. Replace lazy-chunk assertions with eager grammar/browser coverage; build
   twice and compare the resulting `dist/` structure with main.
5. Measure eager raw/gzip bundle cost and cold/warm 3,500-logical-line rendering, then
   update ARCHITECTURE, CHANGELOG, DEVLOG, and this plan with the honest result.
6. Run `bun run check`, `bun run test`, and `bun run test:e2e` separately;
   audit documentation, repository scope, and uncommitted state.

First-round record follows.

1. Reproduce TOML-frontmatter, Markdown-autolink, and near-limit `.svx`
   failures with deterministic tokenizer/browser measurements.
2. Add regression fixtures and tests for TOML, URL/email autolinks, multiline
   tags, deep nesting, and the selected `.svx` fallback boundary.
3. Correct the composite grammar and implement the smallest safe `.svx`
   tokenization cutoff, measuring both themes and near-boundary latency.
4. Evaluate the installed Shiki lazy-loading API; lazily register mdsvex,
   Svelte, and TOML on first `.svx` view when practical, otherwise document
   the measured eager cost.
5. Update ARCHITECTURE, CHANGELOG, and a dated DEVLOG addendum to reflect the
   actual rule set, loading behavior, cutoff, and measurements.
6. Run `bun run check`, `bun run test`, and `bun run test:e2e` separately;
   review documentation, audit the worktree, and mark this plan complete.

Completed with a 3,500-logical-line mdsvex boundary, lazy split grammar chunks, direct
scope/timing probes, and browser geometry/colour checks. Final verification:
`bun run check` passed, `bun run test` passed 99/99, and `bun run test:e2e`
passed 16/16.

Second-round outcome: the split/lazy build was deliberately removed in favor
of main's deterministic single bundle and eager grammar registration. Nested
`web/` freshness is recursive and regression-tested. Two builds were
byte-identical and matched main's five-file `dist/` layout; no `dist/chunks`
remains. Final gates passed: `bun run check`; `bun run test` 100/100 with 257
assertions; `bun run test:e2e` 16/16 with 78 assertions.
