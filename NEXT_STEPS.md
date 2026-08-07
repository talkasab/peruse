# Next steps — proposals as of 2026-08-07 (v1.1.0)

A point-in-time snapshot of the assistant's recommendations after the
1.0.0/1.0.1/1.1.0 releases. Every item lives in a GitHub issue — this file
only proposes ordering and rationale, per the "future work → issues" rule.
Delete or regenerate freely; the issues are the source of truth.

## 1. The strategic conversation: peruse as an agent-review surface

**#4 → #5 → #6** (Herdr pane-derived projects → open-in-Neovim → the agent
review loop: comments, copy-as-prompt, send-to-pane, hunk-format sidecar).
This is the direction that makes peruse categorically different from a
pretty file viewer, and the last three days were an extended field test:
every branch of both release waves was reviewed *in peruse terms* (marks,
hunks, worktrees). Recommend a design session before any implementation —
these need owner product decisions, not dispatches. #4 first; #5 and #6
lean on knowing which workspace/pane a file belongs to.

## 2. Next feature wave (pipeline-ready, after behavior decisions where noted)

- **#36 directory links / index.md conventions** — needs the deferred
  behavior decisions first (tree-select vs render-index vs both).
- **#11 deleted files in the tree** — well-understood, medium size.
- **#22 HTML/SVG source↔rendered toggle** — sanitizer-adjacent; sequence
  deliberately with #12 (Mermaid/KaTeX), not in parallel, since both punch
  calculated holes in the #23 sanitization policy.
- **#7 keyboard shortcuts** — now sensibly unblocked: the toggles/actions
  that needed to claim keys (wrap, copy, themes) all exist.

## 3. Housekeeping (small, dispatchable anytime)

- **#30** guard the freshness scan against concurrent deletion (one-line).
- **#34** reconnect live views when a removed project is re-registered.
- **#31** coverage-hardening ledger — all items independently verified,
  none regression-committed; burn down opportunistically.
- **#27** test/ under tsc checkJs — the ~200-annotation slog; rainy day.

## 4. Waiting on the outside world

- **#29** e2e pipe-stall workarounds — evidence ledger is current; retire
  when upstream Bun/Playwright fixes land.
- **Upstream readdirp ENOTDIR report** (filed from #17's investigation) —
  if accepted, the stall-watchdog fallback in server/index.js can shrink.
- **#8 Shiki off the main thread** — benchmark numbers attached from the
  #18 work (~600 ms cold at the 3,500-line boundary); do when felt.
- **#21, #12, #13** — network-mode symlink confinement, Mermaid/KaTeX,
  Docker: parked pending appetite. (#10 is explicitly on hold.)

## 5. Release cadence proposal

The pipeline is proven zero-touch. Suggest small, frequent releases —
each wave (or even each landed issue) rides out as a patch/minor within a
day of merging, keeping `[Unreleased]` short and the provenance chain hot.
