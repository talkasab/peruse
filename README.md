# peruse

A lightweight web server for calmly reading a local directory in your browser:
directory tree on the left, beautifully rendered file on the right.

- **GOOD markdown rendering** — GitHub-flavored, with code fences highlighted
  exactly like standalone code files
- **GOOD code rendering** — Shiki (VS Code–quality TextMate highlighting),
  including mdsvex `.svx` source files
- **Git-aware** — status marks in the tree with a changed-only filter, plus
  the current branch and its ahead/behind state in the header
- **Inline hunk diffs** — subtle gutter marks show *where* a file changed;
  click one to expand that individual hunk's diff in place. Never a
  whole-page diff view.
- **Live** — watches the directory and keeps open views up to date as files
  change on disk
- **Catppuccin** — Latte (light) and Mocha (dark), following your system
  preference with a manual toggle
- **Built for reading and review** — word wrap for long lines, one-click
  copy of a file's exact source, browser tabs titled by server and project,
  and a version indicator that distinguishes releases from dev checkouts

See [ARCHITECTURE.md](ARCHITECTURE.md) for the system as implemented,
[CHANGELOG.md](CHANGELOG.md) for release history, and
[docs/design-history.md](docs/design-history.md) for the original design
and the survey of existing tools.

## Usage

```bash
cd some/directory
bunx @talkasab/peruse .      # registers this directory and prints its project URL
```

```
peruse [path] [--port 7440] [--host 127.0.0.1]
peruse add <path> | rm <name-or-path> | list | prune
```

peruse prints URLs and never opens a browser — its home use case is browsing
a remote machine's files (SSH into the box, click the printed link locally).

Opened paths are remembered in `~/.config/peruse/projects.json`. Running
`peruse` without a path opens a landing page for all registered projects;
each project has a shareable `/p/<name>/` URL and linked Git worktrees appear
under it automatically. Missing paths stay visible for 30 days unless removed
with `peruse prune`.

If the default port is busy, peruse walks forward to the next free one
(7441, 7442, …). A port given explicitly with `--port` is used as-is, or
fails if taken.

peruse is read-only with respect to every directory it serves. Its only
persistent application data is the project registry under
`~/.config/peruse/`, and it binds to localhost only by default.

### Browsing from other machines (LAN / Tailscale)

```bash
peruse --host 0.0.0.0          # bind all interfaces; prints every reachable URL
peruse --host 100.64.12.34     # or bind only your Tailscale address
```

With `0.0.0.0`, peruse lists each address a browser could reach it at
(LAN IP, Tailscale IP, …). Binding just the Tailscale IP keeps it off the
local network entirely; alternatively keep the localhost default and front
it with `tailscale serve 7440`.

**Caveat:** peruse has no authentication — anyone who can reach the port can
read the entire served directory. Symlinks are followed, **including ones
that point outside the served directory** — so what's reachable is the
directory *plus everything it links to*. Only expose directories you'd share
with everyone on that network. (Opt-in symlink confinement for network mode
is tracked in issue #21.)

## Design at a glance

A multi-root Bun server (`Bun.serve`, one dependency: chokidar) plus a single
static client that composes markdown-it, Shiki, diff2html, and Alpine.js,
bundled at publish time with `bun build`. Watchers are created lazily for
projects that are actually opened. The current system is described in
[ARCHITECTURE.md](ARCHITECTURE.md); the original reasoning is preserved in
[docs/design-history.md](docs/design-history.md).

## Development

```bash
bun install
bun run bin/peruse.js <path>     # the server auto-builds dist/ when web/ is newer
```

Not yet published to npm; until then, run it from a checkout as above.
Tuning: `PERUSE_WATCH_BUDGET=<n>` caps how many paths the file watcher takes
on (default derives from the fd limit; the CLI auto-raises a low `ulimit -n`).

## License

MIT
