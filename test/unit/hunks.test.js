import { describe, test, expect } from "bun:test";
import { parseHunks, withContext } from "../../server/index.js";

describe("parseHunks", () => {
  test("splits a multi-hunk -U0 diff with kinds and positions", () => {
    const diff = [
      "diff --git a/f b/f", "--- a/f", "+++ b/f",
      "@@ -3,2 +3,2 @@ ctx", "-old a", "-old b", "+new a", "+new b",
      "@@ -6,0 +7,3 @@", "+i1", "+i2", "+i3",
      "@@ -11 +13,0 @@", "-gone",
    ].join("\n");
    const h = parseHunks(diff);
    expect(h.map((x) => [x.newStart, x.newLines, x.kind])).toEqual([
      [3, 2, "modified"], [7, 3, "added"], [13, 0, "deleted"],
    ]);
    expect(h[0].patch).toContain("-old a");
    expect(h[0].patch).toContain("+new b");
    expect(h[0].patch).not.toContain("+i1"); // hunks don't bleed into each other
  });

  test("keeps the no-newline marker inside the owning hunk", () => {
    const h = parseHunks("@@ -1 +1 @@\n-a\n+b\n\\ No newline at end of file");
    expect(h).toHaveLength(1);
    expect(h[0].patch).toContain("\\ No newline");
  });

  test("empty and non-diff input produce no hunks", () => {
    expect(parseHunks("")).toEqual([]);
    expect(parseHunks("fatal: not a repository")).toEqual([]);
  });
});

describe("withContext", () => {
  const lines = Array.from({ length: 20 }, (_, i) => `L${i + 1}`);

  test("mid-file modification gets 3+3 context and a recomputed header", () => {
    const h = { oldStart: 10, oldLines: 1, newStart: 10, newLines: 1,
      kind: "modified", patch: "@@ -10 +10 @@\n-old\n+L10" };
    const out = withContext(h, lines, 3);
    expect(out.patch.split("\n")[0]).toBe("@@ -7,7 +7,7 @@");
    expect(out.patch).toContain(" L7");   // context above
    expect(out.patch).toContain(" L13");  // context below
    expect(out.patch).not.toContain(" L6");
    expect(out.newStart).toBe(10);        // mark geometry untouched
  });

  test("clips context at file start", () => {
    const h = { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1,
      kind: "modified", patch: "@@ -1 +1 @@\n-x\n+L1" };
    expect(withContext(h, lines, 3).patch.split("\n")[0]).toBe("@@ -1,4 +1,4 @@");
  });

  test("clips context at EOF", () => {
    const h = { oldStart: 20, oldLines: 1, newStart: 20, newLines: 1,
      kind: "modified", patch: "@@ -20 +20 @@\n-x\n+L20" };
    expect(withContext(h, lines, 3).patch.split("\n")[0]).toBe("@@ -17,4 +17,4 @@");
  });

  test("pure addition uses the count-0 +1 header convention", () => {
    const h = { oldStart: 6, oldLines: 0, newStart: 7, newLines: 3,
      kind: "added", patch: "@@ -6,0 +7,3 @@\n+a\n+b\n+c" };
    expect(withContext(h, lines, 3).patch.split("\n")[0]).toBe("@@ -4,6 +4,9 @@");
  });

  test("pure deletion anchors context around the cut point", () => {
    const h = { oldStart: 11, oldLines: 1, newStart: 13, newLines: 0,
      kind: "deleted", patch: "@@ -11 +13,0 @@\n-gone" };
    const first = withContext(h, lines, 3).patch.split("\n")[0];
    expect(first).toBe("@@ -8,7 +11,6 @@");
  });
});
