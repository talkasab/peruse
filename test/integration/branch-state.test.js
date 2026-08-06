import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { gitStatus } from "../../server/index.js";
import { startFixtureServer } from "../fixture.js";

function git(root, ...args) {
  const result = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0)
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
}

function commit(root, name, content) {
  writeFileSync(join(root, name), `${content}\n`);
  git(root, "add", name);
  git(root, "commit", "-qm", content);
}

async function stateFor(setup) {
  const root = mkdtempSync(join(tmpdir(), "peruse-branch-api-"));
  mkdirSync(join(root, "src"));
  git(root, "init", "-q");
  git(root, "config", "user.email", "t@e.st");
  git(root, "config", "user.name", "Test");
  commit(root, "README.md", "baseline");
  const server = await startFixtureServer(root, 0);
  try {
    await setup(root);
    return (await server.json("/api/tree")).body.branchState;
  } finally {
    await server.cleanup();
  }
}

test("branch base selection prefers dev, then main, then master (#15)", async () => {
  const dev = await stateFor(async (root) => {
    git(root, "branch", "-M", "main");
    git(root, "switch", "-qc", "feature/dev-order");
    commit(root, "feature.txt", "feature");
    git(root, "switch", "-q", "main");
    git(root, "switch", "-qc", "dev");
    commit(root, "dev.txt", "dev");
    git(root, "switch", "-q", "feature/dev-order");
  });
  expect(dev).toEqual({
    head: "feature/dev-order",
    base: "dev",
    ahead: 1,
    behind: 1,
    detached: false,
  });

  const main = await stateFor(async (root) => {
    git(root, "branch", "-M", "main");
    git(root, "switch", "-qc", "feature/main-order");
    commit(root, "feature.txt", "feature");
  });
  expect(main).toEqual({
    head: "feature/main-order",
    base: "main",
    ahead: 1,
    behind: 0,
    detached: false,
  });

  const master = await stateFor(async (root) => {
    git(root, "branch", "-M", "master");
    git(root, "switch", "-qc", "feature/master-order");
    commit(root, "feature.txt", "feature");
  });
  expect(master).toEqual({
    head: "feature/master-order",
    base: "master",
    ahead: 1,
    behind: 0,
    detached: false,
  });
});

test("a repository without dev, main, or master reports its branch without counts (#15)", async () => {
  const state = await stateFor(async (root) => {
    git(root, "branch", "-M", "trunk");
    git(root, "switch", "-qc", "feature/no-base");
    commit(root, "feature.txt", "feature");
  });
  expect(state).toEqual({
    head: "feature/no-base",
    base: null,
    ahead: 0,
    behind: 0,
    detached: false,
  });
});

test("branch state preserves behind-only counts and Unicode branch names (#15)", async () => {
  const behind = await stateFor(async (root) => {
    git(root, "branch", "-M", "main");
    git(root, "branch", "feature/behind-only");
    commit(root, "main.txt", "main advance");
    git(root, "switch", "-q", "feature/behind-only");
  });
  expect(behind).toEqual({
    head: "feature/behind-only",
    base: "main",
    ahead: 0,
    behind: 1,
    detached: false,
  });

  const unicode = await stateFor(async (root) => {
    git(root, "branch", "-M", "main");
    git(root, "switch", "-qc", "feature/über/東京");
    commit(root, "unicode.txt", "unicode branch");
  });
  expect(unicode).toEqual({
    head: "feature/über/東京",
    base: "main",
    ahead: 1,
    behind: 0,
    detached: false,
  });
});

test("branch state piggybacks status polling with bounded spawn impact (#15)", async () => {
  const root = mkdtempSync(join(tmpdir(), "peruse-branch-spawns-"));
  git(root, "init", "-q");
  git(root, "config", "user.email", "t@e.st");
  git(root, "config", "user.name", "Test");
  commit(root, "README.md", "baseline");
  git(root, "branch", "-M", "main");

  const countSpawns = async () => {
    const original = Bun.spawn;
    let count = 0;
    Bun.spawn = (...args) => {
      const argv = Array.isArray(args[0]) ? args[0] : (args[0]?.cmd ?? []);
      if (argv[0] === "git") count++;
      return original(...args);
    };
    try {
      await gitStatus(root);
      return count;
    } finally {
      Bun.spawn = original;
    }
  };

  try {
    expect(await countSpawns()).toBe(4);
    git(root, "switch", "-qc", "feature/spawns");
    commit(root, "feature.txt", "feature");
    expect(await countSpawns()).toBe(5);
    git(root, "switch", "-qd", "HEAD");
    expect(await countSpawns()).toBe(3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
