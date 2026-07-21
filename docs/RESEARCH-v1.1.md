# v1.1 research notes — CI/CD, projects, Herdr, agent review loop

**Status:** research + spec decisions only, nothing implemented. Guiding
principle (Tarik): build as little as possible; borrow hunk's formats and
mechanisms wherever they exist.

## 1. CI/CD with npm publishing

- **npm trusted publishing (OIDC)** — no `NPM_TOKEN`. Register repo+workflow
  as trusted publisher for `@talkasab/peruse` on npmjs.com; workflow needs
  `permissions: id-token: write`; provenance attestations are automatic.
  Configs created after 2026-05-20 must explicitly tick allowed actions.
  Publishing needs npm CLI ≥ 11.5 (use Node 24 in the publish job).
- **ci.yml** (push/PR): `bun install && bun run build`, then a Playwright
  smoke suite (port of scratchpad `drive2.js` — it caught real bugs).
- **release.yml** (tag `v*`): job A `npm publish` via OIDC; job B
  `bun build --compile --target=bun-{linux-x64,linux-arm64,darwin-x64,darwin-arm64,windows-x64}`
  (all cross-compiled from one Linux runner) attached to the GitHub Release.
- Versioning: manual `npm version` + tag. No changesets/release-please yet.

## 2–3. Project directory list + picker

- Storage `~/.config/peruse/projects.json`: `{path, name, lastOpened}`.
- Auto-register on `peruse <path>` (zoxide model); `peruse add/rm/list` verbs.
- `peruse` with no args → landing page listing projects; picking one re-roots
  the running server (switcher model — smallest build). Multi-root serving
  (`/p/<name>/…`, one long-running instance for the whole tailnet) is the
  richer future option; defer.
- Herdr tie-in: the landing page also lists cwds of live Herdr panes
  ("what the herd is on right now"), merged with the saved list.
- **Prune:** never silently delete on first miss (unmounted drive ≠ gone).
  Missing entries render dimmed/"missing" and are auto-pruned only after N
  days missing, or explicitly via `peruse prune`.

## 4. Herdr integration (interview outcomes)

Herdr = [ogulcancelik/herdr](https://github.com/ogulcancelik/herdr), Rust
agent multiplexer; panes are real terminals; detects agent state
(blocked/working/done/idle); **Unix-socket API** (spawn panes, send input,
read output, wait). Exact protocol: read from source at build time (docs
site blocks fetch; not a blocker).

Decisions:
- **Topology:** peruse server runs on the same machine as Herdr; browser may
  be remote (tailnet). All Herdr-socket/Neovim actions execute host-side, so
  the whole loop works from a phone/tablet.
- **In scope:** review→agent dispatch (below); projects from Herdr pane cwds;
  a Herdr keybinding that opens peruse for the current pane's cwd;
  **open-in-Neovim**: selecting a file in peruse opens it in the Neovim tab
  of the matching Herdr workspace, starting a Neovim pane if none exists.
- **Out of scope:** agent-status dashboard in peruse.
- **Neovim mechanism (chosen for robustness):** match project → Herdr pane by
  cwd; prefer nvim RPC — a deterministic per-project server socket
  (`nvim --listen`), then `nvim --server <sock> --remote-tab +<line> <file>`.
  If no nvim pane exists, spawn one via the Herdr socket running
  `nvim --listen <sock> <file>`. Fallback: Herdr send-keys `:tabedit`.

## 5. Agent review loop (duplicate hunk)

hunk = [modem-dev/hunk](https://github.com/modem-dev/hunk). Its model,
which we adopt verbatim where possible:

- Comment targets: `{filePath, summary, exactly one of hunk | hunkNumber |
  oldLine | newLine}` (their `session comment apply --stdin` batch format).
- Agent rationale sidecar (`--agent-context notes.json`):

  ```json
  { "version": 1, "summary": "…",
    "files": [ { "path": "src/x.ts", "summary": "…",
      "annotations": [ { "newRange": [1, 10], "summary": "…",
                         "rationale": "…", "author": "…" } ] } ] }
  ```

- hunk's live-session daemon (HTTP POST `127.0.0.1:47657/session-api`,
  `hunk session …` CLI) exists but we are **not** building a daemon/CLI:
  interview decided **agent→human is read-only** (sidecar only) and
  human→agent goes out as a prompt.

Decisions:
- **Agent → human:** render hunk-format `agent-context.json` (watched file,
  live-updating like everything else) beside the code/diff, visually
  distinct from human comments. Zero new protocol; anything that can write
  hunk's format works with peruse.
- **Human → agent:** comments drafted in the peruse UI, anchored like gutter
  marks (file + new-file line, optional hunk). Two explicit actions per
  review: **Copy prompt** (clipboard) and **Send to ⟨pane⟩** (peruse injects
  the same prompt into a chosen Herdr agent pane via socket send-input).
- **Prompt format (delegated choice):** markdown review — brief header, then
  per comment `### path:line`, the hunk quoted as a fenced diff, and the
  comment text. Readable by humans, reliably parsed by Claude-class agents.

## Rough build inventory (deliberately small)

1. ci.yml + release.yml (no product code)
2. projects.json + landing page + re-root + soft prune
3. Comment drafts UI + prompt formatter + clipboard copy
4. `/api/herdr/*`: list panes (cwd), send prompt to pane, open-in-nvim
5. Sidecar renderer for hunk `agent-context.json`
6. Herdr keybinding recipe (docs only) for launching peruse

## 6. Keyboard shortcuts

Conventions drawn from the apps this category imitates — GitHub's PR
"Files changed" view (j/k files, n/p comments/commits, t finder, ? help),
vim/tig/lazygit two-pane tools (j/k/h/l, Enter/o), and hunk (vim-ish;
`c` is reserved for creating a note — we must keep that meaning for the
v1.1 review loop).

Proposed keymap (small core, single keydown listener, disabled while an
input has focus; `?` shows a cheatsheet overlay):

| Key | Action | Precedent |
|---|---|---|
| `j` / `k` / arrows | move selection in tree (≈ next/prev file) | GitHub J/K, tig, Gmail |
| `Enter` / `o` | open selected file | GitHub |
| `h` / `l` | collapse / expand directory | nvim-tree, lazygit |
| `n` / `p` | next / prev change in open file, popup follows | GitHub n/p, vim `]c`/`[c` |
| `x` / `Space` | toggle popup on current change | GitHub x (expand), lazygit Space |
| `s` | unified ⇄ split inside open popup | our popup button |
| `t` | fuzzy file finder (to build) | GitHub t |
| `f` | toggle changed-only filter | mnemonic (c is taken) |
| `i` | toggle gitignored visibility | mnemonic |
| `r` | raw ⇄ rendered markdown | our Raw button |
| `?` | help overlay | universal |
| `Esc` | close popup / finder / overlay | already implemented |
| `c` | **reserved**: comment on current change (v1.1 loop) | hunk |

Deferred: `gg`/`G` (native scroll keys suffice), `y` copy-path, theme-toggle
key (hunk's `t` is themes — GitHub's finder meaning wins for us).

Open questions for build time: exact Herdr socket protocol (from source);
hunk's full TUI keymap (read from its source — align any remaining
conflicts in hunk's favor where GitHub has no opinion); switcher vs
multi-root revisit once the landing page exists.

## 7. Polish backlog (discussed, deliberately deferred)

- **Highlighting off the main thread.** The rendering pill (shipped) only
  makes the freeze honest; moving Shiki into a Web Worker (or chunked
  highlighting) would keep the UI interactive on multi-second files.
- **Popup placement.** Popups always open below their mark; flip above
  when the mark is near the bottom of the pane and space is short.
- **Browse into gitignored directories.** They're listed but not walked
  (keeps tree/watcher bounded); lazy per-directory expansion on click
  would make them explorable without unbounding anything.
- **Deleted files (status D).** Tree shows the D badge but selecting one
   404s to the empty placeholder; a "deleted — view last committed
  content?" card would be kinder.
- **Keyboard shortcuts** (§6): specced, not implemented.
- **Release binaries + npm publish + CI** (§1): specced, not implemented.
- **Projects / Herdr / review loop / Neovim** (§2–5): specced, not
  implemented.
