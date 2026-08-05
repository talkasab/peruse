import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import chokidar from "chokidar";
import { startServer } from "../../server/index.js";
import { registerProject, registryPath, removeProject } from "../../server/projects.js";

// Composed #17 + #28 lifecycle: these scenarios exist only with both the
// watcher-recovery readiness contract (issue #17) and the enumeration
// cache/invalidation paths (issue #28) present, so they live here rather than
// in either branch's own suite. Every wait is bounded so a regression fails
// instead of hanging.

const DEADLINE = 1500;

async function within(promise, label, ms = DEADLINE) {
  return Promise.race([
    promise,
    Bun.sleep(ms).then(() => {
      throw new Error(`${label} exceeded ${ms} ms`);
    }),
  ]);
}

function git(cwd, ...args) {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

function makeRepo({ poison = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "peruse-composed-"));
  git(root, "init", "-q");
  git(root, "config", "user.email", "t@e.st");
  git(root, "config", "user.name", "Test");
  writeFileSync(join(root, "README.md"), "# Composed lifecycle\n");
  git(root, "add", ".");
  git(root, "commit", "-qm", "initial");
  // A link *through* a regular file fails realpath() with ENOTDIR, which
  // destroys chokidar's listing and leaves readiness pending (issue #17).
  if (poison) symlinkSync(join(root, "README.md", "nope"), join(root, "scan-breaker"));
  return root;
}

async function startFixture(port, { poison = false } = {}) {
  const root = makeRepo({ poison });
  const configDir = mkdtempSync(join(tmpdir(), "peruse-composed-config-"));
  const configFile = registryPath(configDir);
  const project = registerProject(root, { file: configFile });
  const server = await startServer({
    configFile,
    host: "127.0.0.1",
    port,
    watchBudget: 100,
    enumerationTtlMs: 60_000,
  });
  const base = `http://127.0.0.1:${server.port}/p/${encodeURIComponent(project.name)}`;
  return {
    root,
    configFile,
    project,
    server,
    base,
    async cleanup() {
      await server.stop();
      rmSync(root, { recursive: true, force: true });
      rmSync(configDir, { recursive: true, force: true });
    },
  };
}

function collectRejections() {
  const seen = [];
  const listener = (reason) => seen.push(reason);
  process.on("unhandledRejection", listener);
  return {
    seen,
    async assertNone() {
      await Bun.sleep(0);
      process.off("unhandledRejection", listener);
      expect(seen).toEqual([]);
    },
  };
}

function countWatchers() {
  const originalWatch = chokidar.watch;
  const state = { created: 0 };
  chokidar.watch = (...args) => {
    state.created++;
    return originalWatch(...args);
  };
  return {
    state,
    restore() {
      chokidar.watch = originalWatch;
    },
  };
}

let fixture;
afterEach(async () => {
  await fixture?.cleanup();
  fixture = null;
});

describe("composed watcher/cache lifecycle (#17 + #28)", () => {
  test("route invalidation settles a request awaiting a scan-broken runtime", async () => {
    const rejections = collectRejections();
    fixture = await startFixture(7581, { poison: true });
    // The stall watchdog needs 3 s of quiet before recovery, so 300 ms in the
    // scan is squarely inside the pending-readiness window.
    const first = fetch(`${fixture.base}/api/tree`);
    await Bun.sleep(300);
    expect(removeProject(fixture.project.name, fixture.configFile)).toBe(1);
    // The same cached route, not the listing: this drives resolveProject's
    // invalidation path, which closes the pending runtime.
    const invalidator = await within(fetch(`${fixture.base}/api/tree`), "invalidating request");
    expect(invalidator.status).toBe(404);
    const original = await within(first, "request awaiting closed readiness");
    expect(original.status).toBe(404);
    await rejections.assertNone();
  });

  test("concurrent cold and retry waves each create exactly one runtime", async () => {
    const watchers = countWatchers();
    try {
      fixture = await startFixture(7582);
      const cold = await within(
        Promise.all(Array.from({ length: 20 }, () => fetch(`${fixture.base}/raw/README.md`))),
        "cold request wave",
        8000,
      );
      expect(cold.map((r) => r.status)).toEqual(Array(20).fill(200));
      expect(watchers.state.created).toBe(1);

      // Invalidate, re-register the same path (new registry identity), and
      // prove the retry wave coalesces into one fresh runtime too.
      expect(removeProject(fixture.project.name, fixture.configFile)).toBe(1);
      expect((await fetch(`${fixture.base}/raw/README.md`)).status).toBe(404);
      const again = registerProject(fixture.root, { file: fixture.configFile });
      const retryBase = `http://127.0.0.1:${fixture.server.port}/p/${encodeURIComponent(again.name)}`;
      const retry = await within(
        Promise.all(Array.from({ length: 20 }, () => fetch(`${retryBase}/raw/README.md`))),
        "retry request wave",
        8000,
      );
      expect(retry.map((r) => r.status)).toEqual(Array(20).fill(200));
      expect(watchers.state.created).toBe(2);
    } finally {
      watchers.restore();
    }
  });

  test("a recovered fallback runtime invalidated through the cache ends its SSE stream", async () => {
    const rejections = collectRejections();
    fixture = await startFixture(7583, { poison: true });
    // Recovery resolves readiness after the ~3 s stall inspection; the first
    // request completing proves the fallback path is active.
    const tree = await within(fetch(`${fixture.base}/api/tree`), "recovered tree", 8000);
    expect(tree.status).toBe(200);

    const events = await within(fetch(`${fixture.base}/api/events`), "SSE connect");
    expect(events.status).toBe(200);
    const reader = events.body.getReader();
    await within(reader.read(), "SSE preamble");

    expect(removeProject(fixture.project.name, fixture.configFile)).toBe(1);
    expect((await within(fetch(`${fixture.base}/api/tree`), "invalidator")).status).toBe(404);

    // Teardown must end the stream (EOF), not leave it silently attached.
    const drain = (async () => {
      while (true) {
        const { done } = await reader.read();
        if (done) return true;
      }
    })();
    expect(await within(drain, "SSE EOF after invalidation")).toBe(true);
    await rejections.assertNone();
  });
});
