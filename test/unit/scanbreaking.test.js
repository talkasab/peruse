import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findScanBreakingLinks } from "../../server/index.js";

// A link whose realpath() fails with an errno chokidar's scanner does not
// treat as normal flow (ENOTDIR here) kills the listing of its directory;
// a merely dangling link (ENOENT) does not. See issue #17.
function makeTree() {
  const root = mkdtempSync(join(tmpdir(), "peruse-scan-"));
  mkdirSync(join(root, "farm"));
  mkdirSync(join(root, "clean"));
  mkdirSync(join(root, "node_modules/pkg"), { recursive: true });
  writeFileSync(join(root, "farm/real.txt"), "x\n");
  writeFileSync(join(root, "clean/real.txt"), "x\n");
  symlinkSync(join(root, "clean/real.txt"), join(root, "clean/good-link"));
  symlinkSync("/nonexistent-target", join(root, "clean/dangling"));
  return root;
}

describe("findScanBreakingLinks", () => {
  test("a clean tree, dangling and valid links included, yields nothing", () => {
    const root = makeTree();
    try {
      expect([...findScanBreakingLinks(root).keys()]).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("names the directory and the link that breaks it", () => {
    const root = makeTree();
    symlinkSync(join(root, "farm/real.txt", "nope"), join(root, "farm/poison"));
    try {
      const found = findScanBreakingLinks(root);
      expect([...found.keys()]).toEqual([join(root, "farm")]);
      expect(found.get(join(root, "farm"))).toEqual([{ name: "poison", code: "ENOTDIR" }]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("finds nested directories and honours the skip predicate", () => {
    const root = makeTree();
    mkdirSync(join(root, "clean/deep"));
    symlinkSync(join(root, "farm/real.txt", "nope"), join(root, "clean/deep/poison"));
    symlinkSync(join(root, "farm/real.txt", "nope"), join(root, "node_modules/pkg/poison"));
    try {
      const skip = (rel) => rel.split("/").includes("node_modules");
      expect([...findScanBreakingLinks(root, skip).keys()]).toEqual([join(root, "clean/deep")]);
      // Without the skip, the node_modules copy shows up too.
      expect([...findScanBreakingLinks(root).keys()].sort()).toEqual(
        [join(root, "clean/deep"), join(root, "node_modules/pkg")].sort(),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("does not descend through symlinked directories", () => {
    const root = makeTree();
    const outside = mkdtempSync(join(tmpdir(), "peruse-scan-out-"));
    symlinkSync(join(root, "farm/real.txt", "nope"), join(outside, "poison"));
    symlinkSync(outside, join(root, "clean/dir-link"));
    try {
      expect([...findScanBreakingLinks(root).keys()]).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("a one-path budget finds the admitted root poison but skips rejected subtrees", () => {
    const root = makeTree();
    symlinkSync(join(root, "farm/real.txt", "nope"), join(root, "poison"));
    for (let i = 0; i < 120; i++) {
      const dir = join(root, `rejected-${i}`);
      mkdirSync(dir);
      symlinkSync(join(root, "farm/real.txt", "nope"), join(dir, "poison"));
    }
    const admitted = new Set([""]);
    const skip = (rel) => {
      if (admitted.has(rel)) return false;
      if (admitted.size >= 1) return true;
      admitted.add(rel);
      return false;
    };
    try {
      expect([...findScanBreakingLinks(root, skip).keys()]).toEqual([root]);
      expect(admitted.size).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
