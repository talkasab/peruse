# Issue #23: Sanitize rendered Markdown HTML

Status: Complete
Date: 2026-08-02

## Goal

Prevent file-controlled Markdown and derived HTML from executing active content
when inserted into the peruse UI, while preserving the HTML and generated markup
that legitimate Markdown rendering relies on.

## Plan

1. Audit every `innerHTML` assignment in `web/app.js`, trace whether any portion
   is file-controlled, and record which insertion paths require sanitization or
   are already protected by escaping/library-generated markup.
2. Verify current DOMPurify behavior and configuration against primary sources,
   then add it as a bundled client dependency and centralize the peruse-specific
   sanitization policy, including removal of Alpine directives.
3. Apply sanitization at every file-controlled rendered/derived HTML insertion
   point without changing the server dependency boundary.
4. Add focused tests for hostile raw HTML and Alpine directives, plus regression
   coverage for details/summary, common inline HTML, images and badges, task-list
   checkboxes, heading anchors, footnotes, and Shiki classes/inline styles.
5. Evaluate a CSP in `server/index.js` as defense in depth. Add one only if a
   tested policy preserves Alpine, Shiki dual-theme styles, application assets,
   raw images, SSE, and other existing behavior; otherwise document why it was
   deliberately omitted.
6. Update `ARCHITECTURE.md`, the `[Unreleased]` section of `CHANGELOG.md`, and
   the dated narrative in `docs/DEVLOG.md` as implementation findings settle.
7. Run the build, unit/integration suite, and Chromium E2E command. Report an
   unavailable Chromium binary plainly if the E2E suite cannot launch.
8. Review all affected documentation against the final implementation, update
   this plan with the audit and verification results, and mark it complete.
9. Add a self-contained Chromium regression test using the verified live XSS
   proof-of-concept: its own fixture, server, browser page, attack assertions,
   and legitimate-rendering assertions. Run it against the fixed client and
   verify it is a meaningful positive control against the unsanitized path.
10. File a GitHub issue documenting the independently reproduced shared-page
    E2E harness race, without changing that harness as part of issue #23.
11. Re-run unit/integration coverage and the new browser test, update the
    testing architecture and dev log, then review this plan and mark it complete.

## Findings and verification

- `innerHTML` audit:
  - Markdown output is file-controlled through raw HTML and highlighted fences;
    the entire rendered article is now sanitized.
  - Code view output is derived from file content through Shiki (or escaped
    plain rendering for large files); the complete output is now sanitized.
  - Diff popup output is derived from file paths and hunk content through
    diff2html; initial popup construction and unified/split replacement are now
    sanitized.
  - Frontmatter values and binary-card filenames are HTML-escaped, and raw image
    and download paths are URL-encoded. Their static card insertion paths do not
    accept file-controlled HTML. Empty-string assignments contain no content.
- DOMPurify 3.4.12 defaults preserve all required constructs. A focused hook
  additionally strips Alpine's executable `x-*`, `@*`, and `:*` directives.
  jsdom 30.0.1 supplies a current DOM implementation for unit tests; it is a
  test-only dev dependency and is not bundled into the client.
- The hostile fixture proves removal of `onerror`, SVG `onload`, scripts,
  iframe/object/embed content, `srcdoc`, active raw-HTML URLs, and Alpine
  directives. The positive fixture uses the actual Markdown plugins and Shiki
  highlighter, preserving the required HTML, task inputs, anchors, footnotes,
  classes, and inline styles unchanged. A separate assertion confirms
  markdown-it already rejects `javascript:` Markdown link destinations.
- CSP was considered but not shipped. Alpine requires `unsafe-eval`, Shiki
  requires inline styles, badges require external images, and SSE requires
  same-origin connections. The browser regression follow-up remained test-only
  and did not expand #23 into a new HTTP policy.
- `test/e2e/sanitize.test.js` now exercises the fix in Chromium with its own
  temp fixture, server, and fresh page. It asserts that the confirmed image and
  Alpine attacks do not execute or capture `/raw/secret.env`, active attributes
  are absent, required README constructs remain live, Shiki styles survive, and
  the page raises no errors. SVG `onload` remains in the fixture as sanitizer
  input but is not claimed as an execution control because it did not fire in
  the vulnerable build.
- Positive control: after backing up `web/app.js`, temporarily bypassing only
  the Markdown sanitization call made the browser regression fail with
  `result.pwned === true`. The exact source hash was restored, the client was
  rebuilt, and the test returned to green with no status drift.
- Filed https://github.com/talkasab/peruse/issues/26 for the independently
  reproduced shared-page/hashchange E2E harness race. No harness fix is included
  in this work.
- Verification:
  - `bun run build`: passed.
  - `bun run test`: 57 passed, 0 failed.
  - `bun test test/unit test/integration`: 57 passed, 0 failed after adding the
    browser regression.
  - With `PERUSE_CHROMIUM` set to the installed build 1232 binary,
    `bun test test/e2e/sanitize.test.js`: 1 passed, 0 failed (14 assertions).
  - The known core E2E harness flakiness remains tracked in issue #26 rather
    than being changed or masked as part of #23.
- Documentation review completed: `ARCHITECTURE.md`, `CHANGELOG.md`, and
  `docs/DEVLOG.md` describe the final behavior and verification limits.
