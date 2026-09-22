import { afterEach, describe, expect, test } from "bun:test";
import { watch as fsWatch, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../../server/index.js";
import { registerProject, registryPath, removeProject } from "../../server/projects.js";

// Runtime creation, cache invalidation, and SSE teardown share these checks.

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
  // Bun skips this ENOTDIR symlink and continues watching its siblings.
  if (poison) symlinkSync(join(root, "README.md", "nope"), join(root, "scan-breaker"));
  return root;
}

async function startFixture(port, { poison = false, watchFactory = fsWatch } = {}) {
  const root = makeRepo({ poison });
  const configDir = mkdtempSync(join(tmpdir(), "peruse-composed-config-"));
  const configFile = registryPath(configDir);
  const project = registerProject(root, { file: configFile });
  const server = await startServer({
    configFile,
    host: "127.0.0.1",
    port,
    enumerationTtlMs: 60_000,
    watchFactory,
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
  const state = { created: 0 };
  return {
    state,
    watchFactory(...args) {
      state.created++;
      return fsWatch(...args);
    },
  };
}

let fixture;
afterEach(async () => {
  await fixture?.cleanup();
  fixture = null;
});

describe("watcher and route cache lifecycle", () => {
  test("concurrent cold and retry waves each create exactly one runtime", async () => {
    const watchers = countWatchers();
    try {
      fixture = await startFixture(7582, { watchFactory: watchers.watchFactory });
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
      await fixture?.cleanup();
      fixture = null;
    }
  });

  test("a native watcher invalidated through the cache ends its SSE stream", async () => {
    const rejections = collectRejections();
    fixture = await startFixture(7583, { poison: true });
    // The poisoned symlink does not delay the first request.
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
