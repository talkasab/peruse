import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitStatus } from "../../server/index.js";

function sh(cwd, ...cmd) {
  const r = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`${cmd.join(" ")} failed: ${r.stderr.toString()}`);
  return r.stdout.toString();
}

async function withTmpRepo(fn) {
  const dir = mkdtempSync(join(tmpdir(), "peruse-gitstatus-"));
  const g = (...cmd) => sh(dir, "git", ...cmd);
  g("init", "-q");
  g("config", "user.email", "t@e.st");
  g("config", "user.name", "Test");
  // fn is async — must be awaited before cleanup, or rmSync deletes the repo
  // out from under the still-pending gitStatus() call.
  try {
    return await fn(dir, g);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("gitStatus", () => {
  test("parses a staged rename (porcelain v2 -z type-2 entry, origPath field skipped)", async () => {
    await withTmpRepo(async (dir, g) => {
      writeFileSync(join(dir, "old.txt"), "content\n");
      g("add", "-A");
      g("commit", "-qm", "base");
      g("mv", "old.txt", "new.txt");
      const gs = await gitStatus(dir);
      expect(gs.status.get("new.txt")).toBe("R");
      // the -z origPath field is consumed by the `i++` skip, not parsed as
      // its own status entry
      expect(gs.status.has("old.txt")).toBe(false);
    });
  });

  test("repo-prefix slicing: statuses come back relative to a served subdirectory", async () => {
    await withTmpRepo(async (dir, g) => {
      mkdirSync(join(dir, "sub"));
      writeFileSync(join(dir, "sub/f.txt"), "x\n");
      writeFileSync(join(dir, "top.txt"), "x\n");
      g("add", "-A");
      g("commit", "-qm", "base");
      writeFileSync(join(dir, "sub/f.txt"), "y\n");
      const gs = await gitStatus(join(dir, "sub"));
      expect(gs.status.get("f.txt")).toBe("M");
      // top.txt is outside the served prefix and must not appear at all
      expect(gs.status.has("top.txt")).toBe(false);
    });
  });

  test("unborn HEAD (no commits yet) still reports isRepo with the empty-tree base", async () => {
    await withTmpRepo(async (dir) => {
      const gs = await gitStatus(dir);
      expect(gs.isRepo).toBe(true);
      // git's well-known empty-tree object hash — the diff base fileHunks
      // uses when HEAD doesn't exist yet
      expect(gs.base).toBe("4b825dc642cb6eb9a060e54bf8d69288fbee4904");
    });
  });

  test("untracked files get letter U; ignored files are collected separately", async () => {
    await withTmpRepo(async (dir) => {
      writeFileSync(join(dir, ".gitignore"), "*.log\n");
      writeFileSync(join(dir, "new.txt"), "x\n");
      writeFileSync(join(dir, "skip.log"), "x\n");
      const gs = await gitStatus(dir);
      expect(gs.status.get("new.txt")).toBe("U");
      expect(gs.status.has("skip.log")).toBe(false);
      expect(gs.ignored.has("skip.log")).toBe(true);
    });
  });
});
