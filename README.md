# peruse

A lightweight web server for calmly reading a local directory in your browser:
directory tree on the left, beautifully rendered file on the right.

- **GOOD markdown rendering** — GitHub-flavored, with code fences highlighted
  exactly like standalone code files
- **GOOD code rendering** — Shiki (VS Code–quality TextMate highlighting)
- **Git-aware** — status marks in the tree, with a filter for changed/new files
- **Inline hunk diffs** — subtle gutter marks show *where* a file changed;
  click one to expand that individual hunk's diff in place. Never a
  whole-page diff view.
- **Live** — watches the directory and keeps open views up to date as files
  change on disk
- **Catppuccin** — Latte (light) and Mocha (dark), following your system
  preference with a manual toggle

See [DESIGN.md](DESIGN.md) for the full architecture and the survey of
existing tools.

## Usage

```bash
cd some/directory
bunx @talkasab/peruse        # → http://127.0.0.1:7440
```

Or grab a standalone binary from Releases (no Bun required).

```
peruse [path] [--port 7440] [--host 127.0.0.1] [--no-open]
```

peruse is read-only: it never modifies the directory it serves, and it binds
to localhost only by default.

## Design at a glance

A ~5-route Bun server (`Bun.serve`, one dependency: chokidar) plus a single
static page that composes best-in-class libraries — markdown-it, Shiki,
diff2html, Alpine.js — bundled at publish time with `bun build`. Under ~900
lines of glue code total. The interesting decisions and their reasoning are
in [DESIGN.md](DESIGN.md).

## Development

```bash
bun install
bun run build                # bundle web/ → dist/ (required once before serving)
bun run server/index.js      # serve the repo itself, in dev
```

Not yet published to npm; until then, run it from a checkout with
`bun run bin/peruse.js <path>`.

## License

MIT
