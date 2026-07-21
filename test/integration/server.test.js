import { describe, test, expect, afterAll } from "bun:test";
import { makeFixtureRepo, makePlainDir, startFixtureServer } from "../fixture.js";
import { startServer } from "../../server/index.js";
import { rmSync } from "node:fs";

const cleanups = [];
afterAll(async () => { for (const c of cleanups.reverse()) await c(); });

describe("startup behaviors", () => {
  test("port fallback walks forward; pinned port fails loudly", async () => {
    const a = await startFixtureServer(makePlainDir(), 7541);
    cleanups.push(a.cleanup);
    const b = await startFixtureServer(makePlainDir(), 7541);
    cleanups.push(b.cleanup);
    expect(b.port).toBe(a.port + 1);
    let err = null;
    const dir = makePlainDir();
    try { await startServer({ root: dir, port: a.port, host: "127.0.0.1", portFixed: true }); }
    catch (e) { err = e; }
    finally { rmSync(dir, { recursive: true, force: true }); }
    expect(err?.code).toBe("EADDRINUSE");
  });

  test("survives sockets/symlinks in the tree and a tiny watch budget (incidents e30232f/2be1239)", async () => {
    // budget of 2: watcher admits almost nothing — server must stay fully alive
    const s = await startFixtureServer(makeFixtureRepo(), 7551, { budget: 2 });
    cleanups.push(s.cleanup);
    const { status, body } = await s.json("/api/tree");
    expect(status).toBe(200);
    // the dangling symlink dir is present, unwalked, and nothing crashed
    expect(body.tree.some((n) => n.name === "ignored-dir")).toBe(true);
    const f = await s.json("/api/file?path=src/util.py");
    expect(f.status).toBe(200);
    expect(f.body.hunks.length).toBe(4);
  });
});
