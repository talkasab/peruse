// Issue #28: project enumeration costs two git spawns per registered project.
// Before caching, every asset request under /p/<name>/ paid that price again.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../../server/index.js";
import { createProjectEnumerator, registerProject, registryPath } from "../../server/projects.js";

const PROJECTS = 10;
const REQUESTS = 20;
const SHORT_TTL = 200;

let root, configDir, configFile, repo, cached, uncached, brief, restoreSpawn;
/** Measured, not assumed: one `rev-parse` per project plus one `worktree list` per repo. */
let perEnumeration = 0;

/** Count only the spawns enumeration makes, not the status/diff calls a request needs. */
const spawns = { enumeration: 0, totalGit: 0 };
function instrumentSpawn() {
  const original = Bun.spawn;
  Bun.spawn = (...args) => {
    const argv = Array.isArray(args[0]) ? args[0] : (args[0]?.cmd ?? []);
    if (argv[0] === "git") {
      spawns.totalGit++;
      if (argv.includes("--show-toplevel") || argv.includes("worktree")) spawns.enumeration++;
    }
    return original(...args);
  };
  return () => {
    Bun.spawn = original;
  };
}

function git(cwd, ...args) {
  Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "peruse-enum-"));
  configDir = mkdtempSync(join(tmpdir(), "peruse-enum-config-"));
  configFile = registryPath(configDir);

  for (let i = 1; i <= PROJECTS; i++) {
    const project = join(root, `repo-${i}`);
    mkdirSync(project);
    git(project, "init", "-q");
    git(project, "config", "user.email", "t@e.st");
    git(project, "config", "user.name", "Test");
    writeFileSync(join(project, "README.md"), `# Repository ${i}\n`);
    writeFileSync(join(project, "shot.png"), "not really a png\n");
    git(project, "add", ".");
    git(project, "commit", "-qm", "initial");
    registerProject(project, { file: configFile, name: `repo-${i}` });
    if (i === 1) repo = project;
  }
  git(repo, "worktree", "add", "-qb", "topic", join(root, "linked"));

  const base = { configFile, host: "127.0.0.1", watchBudget: 100 };
  cached = await startServer({ ...base, port: 7573, enumerationTtlMs: 60_000 });
  uncached = await startServer({ ...base, port: 7574, enumerationTtlMs: 0 });
  brief = await startServer({ ...base, port: 7575, enumerationTtlMs: SHORT_TTL });
  restoreSpawn = instrumentSpawn();
  perEnumeration = PROJECTS * 2;
});

afterAll(async () => {
  restoreSpawn?.();
  await cached?.stop();
  await uncached?.stop();
  await brief?.stop();
  rmSync(root, { recursive: true, force: true });
  rmSync(configDir, { recursive: true, force: true });
});

function resetSpawns() {
  spawns.enumeration = 0;
  spawns.totalGit = 0;
}

/** A real client sequence: root, project navigation/listing, tree, file, and assets. */
async function loadRealisticSequence(port) {
  const origin = `http://127.0.0.1:${port}`;
  const base = `${origin}/p/repo-1`;
  expect((await fetch(`${origin}/`)).status).toBe(200);
  expect((await fetch(`${base}/`)).status).toBe(200);
  expect((await fetch(`${origin}/api/projects`)).status).toBe(200);
  expect((await fetch(`${base}/api/tree`)).status).toBe(200);
  expect((await fetch(`${base}/api/file?path=README.md`)).status).toBe(200);
  const assets = await Promise.all(
    Array.from({ length: REQUESTS }, () => fetch(`${base}/raw/shot.png`)),
  );
  expect(assets.every((response) => response.status === 200)).toBe(true);
  return { ...spawns };
}

describe("enumeration caching", () => {
  test("a realistic navigation measures enumeration and total git spawns", async () => {
    resetSpawns();
    const before = await loadRealisticSequence(uncached.port);

    resetSpawns();
    const after = await loadRealisticSequence(cached.port);
    // The four sequential route requests enumerate separately; the concurrent
    // asset burst shares its pending enumeration even with result caching off.
    expect(before.enumeration).toBe(perEnumeration * 5);
    expect(before.totalGit).toBe(134);
    expect(after.enumeration).toBe(perEnumeration);
    expect(after.totalGit).toBe(54);
  });

  test("concurrent asset requests share one in-flight enumeration", async () => {
    const base = `http://127.0.0.1:${brief.port}/p/repo-1`;
    // Age out anything cached, then race the refill.
    await Bun.sleep(SHORT_TTL + 50);
    resetSpawns();
    const responses = await Promise.all(
      Array.from({ length: REQUESTS }, () => fetch(`${base}/raw/shot.png`)),
    );
    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(spawns.enumeration).toBe(perEnumeration);
  });

  test("a worktree added while the server runs appears once the window passes", async () => {
    const origin = `http://127.0.0.1:${brief.port}`;
    const listing = async () =>
      (await (await fetch(`${origin}/api/projects`)).json()).projects.map(
        (project) => project.routeName,
      );
    expect(await listing()).toContain("repo-1:topic");

    git(repo, "worktree", "add", "-qb", "later", join(root, "later"));
    await Bun.sleep(SHORT_TTL + 50);
    expect(await listing()).toContain("repo-1:later");
    expect((await fetch(`${origin}/p/repo-1%3Alater/api/tree`)).status).toBe(200);
  });

  test("a cached linked-worktree route rejects a replacement directory", async () => {
    const origin = `http://127.0.0.1:${brief.port}`;
    const replacement = join(root, "replacement");
    git(repo, "worktree", "add", "-qb", "replacement", replacement);
    await Bun.sleep(SHORT_TTL + 50);
    expect((await fetch(`${origin}/p/repo-1%3Areplacement/raw/shot.png`)).status).toBe(200);

    git(repo, "worktree", "remove", "--force", replacement);
    mkdirSync(replacement);
    writeFileSync(join(replacement, "shot.png"), "unrelated directory\n");
    expect((await fetch(`${origin}/p/repo-1%3Areplacement/raw/shot.png`)).status).toBe(404);
  });

  test("a project that disappears inside the cache window still 404s", async () => {
    const origin = `http://127.0.0.1:${cached.port}`;
    const listing = async () =>
      (await (await fetch(`${origin}/api/projects`)).json()).projects.find(
        (project) => project.routeName === "repo-10",
      );
    expect((await listing()).missing).toBe(false);
    expect((await fetch(`${origin}/p/repo-10/api/tree`)).status).toBe(200);
    rmSync(join(root, "repo-10"), { recursive: true, force: true });
    expect((await fetch(`${origin}/p/repo-10/api/tree`)).status).toBe(404);
    expect((await listing()).missing).toBe(true);
  });

  test("a registered root replacement cannot reuse a cached route", async () => {
    const origin = `http://127.0.0.1:${cached.port}`;
    const project = join(root, "repo-9");
    expect((await fetch(`${origin}/p/repo-9/raw/shot.png`)).status).toBe(200);
    rmSync(project, { recursive: true, force: true });
    mkdirSync(project);
    writeFileSync(join(project, "shot.png"), "unrelated plain directory\n");
    expect((await fetch(`${origin}/p/repo-9/raw/shot.png`)).status).toBe(404);
  });

  test("listing closes a runtime when a collision suffix is reassigned", async () => {
    const collisionRoot = mkdtempSync(join(tmpdir(), "peruse-route-collision-"));
    const collisionConfig = mkdtempSync(join(tmpdir(), "peruse-route-collision-config-"));
    const collisionRepo = join(collisionRoot, "repo");
    const first = join(collisionRoot, "first");
    const second = join(collisionRoot, "second");
    mkdirSync(collisionRepo);
    git(collisionRepo, "init", "-q");
    git(collisionRepo, "config", "user.email", "t@e.st");
    git(collisionRepo, "config", "user.name", "Test");
    writeFileSync(join(collisionRepo, "README.md"), "# Collision fixture\n");
    git(collisionRepo, "add", ".");
    git(collisionRepo, "commit", "-qm", "initial");
    git(collisionRepo, "worktree", "add", "-qb", "one/topic", first);
    git(collisionRepo, "worktree", "add", "-qb", "two/topic", second);
    const collisionFile = registryPath(collisionConfig);
    const project = registerProject(collisionRepo, { file: collisionFile, name: "collision" });
    const collisionServer = await startServer({
      configFile: collisionFile,
      host: "127.0.0.1",
      port: 7576,
      watchBudget: 100,
      enumerationTtlMs: SHORT_TTL,
    });
    const origin = `http://127.0.0.1:${collisionServer.port}`;
    let reader;
    try {
      const listed = (await (await fetch(`${origin}/api/projects`)).json()).projects;
      const firstTarget = listed.find((target) => target.path === first);
      const secondTarget = listed.find((target) => target.path === second);
      expect(firstTarget.routeName).toBe(`${project.name}:topic`);
      expect(secondTarget.routeName).toBe(`${project.name}:topic-2`);

      const response = await fetch(
        `${origin}/p/${encodeURIComponent(firstTarget.routeName)}/api/events`,
      );
      reader = response.body.getReader();
      expect((await reader.read()).done).toBe(false);

      git(collisionRepo, "worktree", "remove", "--force", first);
      await Bun.sleep(SHORT_TTL + 50);
      const reassigned = (await (await fetch(`${origin}/api/projects`)).json()).projects.find(
        (target) => target.path === second,
      );
      expect(reassigned.routeName).toBe(firstTarget.routeName);
      const result = await Promise.race([
        reader.read().then(({ done }) => (done ? "eof" : "data")),
        Bun.sleep(1000).then(() => "timeout"),
      ]);
      expect(result).toBe("eof");
    } finally {
      reader?.cancel().catch(() => {});
      await collisionServer.stop();
      rmSync(collisionRoot, { recursive: true, force: true });
      rmSync(collisionConfig, { recursive: true, force: true });
    }
  });

  test("PERUSE_ENUM_TTL_MS uses strict parsing", async () => {
    const previous = process.env.PERUSE_ENUM_TTL_MS;
    try {
      for (const [value, expectedCalls] of [
        [undefined, 1],
        ["", 1],
        ["   ", 1],
        ["garbage", 1],
        ["-1", 1],
        ["+0", 1],
        ["-0", 1],
        ["00", 1],
        ["01", 1],
        ["1.0", 1],
        ["1e3", 1],
        ["9007199254740992", 1],
        ["0", 2],
        [" 0", 1],
        ["0 ", 1],
        [" 0 ", 1],
        ["25", 1],
      ]) {
        if (value === undefined) delete process.env.PERUSE_ENUM_TTL_MS;
        else process.env.PERUSE_ENUM_TTL_MS = value;
        let calls = 0;
        const enumerate = createProjectEnumerator({
          enumerate: async () => {
            calls++;
            return [];
          },
        });
        await enumerate([]);
        await enumerate([]);
        expect(calls).toBe(expectedCalls);
      }
    } finally {
      if (previous === undefined) delete process.env.PERUSE_ENUM_TTL_MS;
      else process.env.PERUSE_ENUM_TTL_MS = previous;
    }
  });
});
