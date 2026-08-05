import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createProjectEnumerator,
  enumerateProjects,
  gitSummary,
  isCurrentProjectTarget,
  isCurrentWorktreeTarget,
  MISSING_GRACE_MS,
  parseWorktreeList,
  pruneProjects,
  readProjects,
  registerProject,
  registryPath,
  removeProject,
} from "../../server/projects.js";

const cleanups = [];
afterEach(() => {
  for (const path of cleanups.splice(0)) rmSync(path, { recursive: true, force: true });
});

function temporaryConfig() {
  const root = mkdtempSync(join(tmpdir(), "peruse-projects-test-"));
  cleanups.push(root);
  return { root, file: registryPath(join(root, "config")) };
}

describe("project registry", () => {
  test("registers canonical paths, updates lastOpened, and resolves name collisions", () => {
    const { root, file } = temporaryConfig();
    const one = join(root, "one", "same");
    const two = join(root, "two", "same");
    mkdirSync(one, { recursive: true });
    mkdirSync(two, { recursive: true });

    const first = registerProject(one, { file, now: new Date("2026-01-01T00:00:00Z") });
    const second = registerProject(two, { file, now: new Date("2026-01-02T00:00:00Z") });
    const reopened = registerProject(one, { file, now: new Date("2026-01-03T00:00:00Z") });

    expect(first.name).toBe("same");
    expect(second.name).toBe("same-2");
    expect(reopened.name).toBe("same");
    expect(readProjects(file)).toHaveLength(2);
    expect(readProjects(file)[0].lastOpened).toBe("2026-01-03T00:00:00.000Z");
  });

  test("keeps a first miss, ages it, then prunes after the grace period", () => {
    const { root, file } = temporaryConfig();
    const projectPath = join(root, "gone-later");
    mkdirSync(projectPath);
    registerProject(projectPath, { file });
    rmSync(projectPath, { recursive: true });

    const firstMiss = new Date("2026-02-01T00:00:00Z");
    expect(pruneProjects({ file, now: firstMiss }).removed).toEqual([]);
    expect(readProjects(file)[0].missingSince).toBe(firstMiss.toISOString());
    expect(
      pruneProjects({ file, now: new Date(firstMiss.getTime() + MISSING_GRACE_MS - 1) }).removed,
    ).toEqual([]);
    expect(
      pruneProjects({ file, now: new Date(firstMiss.getTime() + MISSING_GRACE_MS) }).removed,
    ).toHaveLength(1);
    expect(readProjects(file)).toEqual([]);
  });

  test("explicit prune removes missing entries immediately", () => {
    const { root, file } = temporaryConfig();
    const projectPath = join(root, "gone-now");
    mkdirSync(projectPath);
    registerProject(projectPath, { file });
    rmSync(projectPath, { recursive: true });
    expect(pruneProjects({ file, immediate: true }).removed.map((entry) => entry.name)).toEqual([
      "gone-now",
    ]);
  });

  test("removal gives an exact project name precedence over a matching path", () => {
    const { root, file } = temporaryConfig();
    const pathProject = join(root, "path-project");
    const namedProject = join(root, "named-project");
    mkdirSync(pathProject);
    mkdirSync(namedProject);
    registerProject(namedProject, { file, name: pathProject });
    registerProject(pathProject, { file, name: "different-name" });

    expect(removeProject(pathProject, file)).toBe(1);
    expect(readProjects(file).map((project) => project.name)).toEqual(["different-name"]);
  });

  test("removes a canonically registered project through its symlink path", () => {
    const { root, file } = temporaryConfig();
    const target = join(root, "target");
    const link = join(root, "link");
    mkdirSync(target);
    symlinkSync(target, link, "dir");
    registerProject(link, { file });

    expect(removeProject(link, file)).toBe(1);
    expect(readProjects(file)).toEqual([]);
  });
});

describe("worktree discovery", () => {
  test("parses porcelain records", () => {
    expect(
      parseWorktreeList(
        "worktree /repo/main\nHEAD abc\nbranch refs/heads/main\n\nworktree /repo/topic\nHEAD def\nbranch refs/heads/feature/topic\n",
      ),
    ).toEqual([
      { path: "/repo/main", branch: "main" },
      { path: "/repo/topic", branch: "feature/topic" },
    ]);
  });

  test("enumerates linked worktrees live without registering them", async () => {
    const { root, file } = temporaryConfig();
    const repo = join(root, "repo");
    const linked = join(root, "linked");
    mkdirSync(repo);
    Bun.spawnSync(["git", "init", "-q"], { cwd: repo });
    Bun.spawnSync(["git", "config", "user.email", "t@e.st"], { cwd: repo });
    Bun.spawnSync(["git", "config", "user.name", "Test"], { cwd: repo });
    await Bun.write(join(repo, "README.md"), "hello\n");
    Bun.spawnSync(["git", "add", "."], { cwd: repo });
    Bun.spawnSync(["git", "commit", "-qm", "initial"], { cwd: repo });
    Bun.spawnSync(["git", "worktree", "add", "-qb", "topic", linked], { cwd: repo });
    const parent = registerProject(repo, { file });

    const targets = await enumerateProjects(readProjects(file));
    expect(targets.map((target) => target.kind)).toEqual(["project", "worktree"]);
    expect(targets[1]).toMatchObject({
      path: linked,
      parent: parent.name,
      branch: "topic",
      routeName: `${parent.name}:topic`,
    });
    expect(readProjects(file)).toHaveLength(1);
  });

  test("enumerates a non-directory root as missing without invoking git", async () => {
    const { root, file } = temporaryConfig();
    const projectPath = join(root, "replaced");
    mkdirSync(projectPath);
    registerProject(projectPath, { file });
    rmSync(projectPath, { recursive: true });
    writeFileSync(projectPath, "not a directory\n");

    const targets = await enumerateProjects(readProjects(file));
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ path: projectPath, missing: true, kind: "project" });
    expect(await gitSummary(projectPath)).toBeNull();
  });

  test("cached non-git root identity rejects a same-path replacement", async () => {
    const { root } = temporaryConfig();
    const projectPath = join(root, "plain");
    mkdirSync(projectPath);
    const [cached] = await enumerateProjects([
      { path: projectPath, name: "plain", lastOpened: "2026-08-05T00:00:00.000Z" },
    ]);
    expect(isCurrentProjectTarget(cached)).toBe(true);

    rmSync(projectPath, { recursive: true, force: true });
    mkdirSync(projectPath);
    expect(isCurrentProjectTarget(cached)).toBe(false);
  });
});

describe("enumeration cache", () => {
  // Each enumeration costs two git spawns per registered project (issue #28).
  function countingEnumerator(options = {}) {
    const calls = { count: 0 };
    let clock = 1000;
    const enumerate = createProjectEnumerator({
      now: () => clock,
      enumerate: async (projects) => {
        calls.count++;
        return projects.map((project) => ({ ...project, routeName: project.name }));
      },
      ...options,
    });
    return { enumerate, calls, advance: (ms) => (clock += ms) };
  }

  const entries = (...names) =>
    names.map((name) => ({ path: `/tmp/${name}`, name, lastOpened: "2026-08-05T00:00:00.000Z" }));

  test("reuses one enumeration for repeated requests inside the TTL", async () => {
    const { enumerate, calls, advance } = countingEnumerator({ ttlMs: 2000 });
    const projects = entries("alpha", "beta");

    for (let i = 0; i < 20; i++) await enumerate(projects);
    expect(calls.count).toBe(1);

    advance(1999);
    await enumerate(projects);
    expect(calls.count).toBe(1);

    advance(1);
    expect(await enumerate(projects)).toHaveLength(2);
    expect(calls.count).toBe(2);
  });

  test("a burst of concurrent requests shares one in-flight enumeration", async () => {
    const { enumerate, calls } = countingEnumerator({ ttlMs: 2000 });
    const projects = entries("alpha");
    await Promise.all(Array.from({ length: 20 }, () => enumerate(projects)));
    expect(calls.count).toBe(1);
  });

  test("a pending enumeration coalesces past the TTL and starts its TTL when it settles", async () => {
    let clock = 1000;
    let release;
    let calls = 0;
    const enumerate = createProjectEnumerator({
      ttlMs: 2000,
      now: () => clock,
      enumerate: () => {
        calls++;
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    });
    const projects = entries("alpha");
    const first = enumerate(projects);

    clock += 10_000;
    const stillPending = enumerate(projects);
    expect(calls).toBe(1);
    release(projects.map((project) => ({ ...project, routeName: project.name })));
    await Promise.all([first, stillPending]);

    clock += 1999;
    await enumerate(projects);
    expect(calls).toBe(1);
    clock += 1;
    enumerate(projects);
    expect(calls).toBe(2);
  });

  test("a changed registry is enumerated immediately, without waiting out the TTL", async () => {
    const { enumerate, calls } = countingEnumerator({ ttlMs: 60_000 });
    await enumerate(entries("alpha"));
    await enumerate(entries("alpha"));
    expect(calls.count).toBe(1);
    expect(await enumerate(entries("alpha", "beta"))).toHaveLength(2);
    expect(calls.count).toBe(2);
  });

  test("lastOpened changes do not invalidate an identity-equivalent registry", async () => {
    const { enumerate, calls } = countingEnumerator({ ttlMs: 60_000 });
    const original = entries("alpha");
    await enumerate(original);
    const refreshed = await enumerate([{ ...original[0], lastOpened: "2026-08-05T01:00:00.000Z" }]);
    expect(calls.count).toBe(1);
    expect(refreshed[0].lastOpened).toBe("2026-08-05T01:00:00.000Z");
  });

  test("metadata overlays isolate concurrent snapshots and cached discovery", async () => {
    let release;
    const enumerate = createProjectEnumerator({
      ttlMs: 60_000,
      enumerate: (projects) =>
        new Promise((resolve) => {
          release = () =>
            resolve(
              projects.map((project) => ({
                ...project,
                routeName: project.name,
                missing: false,
                kind: "project",
              })),
            );
        }),
    });
    const firstProjects = entries("alpha");
    const secondProjects = [{ ...firstProjects[0], lastOpened: "2026-08-05T01:00:00.000Z" }];
    const firstPending = enumerate(firstProjects);
    const secondPending = enumerate(secondProjects);
    release();
    const [first, second] = await Promise.all([firstPending, secondPending]);

    expect(first).not.toBe(second);
    expect(first[0]).not.toBe(second[0]);
    expect(first[0].lastOpened).toBe("2026-08-05T00:00:00.000Z");
    expect(second[0].lastOpened).toBe("2026-08-05T01:00:00.000Z");
    first[0].routeName = "poisoned-by-caller";
    expect((await enumerate(firstProjects))[0].routeName).toBe("alpha");
  });

  test("A/B/A requests retain and reuse each key's pending enumeration", async () => {
    const releases = [];
    let calls = 0;
    const enumerate = createProjectEnumerator({
      ttlMs: 60_000,
      enumerate: (projects) => {
        calls++;
        return new Promise((resolve) => releases.push(() => resolve(projects)));
      },
    });
    const pending = [
      enumerate(entries("alpha")),
      enumerate(entries("beta")),
      enumerate(entries("alpha")),
    ];

    expect(calls).toBe(2);
    for (const release of releases) release();
    await Promise.all(pending);
  });

  test("the default monotonic clock expires entries despite wall-clock rollback", async () => {
    const originalDateNow = Date.now;
    let calls = 0;
    const enumerate = createProjectEnumerator({
      ttlMs: 5,
      enumerate: async () => {
        calls++;
        return [];
      },
    });
    try {
      await enumerate([]);
      Date.now = () => 0;
      await Bun.sleep(10);
      await enumerate([]);
      expect(calls).toBe(2);
    } finally {
      Date.now = originalDateNow;
    }
  });

  test("ttl 0 disables caching, and a rejected enumeration is not retained", async () => {
    const { enumerate, calls } = countingEnumerator({ ttlMs: 0 });
    await enumerate(entries("alpha"));
    await enumerate(entries("alpha"));
    expect(calls.count).toBe(2);

    let fail = true;
    const failing = createProjectEnumerator({
      ttlMs: 60_000,
      enumerate: async () => {
        if (fail) throw new Error("git unavailable");
        return [];
      },
    });
    expect(failing(entries("alpha"))).rejects.toThrow("git unavailable");
    await Bun.sleep(0);
    fail = false;
    expect(await failing(entries("alpha"))).toEqual([]);
  });

  test("PERUSE_ENUM_TTL_MS sets the default window", async () => {
    const previous = process.env.PERUSE_ENUM_TTL_MS;
    process.env.PERUSE_ENUM_TTL_MS = "0";
    try {
      const { enumerate, calls } = countingEnumerator();
      await enumerate(entries("alpha"));
      await enumerate(entries("alpha"));
      expect(calls.count).toBe(2);
    } finally {
      if (previous === undefined) delete process.env.PERUSE_ENUM_TTL_MS;
      else process.env.PERUSE_ENUM_TTL_MS = previous;
    }
  });

  test("a worktree added after the TTL shows up in the next enumeration", async () => {
    const { root, file } = temporaryConfig();
    const repo = join(root, "repo");
    const linked = join(root, "linked");
    mkdirSync(repo);
    for (const args of [
      ["init", "-q"],
      ["config", "user.email", "t@e.st"],
      ["config", "user.name", "Test"],
    ])
      Bun.spawnSync(["git", ...args], { cwd: repo });
    await Bun.write(join(repo, "README.md"), "hello\n");
    Bun.spawnSync(["git", "add", "."], { cwd: repo });
    Bun.spawnSync(["git", "commit", "-qm", "initial"], { cwd: repo });
    registerProject(repo, { file });

    let clock = 1000;
    const enumerate = createProjectEnumerator({ ttlMs: 2000, now: () => clock });
    const projects = readProjects(file);
    expect(await enumerate(projects)).toHaveLength(1);

    Bun.spawnSync(["git", "worktree", "add", "-qb", "topic", linked], { cwd: repo });
    expect(await enumerate(projects)).toHaveLength(1);

    clock += 2000;
    const refreshed = await enumerate(projects);
    expect(refreshed.map((target) => target.kind)).toEqual(["project", "worktree"]);
    expect(refreshed[1]).toMatchObject({ path: linked, branch: "topic", kind: "worktree" });
  });

  test("cached worktree identity rejects repository reincarnation at the same paths", async () => {
    const { root, file } = temporaryConfig();
    const repo = join(root, "repo");
    const linked = join(root, "linked");
    const createRepository = (content) => {
      mkdirSync(repo);
      for (const args of [
        ["init", "-q"],
        ["config", "user.email", "t@e.st"],
        ["config", "user.name", "Test"],
      ])
        Bun.spawnSync(["git", ...args], { cwd: repo });
      writeFileSync(join(repo, "README.md"), `${content}\n`);
      Bun.spawnSync(["git", "add", "."], { cwd: repo });
      Bun.spawnSync(["git", "commit", "-qm", "initial"], { cwd: repo });
      Bun.spawnSync(["git", "worktree", "add", "-qb", "topic", linked], { cwd: repo });
    };

    createRepository("first repository");
    registerProject(repo, { file });
    const cached = (await enumerateProjects(readProjects(file))).find(
      (target) => target.kind === "worktree",
    );
    expect(cached && isCurrentWorktreeTarget(cached)).toBe(true);

    rmSync(linked, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
    createRepository("unrelated second repository");
    expect(cached && isCurrentWorktreeTarget(cached)).toBe(false);
  });
});
