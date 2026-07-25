import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { makeFixtureRepo, makePlainDir, startFixtureServer } from "../fixture.js";

let srv, plain;
beforeAll(async () => {
  srv = await startFixtureServer(makeFixtureRepo(), 7511);
  plain = await startFixtureServer(makePlainDir(), 7521);
});
afterAll(async () => { await srv?.cleanup(); await plain?.cleanup(); });

const findNode = (tree, path) => {
  for (const n of tree) {
    if (n.path === path) return n;
    if (n.dir && path.startsWith(n.path + "/")) return findNode(n.children, path);
  }
  return null;
};

describe("/api/tree", () => {
  test("statuses, ignored flags, dirty propagation", async () => {
    const { status, body } = await srv.json("/api/tree");
    expect(status).toBe(200);
    expect(body.isRepo).toBe(true);
    expect(findNode(body.tree, "src/util.py").status).toBe("M");
    expect(findNode(body.tree, "docs/new.md").status).toBe("U");
    expect(findNode(body.tree, "README.md").status).toBeNull();
    expect(findNode(body.tree, "ignored.log").ignored).toBe(true);
    // dirty dot propagates to ancestors of changes, not clean dirs
    expect(findNode(body.tree, "src").dirty).toBe(true);
    expect(findNode(body.tree, "docs").dirty).toBe(true);
    // negative case: a committed, untouched dir/file must NOT be flagged
    // (bigdir's 510 files are untracked → dirty true, so it can't serve as
    // the negative here — cleandir is committed and never modified)
    expect(findNode(body.tree, "cleandir").dirty).toBe(false);
    expect(findNode(body.tree, "README.md").ignored).toBe(false);
    // .git never appears
    expect(findNode(body.tree, ".git")).toBeNull();
  });

  test("ignored dirs are listed but not walked (incident 97ef45d)", async () => {
    const { body } = await srv.json("/api/tree");
    const ig = findNode(body.tree, "ignored-dir");
    expect(ig.ignored).toBe(true);
    expect(ig.children).toEqual([]);
  });

  test("dangling symlinks crash nothing (incident e30232f)", async () => {
    const { status, body } = await srv.json("/api/tree");
    expect(status).toBe(200);
    const lf = findNode(body.tree, "linkfarm");
    expect(lf.dir).toBe(true); // symlink entries themselves are skipped, dir survives
    expect(lf.children.every((c) => c.name !== "dangling")).toBe(true);
  });

  test("oversized dirs cap at 500 entries with a truncated row (incident dd900e4)", async () => {
    const { body } = await srv.json("/api/tree");
    const big = findNode(body.tree, "bigdir");
    expect(big.children.length).toBe(501);
    const last = big.children[big.children.length - 1];
    expect(last.truncated).toBe(true);
    expect(last.name).toContain("more entries");
  });
});

describe("/api/file", () => {
  test("modified file → separated per-change hunks with context (incidents 0314503/42336df)", async () => {
    const { body } = await srv.json("/api/file?path=src/util.py");
    expect(body.status).toBe("M");
    expect(body.hunks.map((h) => [h.newStart, h.kind])).toEqual([
      [3, "modified"], [7, "added"], [13, "deleted"], [15, "added"],
    ]);
    const first = body.hunks[0];
    expect(first.patch).toContain("-def load(path):");
    expect(first.patch).toContain('+def load(path, mode="r"):');
    expect(first.patch).toContain(" import os");            // context above
    expect(first.patch).toContain("        return f.read()"); // context below
    expect(first.patch).not.toContain("+def exists");       // neighbor's additions never merge in
  });

  test("untracked file → single added hunk; binary → flagged, no content", async () => {
    const nw = (await srv.json("/api/file?path=docs/new.md")).body;
    expect(nw.status).toBe("U");
    expect(nw.hunks).toHaveLength(1);
    expect(nw.hunks[0].kind).toBe("added");
    const bin = (await srv.json("/api/file?path=data.bin")).body;
    expect(bin.binary).toBe(true);
    expect(bin.content).toBeNull();
    expect(bin.hunks).toEqual([]);
  });

  test("missing paths and traversal → 404", async () => {
    expect((await fetch(`${srv.base}/api/file?path=nope.txt`)).status).toBe(404);
    expect((await fetch(`${srv.base}/api/file?path=../../etc/passwd`)).status).toBe(404);
    expect((await fetch(`${srv.base}/api/file?path=.git/config`)).status).toBe(404);
  });
});

describe("/raw", () => {
  test("serves bytes; guards traversal", async () => {
    const r = await fetch(`${srv.base}/raw/README.md`);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("# Fixture");
    // A literal "../../etc/passwd" is collapsed by fetch's own URL parser
    // before the request ever leaves the browser/client (dot-segment
    // removal), landing on "/etc/passwd" — a vacuous test of the server's
    // guard. Percent-encoding the slashes (%2f) keeps ".." inside an opaque
    // path segment the URL parser won't normalize, so this actually reaches
    // safePath server-side (decodeURIComponent → "../../etc/passwd" → null).
    expect((await fetch(`${srv.base}/raw/%2e%2e%2f%2e%2e%2fetc/passwd`)).status).toBe(404);
  });
});

describe("non-git directory degrades gracefully", () => {
  test("serves tree and files with no git decoration", async () => {
    const { body } = await plain.json("/api/tree");
    expect(body.isRepo).toBe(false);
    expect(findNode(body.tree, "note.md").status).toBeNull();
    const f = (await plain.json("/api/file?path=note.md")).body;
    expect(f.hunks).toEqual([]);
    expect(f.content).toContain("# No git here");
  });
});
