import { describe, expect, test } from "bun:test";
import { watch as fsWatch, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProjectRuntime, startServer } from "../../server/index.js";
import { registerProject, registryPath, removeProject } from "../../server/projects.js";

const DEADLINE = 1500;

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function within(promise, label) {
  return Promise.race([
    promise,
    Bun.sleep(DEADLINE).then(() => {
      throw new Error(`${label} exceeded ${DEADLINE} ms`);
    }),
  ]);
}

async function expectPending(promise) {
  const state = await Promise.race([
    promise.then(
      () => "fulfilled",
      () => "rejected",
    ),
    Bun.sleep(75).then(() => "pending"),
  ]);
  expect(state).toBe("pending");
}

function git(cwd, ...args) {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), "peruse-runtime-lifecycle-"));
  git(root, "init", "-q");
  git(root, "config", "user.email", "t@e.st");
  git(root, "config", "user.name", "Test");
  writeFileSync(join(root, "README.md"), "# Runtime lifecycle\n");
  git(root, "add", ".");
  git(root, "commit", "-qm", "initial");
  return root;
}

async function startFixture(port, watchFactory = fsWatch) {
  const root = makeRepo();
  const configDir = mkdtempSync(join(tmpdir(), "peruse-runtime-lifecycle-config-"));
  const configFile = registryPath(configDir);
  const project = registerProject(root, { file: configFile });
  const server = await startServer({
    configFile,
    host: "127.0.0.1",
    port,
    watchFactory,
    enumerationTtlMs: 60_000,
  });
  const base = `http://127.0.0.1:${server.port}/p/${encodeURIComponent(project.name)}`;
  return {
    root,
    configDir,
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

function delayRuntimeStatus(root) {
  const originalSpawn = Bun.spawn;
  const entered = deferred();
  const release = deferred();
  Bun.spawn = (...args) => {
    const process = originalSpawn(...args);
    const command = Array.isArray(args[0]) ? args[0] : (args[0]?.cmd ?? []);
    if (args[1]?.cwd !== root || !command.includes("status")) return process;
    const stdout = process.stdout;
    return {
      stdout: {
        async text() {
          const output = await stdout.text();
          entered.resolve();
          await release.promise;
          return output;
        },
      },
      exited: process.exited,
    };
  };
  return {
    entered: entered.promise,
    release: release.resolve,
    restore() {
      Bun.spawn = originalSpawn;
    },
  };
}

function watchCloseProbe({ delayed = false } = {}) {
  const entered = deferred();
  const release = deferred();
  const state = { watchers: 0, calls: 0, completed: 0 };
  const watchFactory = (...args) => {
    const watcher = fsWatch(...args);
    state.watchers++;
    const originalClose = watcher.close.bind(watcher);
    watcher.close = async () => {
      state.calls++;
      entered.resolve();
      if (delayed) await release.promise;
      await originalClose();
      state.completed++;
    };
    return watcher;
  };
  return {
    watchFactory,
    state,
    entered: entered.promise,
    release: release.resolve,
  };
}

describe("runtime lifecycle shutdown", () => {
  test("stop neutralizes and awaits a delayed runtime start", async () => {
    const closes = watchCloseProbe();
    const fixture = await startFixture(7577, closes.watchFactory);
    const start = delayRuntimeStatus(fixture.root);
    let request;
    try {
      request = fetch(`${fixture.base}/raw/README.md`).catch(() => null);
      await within(start.entered, "runtime git-status boundary");

      const stopping = fixture.server.stop();
      await expectPending(stopping);
      expect(closes.state.watchers).toBe(0);

      start.release();
      await within(stopping, "stop after delayed runtime start");
      await within(request, "request interrupted by stop");
      expect(closes.state).toEqual({ watchers: 1, calls: 1, completed: 1 });

      await within(fixture.server.stop(), "idempotent second stop");
      expect(closes.state.calls).toBe(1);
    } finally {
      start.release();
      closes.release();
      start.restore();
      await fixture.cleanup();
    }
  });

  test("stop awaits a close already detached by invalidation", async () => {
    const closes = watchCloseProbe({ delayed: true });
    const fixture = await startFixture(7578, closes.watchFactory);
    let invalidation;
    try {
      expect((await fetch(`${fixture.base}/raw/README.md`)).status).toBe(200);
      expect(removeProject(fixture.project.name, fixture.configFile)).toBe(1);
      invalidation = fetch(`${fixture.base}/raw/README.md`).catch(() => null);
      await within(closes.entered, "invalidation watcher close");

      const stopping = fixture.server.stop();
      await expectPending(stopping);
      expect(closes.state.completed).toBe(0);

      closes.release();
      await within(stopping, "stop after detached close");
      await within(invalidation, "invalidating request");
      expect(closes.state).toEqual({ watchers: 1, calls: 1, completed: 1 });
    } finally {
      closes.release();
      await fixture.cleanup();
    }
  });

  test("concurrent close callers receive the same runtime teardown promise", async () => {
    const root = makeRepo();
    const closes = watchCloseProbe({ delayed: true });
    try {
      const runtime = await within(
        createProjectRuntime(root, { path: root }, closes.watchFactory),
        "runtime creation",
      );
      await within(runtime.ready, "watcher readiness");

      const first = runtime.close();
      await within(closes.entered, "first watcher close");
      const second = runtime.close();
      expect(second).toBe(first);
      await expectPending(first);
      await expectPending(second);
      expect(closes.state).toEqual({ watchers: 1, calls: 1, completed: 0 });

      closes.release();
      await within(Promise.all([first, second]), "concurrent stops");
      expect(closes.state).toEqual({ watchers: 1, calls: 1, completed: 1 });
    } finally {
      closes.release();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
