# CLAUDE.md

peruse is a lightweight local directory viewer web server. Read DESIGN.md
before making changes — it is the source of truth for architecture decisions.

## Core principles (from the original design conversation)

- **Minimum code, maximum leverage.** Assemble best-in-class libraries
  (markdown-it, Shiki, diff2html, chokidar, Alpine); if you find yourself
  writing a lot of code, question the approach. Total budget ~900 lines.
- **Bun-native.** Use Bun built-ins (Bun.serve, Bun.file, Bun.spawn,
  bun build) instead of adding dependencies. chokidar is the only allowed
  server dependency (Bun's native watcher drops events — see DESIGN.md §3).
- **Never a whole-page diff view.** Change indication is subtle gutter marks;
  clicking expands that individual hunk's diff inline, in place. This is a
  core interaction principle, not a styling detail.
- **Catppuccin only**: Latte (light) / Mocha (dark), via @catppuccin/palette
  CSS variables and Shiki's bundled catppuccin themes, dual-theme CSS trick.
- Plain ESM JavaScript, no TypeScript compile step; JSDoc types where useful.
- Read-only tool: peruse never writes to the directory it serves.

## Publishing

npm name `peruse` is squatted → publish as `@talkasab/peruse`, bin `peruse`.
Standalone binaries via `bun build --compile` attached to GitHub releases.

## Open questions

None — all DESIGN.md §8 questions are resolved (see there for the answers):
gitignored files shown-but-dimmed with a hide toggle, diff baseline is
worktree-vs-HEAD only, Mermaid/KaTeX deferred to v1.1, non-git directories
degrade gracefully without a warning.
