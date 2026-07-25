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
    // Walks forward from the busy port; exactly +1 isn't guaranteed (another
    // process could hold a nearby port), just that it moved forward and
    // stayed within the documented +20 search window.
    expect(b.port).toBeGreaterThan(a.port);
    expect(b.port).toBeLessThanOrEqual(a.port + 20);
    // A throw here must not leak the watcher/ping-timer it already started
    // before hitting EADDRINUSE — startServer closes both on the way out
    // (previously it didn't, and this test had no cleanup handle for that
    // failed instance to close them itself).
    let err = null;
    const dir = makePlainDir();
    try { await startServer({ root: dir, port: a.port, host: "127.0.0.1", portFixed: true }); }
    catch (e) { err = e; }
    finally { rmSync(dir, { recursive: true, force: true }); }
    expect(err?.code).toBe("EADDRINUSE");
  });

  test("survives symlinks in the tree and a tiny watch budget (incidents e30232f/2be1239)", async () => {
    // budget of 2: watcher admits almost nothing — server must stay fully alive
    const s = await startFixtureServer(makeFixtureRepo(), 7551, { budget: 2 });
    cleanups.push(s.cleanup);
    const { status, body } = await s.json("/api/tree");
    expect(status).toBe(200);
    // the gitignored dir is present in the listing (unwalked), and nothing
    // crashed despite the fixture's dangling symlinks
    expect(body.tree.some((n) => n.name === "ignored-dir")).toBe(true);
    const f = await s.json("/api/file?path=src/util.py");
    expect(f.status).toBe(200);
    expect(f.body.hunks.length).toBe(4);
  });
});
