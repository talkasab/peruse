import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";

export const MISSING_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * @typedef {object} ProjectEntry
 * @property {string} path
 * @property {string} name
 * @property {string} lastOpened
 * @property {string} [missingSince]
 */

/**
 * @typedef {object} ProjectTarget
 * @property {string} path
 * @property {string} name
 * @property {string} routeName
 * @property {string} lastOpened
 * @property {boolean} missing
 * @property {"project" | "worktree"} kind
 * @property {string} [parent]
 * @property {string} [branch]
 */

/** @param {string} [configDir] */
export function registryPath(configDir = process.env.PERUSE_CONFIG_DIR) {
  return join(configDir ?? join(homedir(), ".config", "peruse"), "projects.json");
}

/** @param {string} path */
function canonical(path) {
  const absolute = resolve(path);
  return existsSync(absolute) ? realpathSync(absolute) : absolute;
}

/** @param {string} path */
function isDirectory(path) {
  return statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false;
}

/** @param {unknown} value @returns {value is ProjectEntry} */
function isEntry(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    "path" in value &&
    typeof value.path === "string" &&
    "name" in value &&
    typeof value.name === "string" &&
    "lastOpened" in value &&
    typeof value.lastOpened === "string"
  );
}

/** @param {string} file @returns {ProjectEntry[]} */
export function readProjects(file = registryPath()) {
  if (!existsSync(file)) return [];
  try {
    const value = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(value) ? value.filter(isEntry) : [];
  } catch {
    return [];
  }
}

/** @param {string} file @param {ProjectEntry[]} projects */
export function writeProjects(file, projects) {
  mkdirSync(resolve(file, ".."), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(projects, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, file);
}

/** @param {string} desired @param {ProjectEntry[]} projects */
function uniqueName(desired, projects) {
  const used = new Set(projects.map((project) => project.name));
  if (!used.has(desired)) return desired;
  for (let suffix = 2; ; suffix++) {
    const candidate = `${desired}-${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}

/**
 * @param {string} path
 * @param {{file?: string, name?: string, now?: Date}} [options]
 * @returns {ProjectEntry}
 */
export function registerProject(path, { file = registryPath(), name, now = new Date() } = {}) {
  const absolute = canonical(path);
  const projects = readProjects(file);
  const found = projects.find((project) => canonical(project.path) === absolute);
  if (found) {
    found.path = absolute;
    found.lastOpened = now.toISOString();
    delete found.missingSince;
    writeProjects(file, projects);
    return found;
  }
  const entry = {
    path: absolute,
    name: uniqueName(name ?? (basename(absolute) || "project"), projects),
    lastOpened: now.toISOString(),
  };
  projects.push(entry);
  writeProjects(file, projects);
  return entry;
}

/** @param {string} selector @param {string} [file] */
export function removeProject(selector, file = registryPath()) {
  const projects = readProjects(file);
  const nameMatched = projects.some((project) => project.name === selector);
  const absolute = nameMatched ? null : canonical(selector);
  const kept = nameMatched
    ? projects.filter((project) => project.name !== selector)
    : projects.filter((project) => canonical(project.path) !== absolute);
  if (kept.length !== projects.length) writeProjects(file, kept);
  return projects.length - kept.length;
}

/**
 * Record first misses without deleting them. Entries that reappear lose the
 * internal timestamp.
 * @param {string} [file]
 * @param {Date} [now]
 */
export function observeMissingProjects(file = registryPath(), now = new Date()) {
  const projects = readProjects(file);
  let changed = false;
  for (const project of projects) {
    if (existsSync(project.path)) {
      if (project.missingSince) {
        delete project.missingSince;
        changed = true;
      }
    } else if (!project.missingSince) {
      project.missingSince = now.toISOString();
      changed = true;
    }
  }
  if (changed) writeProjects(file, projects);
  return projects;
}

/**
 * @param {{file?: string, now?: Date, immediate?: boolean}} [options]
 * @returns {{removed: ProjectEntry[], kept: ProjectEntry[]}}
 */
export function pruneProjects({ file = registryPath(), now = new Date(), immediate = false } = {}) {
  const projects = observeMissingProjects(file, now);
  const removed = projects.filter((project) => {
    if (existsSync(project.path)) return false;
    if (immediate) return true;
    const since = Date.parse(project.missingSince ?? now.toISOString());
    return now.getTime() - since >= MISSING_GRACE_MS;
  });
  const removedNames = new Set(removed.map((project) => project.name));
  const kept = projects.filter((project) => !removedNames.has(project.name));
  if (removed.length) writeProjects(file, kept);
  return { removed, kept };
}

// --no-optional-locks: see the equivalent note in server/index.js — peruse's
// own status polling must never write .git/index.
/** @param {string} cwd @param {...string} args */
async function git(cwd, ...args) {
  const proc = Bun.spawn(["git", "--no-optional-locks", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "ignore",
    timeout: 30_000,
  });
  const out = await proc.stdout.text();
  return { code: await proc.exited, out };
}

/** @param {string} text @returns {Array<{path: string, branch?: string}>} */
export function parseWorktreeList(text) {
  /** @type {Array<{path: string, branch?: string}>} */
  const worktrees = [];
  /** @type {{path: string, branch?: string} | null} */
  let current = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("worktree ")) {
      current = { path: line.slice(9) };
      worktrees.push(current);
    } else if (current && line.startsWith("branch ")) {
      current.branch = line.slice(7).replace(/^refs\/heads\//, "");
    }
  }
  return worktrees;
}

/** @typedef {{dev: bigint, ino: bigint, birthtimeNs: bigint}} FileIdentity */

/**
 * @typedef {object} TargetIdentity
 * @property {Array<{path: string, identity: FileIdentity}>} locations
 * @property {{root: string, gitdir: string, head: string}} [git]
 */

/** @type {WeakMap<object, TargetIdentity>} */
const targetIdentities = new WeakMap();

/** @param {string} path @returns {FileIdentity | null} */
function fileIdentity(path) {
  const stats = statSync(path, { bigint: true, throwIfNoEntry: false });
  if (!stats) return null;
  return { dev: stats.dev, ino: stats.ino, birthtimeNs: stats.birthtimeNs };
}

/** @param {FileIdentity} expected @param {FileIdentity | null} current */
function sameFileIdentity(expected, current) {
  return (
    current !== null &&
    expected.dev === current.dev &&
    expected.ino === current.ino &&
    expected.birthtimeNs === current.birthtimeNs
  );
}

/** @param {string} worktreeRoot */
function readWorktreeIdentity(worktreeRoot) {
  const dotGit = join(worktreeRoot, ".git");
  try {
    const dotGitStats = statSync(dotGit, { throwIfNoEntry: false });
    let gitdir;
    if (dotGitStats?.isDirectory()) gitdir = canonical(dotGit);
    else if (dotGitStats?.isFile()) {
      const match = readFileSync(dotGit, "utf8").match(/^gitdir:\s*(.+)\s*$/m);
      if (!match) return null;
      gitdir = canonical(resolve(worktreeRoot, match[1]));
    } else return null;
    if (!isDirectory(gitdir)) return null;
    const head = readFileSync(join(gitdir, "HEAD"), "utf8").trim();
    return { gitdir, head };
  } catch {
    return null;
  }
}

/** @param {ProjectTarget} source @param {ProjectTarget} copy */
function copyTargetIdentity(source, copy) {
  const identity = targetIdentities.get(source);
  if (identity) targetIdentities.set(copy, identity);
}

/**
 * Capture filesystem object identities separately from public target data.
 * @param {ProjectTarget} target
 * @param {string[]} paths
 * @param {{root: string, gitdir: string, head: string}} [gitIdentity]
 */
function rememberTargetIdentity(target, paths, gitIdentity) {
  const locations = paths.flatMap((path) => {
    const identity = fileIdentity(path);
    return identity ? [{ path, identity }] : [];
  });
  targetIdentities.set(target, {
    locations,
    ...(gitIdentity ? { git: gitIdentity } : {}),
  });
}

/**
 * A cached target remains valid only while its working directory and Git
 * administrative directory are the same filesystem objects. Linked worktrees
 * must also retain their `.git` linkage and, for a named branch, branch ref.
 * Identity lives in a WeakMap so it never leaks into API JSON.
 * @param {ProjectTarget} target
 */
export function isCurrentProjectTarget(target) {
  const expected = targetIdentities.get(target);
  if (!expected) return false;
  if (
    expected.locations.some(({ path, identity }) => !sameFileIdentity(identity, fileIdentity(path)))
  )
    return false;
  if (!expected.git) return true;
  const current = readWorktreeIdentity(expected.git.root);
  if (!current || current.gitdir !== expected.git.gitdir) return false;
  if (target.kind !== "worktree" || !target.branch) return true;
  return current.head === `ref: refs/heads/${target.branch}`;
}

// Compatibility for callers written against the first identity-hardening pass.
export const isCurrentWorktreeTarget = isCurrentProjectTarget;

/** @param {ProjectEntry[]} projects @returns {Promise<ProjectTarget[]>} */
export async function enumerateProjects(projects) {
  /** @type {ProjectTarget[]} */
  const targets = [];
  const routeNames = new Set(projects.map((project) => project.name));
  for (const project of projects) {
    const missing = !isDirectory(project.path);
    /** @type {ProjectTarget} */
    const projectTarget = { ...project, routeName: project.name, missing, kind: "project" };
    if (!missing) rememberTargetIdentity(projectTarget, [project.path]);
    targets.push(projectTarget);
    if (missing) continue;
    const topLevel = await git(project.path, "rev-parse", "--show-toplevel");
    if (topLevel.code !== 0) continue;
    const repoRoot = canonical(topLevel.out.trim());
    const projectGitIdentity = readWorktreeIdentity(repoRoot);
    if (projectGitIdentity)
      rememberTargetIdentity(projectTarget, [project.path, projectGitIdentity.gitdir], {
        root: repoRoot,
        ...projectGitIdentity,
      });
    const registeredSubpath = relative(repoRoot, canonical(project.path));
    const result = await git(project.path, "worktree", "list", "--porcelain");
    if (result.code !== 0) continue;
    for (const worktree of parseWorktreeList(result.out)) {
      const targetPath = join(worktree.path, registeredSubpath);
      if (canonical(targetPath) === canonical(project.path)) continue;
      const identity = readWorktreeIdentity(worktree.path);
      const leaf = worktree.branch?.split("/").pop() || basename(worktree.path) || "worktree";
      const base = `${project.name}:${leaf}`;
      let routeName = base;
      for (let suffix = 2; routeNames.has(routeName); suffix++) routeName = `${base}-${suffix}`;
      routeNames.add(routeName);
      /** @type {ProjectTarget} */
      const target = {
        path: targetPath,
        name: leaf,
        routeName,
        lastOpened: project.lastOpened,
        missing: !isDirectory(targetPath) || !identity,
        kind: "worktree",
        parent: project.name,
        branch: worktree.branch,
      };
      if (identity)
        rememberTargetIdentity(target, [targetPath, worktree.path, identity.gitdir], {
          root: worktree.path,
          ...identity,
        });
      targets.push(target);
    }
  }
  return targets;
}

/** How long one enumeration is reused before git is asked again. */
export const ENUMERATION_TTL_MS = 2000;

/** @param {number | undefined} option */
function enumerationTtl(option) {
  if (option !== undefined)
    return Number.isFinite(option) && option >= 0 ? option : ENUMERATION_TTL_MS;
  const raw = process.env.PERUSE_ENUM_TTL_MS;
  if (raw === undefined) return ENUMERATION_TTL_MS;
  if (!/^(0|[1-9]\d*)$/.test(raw)) return ENUMERATION_TTL_MS;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : ENUMERATION_TTL_MS;
}

/** @param {ProjectEntry[]} projects */
function enumerationKey(projects) {
  return JSON.stringify(
    projects
      .map((project) => ({ name: project.name, path: canonical(project.path) }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path)),
  );
}

/**
 * Overlay live registry/filesystem metadata on isolated copies so callers
 * cannot mutate cached discovery or each other's snapshots.
 * @param {Promise<readonly ProjectTarget[]>} targets
 * @param {ProjectEntry[]} projects
 */
function withCurrentRegistryMetadata(targets, projects) {
  const byName = new Map(projects.map((project) => [project.name, project]));
  return targets.then((resolved) => {
    return resolved.map((target) => {
      const project = byName.get(
        target.kind === "worktree" ? (target.parent ?? target.name) : target.name,
      );
      const identity = targetIdentities.get(target);
      const missing =
        !isDirectory(target.path) || (identity ? !isCurrentProjectTarget(target) : target.missing);
      /** @type {ProjectTarget} */
      const copy = {
        ...target,
        ...(project ? { lastOpened: project.lastOpened } : {}),
        missing,
      };
      copyTargetIdentity(target, copy);
      return copy;
    });
  });
}

/** @param {ProjectTarget[]} targets @returns {readonly Readonly<ProjectTarget>[]} */
function immutableTargets(targets) {
  return Object.freeze(
    targets.map((target) => {
      /** @type {ProjectTarget} */
      const copy = { ...target };
      copyTargetIdentity(target, copy);
      return Object.freeze(copy);
    }),
  );
}

/**
 * Memoize {@link enumerateProjects} for a short window.
 *
 * Enumeration costs two sequential git spawns per registered project, and a
 * single page load issues one request per asset — without this, a markdown
 * page with 20 images over 10 projects spawns ~400 git processes.
 *
 * Project name/path identity is the cache key, so add/rm/prune and identity
 * edits invalidate immediately while `lastOpened` updates do not. A pending
 * promise is reused regardless of elapsed time; the TTL begins when it settles.
 *
 * @param {{ttlMs?: number, enumerate?: typeof enumerateProjects, now?: () => number}} [options]
 */
export function createProjectEnumerator({
  ttlMs,
  enumerate = enumerateProjects,
  now = () => performance.now(),
} = {}) {
  // An explicit option (used by tests) beats PERUSE_ENUM_TTL_MS, which beats the
  // default; 0 disables settled-result reuse while pending work still coalesces.
  const ttl = enumerationTtl(ttlMs);
  /** @type {{key: string, settledAt: number, targets: Promise<readonly ProjectTarget[]>} | null} */
  let settled = null;
  /** @type {Map<string, Promise<readonly ProjectTarget[]>>} */
  const pending = new Map();

  /** @param {ProjectEntry[]} projects @returns {Promise<ProjectTarget[]>} */
  return (projects) => {
    const key = enumerationKey(projects);
    const inFlight = pending.get(key);
    if (inFlight) return withCurrentRegistryMetadata(inFlight, projects);
    if (settled?.key === key && now() - settled.settledAt < ttl)
      return withCurrentRegistryMetadata(settled.targets, projects);
    let targets;
    try {
      targets = Promise.resolve(enumerate(projects)).then(immutableTargets);
    } catch (error) {
      targets = Promise.reject(error);
    }
    pending.set(key, targets);
    targets.then(
      () => {
        if (pending.get(key) === targets) pending.delete(key);
        settled = { key, settledAt: now(), targets };
      },
      () => {
        if (pending.get(key) === targets) pending.delete(key);
      },
    );
    return withCurrentRegistryMetadata(targets, projects);
  };
}

/** @param {string} path */
export async function gitSummary(path) {
  if (!isDirectory(path)) return null;
  const branch = await git(path, "branch", "--show-current");
  if (branch.code !== 0) return null;
  const status = await git(path, "status", "--porcelain");
  const changes = status.code === 0 ? status.out.split("\n").filter(Boolean).length : 0;
  return { branch: branch.out.trim() || "detached", changes };
}
