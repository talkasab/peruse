// Shared fixture: a throwaway git repo exercising every state peruse
// renders, including the shapes that caused real incidents (see DEVLOG):
// separated edits, symlinks, ignored dirs, oversized dirs.
// NOTE: no socket/FIFO is included: this shared repository fixture stays
// filesystem-portable, so the `ignored` callback's special-file skip is
// verified by standalone probes instead. A pre-existing FIFO does not hang
// raw chokidar in the current Bun/Node matrix, and the real peruse server
// filters it and serves normally; the omission is fixture scope, not a hang
// workaround.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { startServer } from "../server/index.js";
import { registerProject, registryPath } from "../server/projects.js";

// Shared Chromium launcher for the e2e files. Kept in one place because the
// transport is a known Bun soft spot (Playwright drives chromium over extra
// stdio pipes; oven-sh/bun#27977 family) — connectOverCDP is NOT a viable
// alternative under Bun (its ws client never connects, oven-sh/bun#9911).
export function launchBrowser() {
  return chromium.launch({
    executablePath: process.env.PERUSE_CHROMIUM || undefined,
    args: ["--no-sandbox"],
  });
}

function sh(cwd, ...cmd) {
  const r = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`${cmd.join(" ")} failed: ${r.stderr.toString()}`);
  return r.stdout.toString();
}

export const UTIL_BASE = `import os

def load(path):
    with open(path) as f:
        return f.read()

def save(path, data):
    with open(path, "w") as f:
        f.write(data)

def main():
    print(load("x"))
`;

// Worktree edits produce exactly these -U0 hunks (verified shape):
// (3,2,modified) (7,3,added) (13,0,deleted) (15,2,added)
export const UTIL_EDITED = `import os

def load(path, mode="r"):
    with open(path, mode) as f:
        return f.read()

def exists(path):
    return os.path.exists(path)

def save(path, data):
    with open(path, "w") as f:
        f.write(data)

    print(load("x"))

# trailing addition
`;

export const POPUP_CODE_BASE = `${Array.from(
  { length: 80 },
  (_, i) => `const line${String(i + 1).padStart(2, "0")} = "before-${i + 1}";`,
).join("\n")}\n`;
export const POPUP_CODE_EDITED = POPUP_CODE_BASE.replace(
  'const line10 = "before-10";',
  'const line10 = "after-10";',
).replace('const line70 = "before-70";', 'const line70 = "after-70";');

export const GUIDE_BASE = `---
Created: 2026-07-20
Status: Active
---

# Guide

Intro paragraph stays untouched.

## Section One

A paragraph that will be modified.

- [util](../src/util.py) — the utility module
- bullet two stays
- bullet three will change
- bullet four stays
- bullet five stays

## Section Two

${Array.from({ length: 30 }, (_, i) => `Filler paragraph ${i} giving the page real scroll height.`).join("\n\n")}

\`\`\`text
${"a wide fenced line with no line-number gutter to hang under ".repeat(6).trimEnd()}
\`\`\`
`;

export const GUIDE_EDITED = GUIDE_BASE.replace("## Section One", "## Section One Edited")
  .replace("will be modified", "HAS been modified")
  .replace("bullet three will change", "bullet three CHANGED");

export const POPUP_MARKDOWN_BASE = `${Array.from(
  { length: 24 },
  (_, i) => `Lead paragraph ${i + 1} stays unchanged.`,
).join("\n\n")}

First popup change before.

${Array.from({ length: 24 }, (_, i) => `Middle paragraph ${i + 1} stays unchanged.`).join("\n\n")}

Bottom popup change before.

${Array.from({ length: 12 }, (_, i) => `Tail paragraph ${i + 1} stays unchanged.`).join("\n\n")}
`;
export const POPUP_MARKDOWN_EDITED = POPUP_MARKDOWN_BASE.replace(
  "First popup change before.",
  "First popup change after.",
).replace("Bottom popup change before.", "Bottom popup change after.");

export const MULTI_MARK_BASE = `---
title: Multi-mark baseline
owner: review
---

# Multi-mark fixture

<!-- Hidden source before. -->

Paragraph first line before.
Paragraph middle line one.
Paragraph middle line two.
Paragraph middle line three.
Paragraph last line before.

- List first line before.
  List middle line one.
  List middle line two.
  List last line before.

\`\`\`text
Fence first line before.
Fence middle line one.
Fence middle line two.
Fence last line before.
\`\`\`
`;

export const MULTI_MARK_EDITED = MULTI_MARK_BASE.replace(
  "title: Multi-mark baseline",
  "title: Multi-mark edited",
)
  .replace("Hidden source before.", "Hidden source after.")
  .replace("Paragraph first line before.", "Paragraph first line after.")
  .replace("Paragraph last line before.", "Paragraph last line after.")
  .replace("List first line before.", "List first line after.")
  .replace("List last line before.", "List last line after.")
  .replace("Fence first line before.", "Fence first line after.")
  .replace("Fence last line before.", "Fence last line after.");

const DENSE_MARK_BASE_BODY = Array.from(
  { length: 18 },
  (_, i) => `${i % 2 === 0 ? "b" : "s"}${i + 1}`,
).join("\n");
const DENSE_MARK_EDITED_BODY = Array.from(
  { length: 18 },
  (_, i) => `${i % 2 === 0 ? "A" : "s"}${i + 1}`,
).join("\n");
const DENSE_MARK_SUFFIX = `

\`\`\`text
${"unchanged wide fence content for wrap replay ".repeat(20).trimEnd()}
\`\`\`

Tail stable before.
`;
export const DENSE_MARK_BASE = `${DENSE_MARK_BASE_BODY}${DENSE_MARK_SUFFIX}`;
export const DENSE_MARK_EDITED = `${DENSE_MARK_EDITED_BODY}${DENSE_MARK_SUFFIX}`;

export const UNEVEN_MARK_BASE = `Uneven first before.
${"A deliberately oversized unchanged middle line wraps many times. ".repeat(100).trimEnd()}
Uneven last before.
`;
export const UNEVEN_MARK_EDITED = UNEVEN_MARK_BASE.replace(
  "Uneven first before.",
  "Uneven first after.",
).replace("Uneven last before.", "Uneven last after.");

const competingItem = (prefix) =>
  Array.from(
    { length: 8 },
    (_, i) => `${i === 0 ? "- " : "  "}${prefix}${i + 1} ${i % 2 === 0 ? "before" : "stable"}`,
  ).join("\n");
export const COMPETING_MARK_BASE = `${competingItem("left-")}\n${competingItem("right-")}\n`;
export const COMPETING_MARK_EDITED = COMPETING_MARK_BASE.replaceAll("before", "after");

const ORDER_MARK_EARLY_BASE = Array.from(
  { length: 60 },
  (_, i) => `early-${i + 1}-${i % 2 === 0 ? "before" : "stable"}`,
).join("\n");
const ORDER_MARK_EARLY_EDITED = ORDER_MARK_EARLY_BASE.replaceAll("before", "after");
const ORDER_MARK_LATE_BASE = `Later before ${"a very wide unchanged tail ".repeat(250).trimEnd()}`;
const ORDER_MARK_LATE_EDITED = ORDER_MARK_LATE_BASE.replace("Later before", "Later after");
export const ORDER_MARK_BASE = `${ORDER_MARK_EARLY_BASE}\n\n${ORDER_MARK_LATE_BASE}\n`;
export const ORDER_MARK_EDITED = `${ORDER_MARK_EARLY_EDITED}\n\n${ORDER_MARK_LATE_EDITED}\n`;

export const OVERFLOW_MARK_BASE = `${Array.from(
  { length: 240 },
  (_, i) => `${i % 2 === 0 ? "b" : "s"}${i + 1}`,
).join("\n")}\n`;
export const OVERFLOW_MARK_EDITED = `${Array.from(
  { length: 240 },
  (_, i) => `${i % 2 === 0 ? "A" : "s"}${i + 1}`,
).join("\n")}\n`;

export const CROSS_BLOCK_BASE = `- first item stable
  first boundary before
- second boundary before
  second item stable
`;
export const CROSS_BLOCK_EDITED = CROSS_BLOCK_BASE.replace(
  "first boundary before",
  "first boundary after",
).replace("second boundary before", "second boundary after");

// One mdsvex document carrying every region the composite grammar has to keep
// apart: YAML frontmatter, a typed <script>, Markdown prose/lists, a component
// with a directive, control-flow and {@html} blocks, a fenced code block, and a
// preprocessed <style>. The region markers below are what the tests search for
// — keep them unique and keep each region's shape if you edit this.
export const POST_SVX_BASE = `---
title: Release Notes
draft: false
tags:
  - mdsvex
---

<script lang="ts">
  import Callout from './Callout.svelte';
  export let version: string = '1.0.0';
  const items: number[] = [1, 2, 3];
</script>

# Release {version}

Prose with **bold**, _emphasis_, a [link](https://example.com) and \`code\`.
Autolinks: <https://example.com/docs> and <a@example.com>.

- bullet one
- bullet two

<Callout kind="info" on:dismiss={() => close()}>Heads up</Callout>

<X
  answer={42}
>
  <Y><Z>{version}</Z></Y>
</X>

{#if items.length}
  {#each items as item, i}
    <li>{i}: {item}</li>
  {/each}
{:else}
  <p>Nothing here</p>
{/if}

{@html '<hr />'}

\`\`\`js
const answer = 42;
\`\`\`

<style lang="scss">
  .callout { color: rebeccapurple; }
</style>
`;

export const TOML_SVX = `+++
title = "TOML Notes"
draft = false
tags = ["mdsvex", "toml"]
+++

# TOML frontmatter
`;

export const STYLE_LANGS_SVX = `# Styles {theme}
<style>
  .css { color: red; }
</style>
<style lang="scss">
  $tone: blue;
  .scss { color: $tone; }
</style>
<style lang="postcss">
  .postcss { color: color(red alpha(50%)); }
</style>
<style lang="less">
  @tone: green;
  .less { color: @tone; }
</style>
<Widget active={theme} />
`;

export const DEEP_SVX = `${"<X>".repeat(100)}{value}${"</X>".repeat(100)}\n`;
export const SVX_HL_LINE_LIMIT = 3500;
const SVX_BOUNDARY_UNIT = `# Heading {value}
Paragraph with **bold**, a [link](https://example.com), and {value}.
<X answer={42}>content</X>
{#if value}
  <p>{value}</p>
{/if}
\`\`\`js
const answer = 42;
\`\`\`

`;
export const SVX_AT_LIMIT = SVX_BOUNDARY_UNIT.repeat(SVX_HL_LINE_LIMIT / 10);
export const SVX_AT_LIMIT_UNTERMINATED = SVX_AT_LIMIT.replace(/\n$/, "");
export const SVX_OVER_LIMIT = `${SVX_AT_LIMIT}# Over limit\n`;
export const SVX_OVER_LIMIT_UNTERMINATED = SVX_OVER_LIMIT.replace(/\n$/, "");

export const POST_SVX_EDITED = POST_SVX_BASE.replace(
  "const items: number[] = [1, 2, 3];",
  "const items: number[] = [1, 2, 3, 4];",
).replace("- bullet two", "- bullet two, revised");

// Word-wrap subject (#25): committed clean, so wrap measurements are not
// entangled with change marks. Line 2 wraps on spaces; line 3 has no break
// opportunity at all and only wraps under `overflow-wrap: anywhere`.
export const WIDE_TEXT = `short line
${"the quick brown fox jumps over the lazy dog ".repeat(20).trimEnd()}
https://example.com/${"unbreakable-token-".repeat(20)}end
tail line
`;

// Combined #18 + #25 subject: a committed-clean mdsvex file whose prose line
// wraps, proving the wrap toggle operates on grammar-highlighted .svx output.
export const WIDE_SVX = `---
title: Wide
---

<script>
  export let x = 1;
</script>

# Wide {x}

${"an mdsvex prose line that should soft wrap when the toggle is on ".repeat(12).trimEnd()}
`;

export const LONG_SCROLL_TEXT = Array.from(
  { length: 260 },
  (_, i) =>
    `line ${String(i + 1).padStart(3, "0")} ${"a deliberately long logical line for viewport anchoring ".repeat(10).trimEnd()}`,
).join("\n");

export const SHORT_TEXT = "first short line\nsecond short line\nthird short line\n";
export const SINGLE_LONG_TEXT = `${"one enormous logical line that becomes vertically scrollable only when wrapped ".repeat(400).trimEnd()}\n`;
export const TALL_FINAL_LINE_TEXT = `${Array.from(
  { length: 80 },
  (_, i) => `lead line ${String(i + 1).padStart(2, "0")}`,
).join("\n")}\n${"one viewport-tall final logical line after wrapping ".repeat(1_000).trimEnd()}`;

export const WRAP_ANCHOR_MARKDOWN = `# Wrap anchor fixture

Introductory text before the section.

## Viewport-tall fence

\`\`\`text
${"a viewport-tall fenced line used to distinguish sticky headings from logical content ".repeat(260).trimEnd()}
\`\`\`

## Following blocks

${Array.from({ length: 50 }, (_, i) => `Following paragraph ${i + 1} keeps the Markdown fixture scrollable.`).join("\n\n")}
`;

export const WRAPPED_CHANGE_BASE = `export const summary = "${"a long changed line whose gutter mark must cover every visual row ".repeat(14).trimEnd()}";\n`;
export const WRAPPED_CHANGE_EDITED = WRAPPED_CHANGE_BASE.replace(
  "a long changed line",
  "the modified long line",
);

export function makeFixtureRepo() {
  const dir = mkdtempSync(join(tmpdir(), "peruse-fixture-"));
  const g = (...cmd) => sh(dir, "git", ...cmd);
  g("init", "-q");
  g("config", "user.email", "t@e.st");
  g("config", "user.name", "Test");

  mkdirSync(join(dir, "src"));
  mkdirSync(join(dir, "docs"));
  writeFileSync(join(dir, "src/util.py"), UTIL_BASE);
  writeFileSync(join(dir, "src/popup-position.js"), POPUP_CODE_BASE);
  writeFileSync(join(dir, "docs/guide.md"), GUIDE_BASE);
  writeFileSync(join(dir, "docs/popup-position.md"), POPUP_MARKDOWN_BASE);
  writeFileSync(join(dir, "docs/multi-mark.md"), MULTI_MARK_BASE);
  writeFileSync(join(dir, "docs/dense-mark.md"), DENSE_MARK_BASE);
  writeFileSync(join(dir, "docs/uneven-mark.md"), UNEVEN_MARK_BASE);
  writeFileSync(join(dir, "docs/competing-mark.md"), COMPETING_MARK_BASE);
  writeFileSync(join(dir, "docs/order-mark.md"), ORDER_MARK_BASE);
  writeFileSync(join(dir, "docs/overflow-mark.md"), OVERFLOW_MARK_BASE);
  writeFileSync(join(dir, "docs/cross-block.md"), CROSS_BLOCK_BASE);
  writeFileSync(join(dir, "docs/post.svx"), POST_SVX_BASE);
  writeFileSync(join(dir, "docs/toml.svx"), TOML_SVX);
  writeFileSync(join(dir, "docs/at-limit.svx"), SVX_AT_LIMIT);
  writeFileSync(join(dir, "docs/at-limit-unterminated.svx"), SVX_AT_LIMIT_UNTERMINATED);
  writeFileSync(join(dir, "docs/over-limit.svx"), SVX_OVER_LIMIT);
  writeFileSync(join(dir, "docs/over-limit-unterminated.svx"), SVX_OVER_LIMIT_UNTERMINATED);
  writeFileSync(join(dir, "README.md"), "# Fixture\n\nSee [the guide](docs/guide.md).\n");
  writeFileSync(join(dir, "docs/wide.txt"), WIDE_TEXT);
  writeFileSync(join(dir, "docs/wide.svx"), WIDE_SVX);
  writeFileSync(join(dir, "docs/long-scroll.txt"), LONG_SCROLL_TEXT);
  writeFileSync(join(dir, "docs/short.txt"), SHORT_TEXT);
  writeFileSync(join(dir, "docs/single-long.txt"), SINGLE_LONG_TEXT);
  writeFileSync(join(dir, "docs/tall-final-line.txt"), TALL_FINAL_LINE_TEXT);
  writeFileSync(join(dir, "docs/wrap-anchor.md"), WRAP_ANCHOR_MARKDOWN);
  writeFileSync(join(dir, "docs/empty.txt"), "");
  writeFileSync(join(dir, "src/wrapped-change.js"), WRAPPED_CHANGE_BASE);
  writeFileSync(join(dir, ".gitignore"), "*.log\nignored-dir/\n");
  // Committed and never touched afterward: the negative case for `dirty`/
  // `ignored` flags (a directory/file with real git history but no changes).
  mkdirSync(join(dir, "cleandir"));
  writeFileSync(join(dir, "cleandir/kept.txt"), "never modified\n");
  g("add", "-A");
  g("commit", "-qm", "baseline");

  // worktree state
  writeFileSync(join(dir, "src/util.py"), UTIL_EDITED); // M, 4 separated hunks
  writeFileSync(join(dir, "src/popup-position.js"), POPUP_CODE_EDITED); // M, 2 popup anchors
  writeFileSync(join(dir, "src/wrapped-change.js"), WRAPPED_CHANGE_EDITED); // M, one long hunk
  writeFileSync(join(dir, "docs/guide.md"), GUIDE_EDITED); // M, 3 changed blocks
  writeFileSync(join(dir, "docs/popup-position.md"), POPUP_MARKDOWN_EDITED); // M, 2 popup anchors
  writeFileSync(join(dir, "docs/multi-mark.md"), MULTI_MARK_EDITED); // M, 8 separated hunks
  writeFileSync(join(dir, "docs/dense-mark.md"), DENSE_MARK_EDITED); // M, 9 alternating hunks
  writeFileSync(join(dir, "docs/uneven-mark.md"), UNEVEN_MARK_EDITED); // M, 2 hunks around wrap
  writeFileSync(join(dir, "docs/competing-mark.md"), COMPETING_MARK_EDITED); // M, 2 competing stacks
  writeFileSync(join(dir, "docs/order-mark.md"), ORDER_MARK_EDITED); // M, dense then tall
  writeFileSync(join(dir, "docs/overflow-mark.md"), OVERFLOW_MARK_EDITED); // M, 120 hunks
  writeFileSync(join(dir, "docs/cross-block.md"), CROSS_BLOCK_EDITED); // M, 1 sibling hunk
  writeFileSync(join(dir, "docs/post.svx"), POST_SVX_EDITED); // M, script + prose hunks
  writeFileSync(join(dir, "docs/new.md"), "# Brand new\n\nAll of this is new.\n"); // U
  // Past MAX_HL_LINES (10k in app.js): must fall back to plain source with a
  // notice, the same path any oversized file takes.
  writeFileSync(
    join(dir, "docs/huge.svx"),
    `# Huge\n${"\nfiller paragraph with a {mustache} in it\n".repeat(6000)}`,
  ); // U
  writeFileSync(join(dir, "data.bin"), Buffer.from(Array.from({ length: 512 }, (_, i) => i % 256))); // U binary
  writeFileSync(join(dir, "ignored.log"), "ignored file\n");
  mkdirSync(join(dir, "ignored-dir"));
  writeFileSync(join(dir, "ignored-dir/junk.txt"), "junk\n");

  // incident e30232f: dangling symlink + symlink chain must not crash anything.
  // Kept in their own dir out of caution about symlink handling in the
  // watcher; a merely dangling link turned out to be harmless there, while the
  // links that do break chokidar's scan (issue #17, ENOTDIR-style) are built
  // per-test in watch-recovery.test.js rather than shared here.
  mkdirSync(join(dir, "linkfarm"));
  symlinkSync("/nonexistent-target", join(dir, "linkfarm/dangling"));
  symlinkSync(join(dir, "README.md"), join(dir, "linkfarm/readme-link"));

  // Symlink pointing OUTSIDE the served root (sibling dir, cleaned up with
  // the fixture): peruse deliberately follows it — owner-accepted policy,
  // characterized in api.test.js.
  mkdirSync(`${dir}-outside`);
  writeFileSync(join(`${dir}-outside`, "secret.txt"), "OUTSIDE THE ROOT\n");
  symlinkSync(join(`${dir}-outside`, "secret.txt"), join(dir, "escape-link"));

  // incident 97ef45d/dd900e4: an oversized directory (cap at 500 entries)
  mkdirSync(join(dir, "bigdir"));
  for (let i = 0; i < 510; i++)
    writeFileSync(join(dir, `bigdir/f${String(i).padStart(3, "0")}.txt`), "x\n");

  return dir;
}

export function makePlainDir() {
  const dir = mkdtempSync(join(tmpdir(), "peruse-plain-"));
  writeFileSync(join(dir, "note.md"), "# No git here\n");
  writeFileSync(join(dir, "a.py"), "x = 1\n");
  return dir;
}

export async function startFixtureServer(root, port, opts = {}) {
  // Generous default watch budget: the fixture's 510-file bigdir would eat
  // the fd-derived default and silently mask watcher behaviors under test.
  // Pass opts.budget to exercise the budget itself — startServer's explicit
  // watchBudget option takes precedence over the fd-derived default without
  // touching process.env (which would race if tests ever ran in parallel).
  const { budget, ...rest } = opts;
  const configDir = mkdtempSync(join(tmpdir(), "peruse-config-"));
  const configFile = registryPath(configDir);
  const project = registerProject(root, { file: configFile });
  const srv = await startServer({
    configFile,
    port,
    host: "127.0.0.1",
    watchBudget: budget ?? 5000,
    ...rest,
  });
  const origin = `http://127.0.0.1:${srv.port}`;
  const base = `${origin}/p/${encodeURIComponent(project.name)}`;
  return {
    ...srv,
    base,
    origin,
    configFile,
    project,
    async json(path) {
      const r = await fetch(base + path);
      return { status: r.status, body: r.status === 200 ? await r.json() : null };
    },
    cleanup: async () => {
      await srv.stop();
      rmSync(root, { recursive: true, force: true });
      rmSync(`${root}-outside`, { recursive: true, force: true });
      rmSync(configDir, { recursive: true, force: true });
    },
  };
}
