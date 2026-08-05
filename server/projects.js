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

/** @param {ProjectEntry[]} projects @returns {Promise<ProjectTarget[]>} */
export async function enumerateProjects(projects) {
  /** @type {ProjectTarget[]} */
  const targets = [];
  const routeNames = new Set(projects.map((project) => project.name));
  for (const project of projects) {
    const missing = !isDirectory(project.path);
    targets.push({ ...project, routeName: project.name, missing, kind: "project" });
    if (missing) continue;
    const topLevel = await git(project.path, "rev-parse", "--show-toplevel");
    if (topLevel.code !== 0) continue;
    const repoRoot = canonical(topLevel.out.trim());
    const registeredSubpath = relative(repoRoot, canonical(project.path));
    const result = await git(project.path, "worktree", "list", "--porcelain");
    if (result.code !== 0) continue;
    for (const worktree of parseWorktreeList(result.out)) {
      const targetPath = join(worktree.path, registeredSubpath);
      if (canonical(targetPath) === canonical(project.path)) continue;
      const leaf = worktree.branch?.split("/").pop() || basename(worktree.path) || "worktree";
      const base = `${project.name}:${leaf}`;
      let routeName = base;
      for (let suffix = 2; routeNames.has(routeName); suffix++) routeName = `${base}-${suffix}`;
      routeNames.add(routeName);
      targets.push({
        path: targetPath,
        name: leaf,
        routeName,
        lastOpened: project.lastOpened,
        missing: !isDirectory(targetPath),
        kind: "worktree",
        parent: project.name,
        branch: worktree.branch,
      });
    }
  }
  return targets;
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
