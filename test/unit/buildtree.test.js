import { describe, test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildTree } from "../../server/index.js";

// buildTree takes a pre-computed `gs` ({status, ignored}) rather than calling
// git itself, so these tests craft one directly — no real git repo needed.
const gs = (status = new Map(), ignored = new Set()) => ({ status, ignored });

function withTmpDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "peruse-buildtree-"));
  try { return fn(dir); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

describe("buildTree", () => {
  test("dirs sort before files, alphabetically within each group", () => {
    withTmpDir((dir) => {
      writeFileSync(join(dir, "b.txt"), "");
      writeFileSync(join(dir, "a.txt"), "");
      mkdirSync(join(dir, "zdir"));
      mkdirSync(join(dir, "adir"));
      const tree = buildTree(dir, gs());
      expect(tree.map((n) => n.name)).toEqual(["adir", "zdir", "a.txt", "b.txt"]);
    });
  });

  test("dirty propagates from a changed descendant file, not from a clean one", () => {
    withTmpDir((dir) => {
      mkdirSync(join(dir, "changed"));
      mkdirSync(join(dir, "clean"));
      writeFileSync(join(dir, "changed/f.txt"), "");
      writeFileSync(join(dir, "clean/f.txt"), "");
      const tree = buildTree(dir, gs(new Map([["changed/f.txt", "M"]])));
      expect(tree.find((n) => n.name === "changed").dirty).toBe(true);
      expect(tree.find((n) => n.name === "clean").dirty).toBe(false);
    });
  });

  test("dirty propagates through nested clean directories to a changed grandchild", () => {
    withTmpDir((dir) => {
      mkdirSync(join(dir, "a"));
      mkdirSync(join(dir, "a/b"));
      writeFileSync(join(dir, "a/b/f.txt"), "");
      const tree = buildTree(dir, gs(new Map([["a/b/f.txt", "M"]])));
      const a = tree.find((n) => n.name === "a");
      expect(a.dirty).toBe(true);
      expect(a.children.find((n) => n.name === "b").dirty).toBe(true);
    });
  });

  test("ignored dirs are listed but not walked; a non-ignored sibling reports ignored:false", () => {
    withTmpDir((dir) => {
      mkdirSync(join(dir, "node_modules"));
      writeFileSync(join(dir, "node_modules/pkg.js"), "");
      writeFileSync(join(dir, "kept.txt"), "");
      const tree = buildTree(dir, gs(new Map(), new Set(["node_modules/"])));
      const nm = tree.find((n) => n.name === "node_modules");
      expect(nm.ignored).toBe(true);
      expect(nm.children).toEqual([]);
      expect(tree.find((n) => n.name === "kept.txt").ignored).toBe(false);
    });
  });

  test("caps a directory at 500 entries with a trailing truncated row", () => {
    withTmpDir((dir) => {
      for (let i = 0; i < 505; i++)
        writeFileSync(join(dir, `f${String(i).padStart(3, "0")}.txt`), "");
      const tree = buildTree(dir, gs());
      expect(tree.length).toBe(501);
      expect(tree[500].truncated).toBe(true);
      expect(tree[500].name).toContain("more entries");
    });
  });

  test(".git is always skipped", () => {
    withTmpDir((dir) => {
      mkdirSync(join(dir, ".git"));
      writeFileSync(join(dir, ".git/config"), "");
      const tree = buildTree(dir, gs());
      expect(tree).toEqual([]);
    });
  });
});
