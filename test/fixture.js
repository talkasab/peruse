// Shared fixture: a throwaway git repo exercising every state peruse
// renders, including the shapes that caused real incidents (see DEVLOG):
// separated edits, symlinks, ignored dirs, oversized dirs.
// NOTE: no socket/FIFO is included — chokidar's initial scan hangs
// indefinitely on a directory containing one (reproduced under Bun on
// Linux: `chokidar.watch()` never fires 'ready'). The `ignored` callback's
// `!stats.isFile() && !stats.isDirectory()` skip (server/index.js) is
// exercised only implicitly, if at all, elsewhere; adding a FIFO here to
// close that gap would hang the whole suite, so it's left uncovered.
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
`;

export const GUIDE_EDITED = GUIDE_BASE.replace("## Section One", "## Section One Edited")
  .replace("will be modified", "HAS been modified")
  .replace("bullet three will change", "bullet three CHANGED");

export function makeFixtureRepo() {
  const dir = mkdtempSync(join(tmpdir(), "peruse-fixture-"));
  const g = (...cmd) => sh(dir, "git", ...cmd);
  g("init", "-q");
  g("config", "user.email", "t@e.st");
  g("config", "user.name", "Test");

  mkdirSync(join(dir, "src"));
  mkdirSync(join(dir, "docs"));
  writeFileSync(join(dir, "src/util.py"), UTIL_BASE);
  writeFileSync(join(dir, "docs/guide.md"), GUIDE_BASE);
  writeFileSync(join(dir, "README.md"), "# Fixture\n\nSee [the guide](docs/guide.md).\n");
  writeFileSync(join(dir, ".gitignore"), "*.log\nignored-dir/\n");
  // Committed and never touched afterward: the negative case for `dirty`/
  // `ignored` flags (a directory/file with real git history but no changes).
  mkdirSync(join(dir, "cleandir"));
  writeFileSync(join(dir, "cleandir/kept.txt"), "never modified\n");
  g("add", "-A");
  g("commit", "-qm", "baseline");

  // worktree state
  writeFileSync(join(dir, "src/util.py"), UTIL_EDITED); // M, 4 separated hunks
  writeFileSync(join(dir, "docs/guide.md"), GUIDE_EDITED); // M, 3 changed blocks
  writeFileSync(join(dir, "docs/new.md"), "# Brand new\n\nAll of this is new.\n"); // U
  writeFileSync(join(dir, "data.bin"), Buffer.from(Array.from({ length: 512 }, (_, i) => i % 256))); // U binary
  writeFileSync(join(dir, "ignored.log"), "ignored file\n");
  mkdirSync(join(dir, "ignored-dir"));
  writeFileSync(join(dir, "ignored-dir/junk.txt"), "junk\n");

  // incident e30232f: dangling symlink + symlink chain must not crash anything.
  // Kept in their own dir: a dangling symlink makes chokidar silently drop
  // the containing dir's watch (known limitation, issue #17) — it must not
  // share a dir with paths whose live updates tests rely on.
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
