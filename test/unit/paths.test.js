import { describe, test, expect } from "bun:test";
import { safePath } from "../../server/index.js";
import { resolveRel, hunkRange } from "../../web/lib.js";

describe("safePath (traversal guard)", () => {
  const root = "/srv/repo";
  test("accepts normal paths and the root itself", () => {
    expect(safePath(root, "src/a.py")).toEqual({ abs: "/srv/repo/src/a.py", rel: "src/a.py" });
    expect(safePath(root, "")).toEqual({ abs: "/srv/repo", rel: "" });
    expect(safePath(root, "/leading/slash".slice(1))).not.toBeNull();
  });
  test("rejects escapes and .git", () => {
    expect(safePath(root, "../etc/passwd")).toBeNull();
    expect(safePath(root, "src/../../etc/passwd")).toBeNull();
    expect(safePath(root, ".git")).toBeNull();
    expect(safePath(root, ".git/config")).toBeNull();
  });
  test("does not reject look-alike prefixes", () => {
    expect(safePath(root, ".github/ci.yml")).not.toBeNull();
    expect(safePath("/srv/repo", "../repo2/x")).toBeNull(); // sibling escape
  });
});

describe("resolveRel", () => {
  test("resolves ./ ../ chains against a dir", () => {
    expect(resolveRel("docs/plans", "../a.md")).toBe("docs/a.md");
    expect(resolveRel("docs", "./img/x.png")).toBe("docs/img/x.png");
    expect(resolveRel("", "a.md")).toBe("a.md");
    expect(resolveRel("a/b/c", "../../x")).toBe("a/x");
  });
  test("clamps beyond the root instead of escaping", () => {
    expect(resolveRel("docs", "../../../../etc/passwd")).toBe("etc/passwd");
  });
});

describe("hunkRange", () => {
  test("modified/added span their new lines", () => {
    expect(hunkRange({ newStart: 3, newLines: 2 })).toEqual([3, 4]);
    expect(hunkRange({ newStart: 7, newLines: 1 })).toEqual([7, 7]);
  });
  test("deletion anchors to the line above the cut, floored at 1", () => {
    expect(hunkRange({ newStart: 13, newLines: 0 })).toEqual([13, 13]);
    expect(hunkRange({ newStart: 0, newLines: 0 })).toEqual([1, 1]); // delete at top of file
  });
});
