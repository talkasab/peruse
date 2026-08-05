import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  enumerateProjects,
  gitSummary,
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
});
