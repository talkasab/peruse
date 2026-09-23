// peruse server: static page + file/git/events API. All rendering is client-side.

import { existsSync, watch as fsWatch, lstatSync, readdirSync, statSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createProjectEnumerator,
  gitSummary,
  isCurrentProjectTarget,
  observeMissingProjects,
  pruneProjects,
  readProjects,
  registerProject,
} from "./projects.js";

/**
 * @typedef {object} Hunk
 * @property {number} oldStart
 * @property {number} oldLines
 * @property {number} newStart
 * @property {number} newLines
 * @property {"added" | "modified" | "deleted"} kind
 * @property {string} patch
 */

/**
 * @typedef {object} TreeNode
 * @property {string} name
 * @property {string} path
 * @property {boolean} [dir]
 * @property {boolean} [ignored]
 * @property {TreeNode[]} [children]
 * @property {boolean} [dirty]
 * @property {string | null} [status]
 * @property {boolean} [truncated]
 */

/**
 * @typedef {object} GitState
 * @property {boolean} isRepo
 * @property {string} prefix
 * @property {string} base
 * @property {Map<string, string>} status
 * @property {Set<string>} ignored
 * @property {BranchState | null} branchState
 */

/**
 * @typedef {object} BranchState
 * @property {string} head
 * @property {string | null} base
 * @property {number} ahead
 * @property {number} behind
 * @property {boolean} detached
 */

/**
 * @typedef {object} StartOptions
 * @property {string} [root]
 * @property {string} [configFile]
 * @property {import("./projects.js").ProjectEntry[]} [projects]
 * @property {number} port
 * @property {string} host
 * @property {boolean} [portFixed]
 * @property {typeof fsWatch} [watchFactory]
 * @property {number} [enumerationTtlMs]
 */

/** Resolve peruse's package root from the server module in checkouts and npm installs. */
export function packageRootFrom(serverModuleUrl = import.meta.url) {
  return resolve(dirname(fileURLToPath(serverModuleUrl)), "..");
}

const PKG = packageRootFrom();
const DIST = join(PKG, "dist");
const SERVER_HOSTNAME = hostname();
const PROJECT_NOT_FOUND_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>peruse - ${escapeHTML(SERVER_HOSTNAME)}</title></head>
<body>project not found</body></html>`;

/** @param {string} value */
function escapeHTML(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Newest regular source-file mtime below a directory, recursively. @param {string} dir */
export function newestFileMtime(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) newest = Math.max(newest, newestFileMtime(path));
    else if (entry.isFile()) newest = Math.max(newest, statSync(path).mtimeMs);
  }
  return newest;
}

// Running from a checkout, a git pull must never silently serve a stale
// client: rebuild dist/ whenever any web/ source, including a nested grammar,
// is newer. No-op for the npm package and compiled binaries (no web/ shipped).
function ensureFreshClient() {
  const webDir = join(PKG, "web");
  if (!existsSync(webDir)) return;
  const newest = newestFileMtime(webDir);
  const distApp = join(DIST, "app.js");
  if (!existsSync(distApp) || statSync(distApp).mtimeMs < newest) {
    console.error("peruse: client sources newer than dist/ — rebuilding…");
    const r = Bun.spawnSync(["bun", "run", "build"], {
      cwd: PKG,
      stdout: "inherit",
      stderr: "inherit",
    });
    if (r.exitCode !== 0) console.error("peruse: build failed — serving the stale client");
  }
}
// Well-known git empty tree — diff base for repos with no commits yet.
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

// stderr is IGNORED, never piped-and-unread: a chatty git (permission
// warnings, advisories) filling an unread 64 KB pipe blocks forever and
// hangs the request. The timeout bounds any other pathology (dead mounts,
// index locks); a killed git degrades to "no status" instead of a hang.
// --no-optional-locks: status must not refresh .git/index — peruse is
// read-only, and its own index writes echo back through the watcher as
// git-change events, re-rendering clients that only asked for status.
/** @param {string} root @param {...string} args */
async function git(root, ...args) {
  const t0 = Date.now();
  const proc = Bun.spawn(["git", "--no-optional-locks", ...args], {
    cwd: root,
    stdout: "pipe",
    stderr: "ignore",
    timeout: 30_000,
  });
  const out = await proc.stdout.text();
  const code = await proc.exited;
  const ms = Date.now() - t0;
  if (ms > 2000)
    console.error(
      `peruse: slow git ${args.join(" ").slice(0, 60)} — ${ms} ms` +
        (code === 143 ? " (killed by 30 s timeout)" : ""),
    );
  return { code, out };
}

/** Resolve once at startup; never inspect a served project for peruse's version. */
export async function resolveRunningVersion(packageRoot = PKG) {
  const pkg = /** @type {{version: string}} */ (
    await Bun.file(join(packageRoot, "package.json")).json()
  );
  const release = `v${pkg.version}`;
  if (!existsSync(join(packageRoot, ".git"))) return release;
  try {
    const head = await git(packageRoot, "log", "-1", "--format=%ct");
    const headSeconds = Number(head.out.trim());
    if (head.code !== 0 || !Number.isFinite(headSeconds)) return `${release} (dev)`;
    const status = await git(
      packageRoot,
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
    );
    if (status.code !== 0) return `${release} (dev)`;
    let newestSeconds = headSeconds;
    let dirty = false;
    const entries = status.out.split("\0");
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry) continue;
      dirty = true;
      const state = entry.slice(0, 2);
      const path = entry.slice(3);
      const file = lstatSync(join(packageRoot, path), { throwIfNoEntry: false });
      if (file) newestSeconds = Math.max(newestSeconds, Math.floor(file.mtimeMs / 1000));
      if (state.includes("R") || state.includes("C")) i++;
    }
    const stamp = new Date(newestSeconds * 1000)
      .toISOString()
      .replaceAll(/[-:T]/g, "")
      .slice(0, 14);
    return `${release}-dev.${stamp}${dirty ? "-dirty" : ""}`;
  } catch {}
  return `${release} (dev)`;
}

/** @param {string} root @returns {Promise<{isRepo: boolean, prefix: string}>} */
async function gitInfo(root) {
  const { code, out } = await git(root, "rev-parse", "--show-prefix");
  if (code !== 0) return { isRepo: false, prefix: "" };
  return { isRepo: true, prefix: out.trim() };
}

/**
 * Status letter per path (M/A/D/R/U) + set of gitignored paths (dirs end with /).
 * @param {string} root
 * @returns {Promise<GitState>}
 */
export async function gitStatus(root) {
  const info = await gitInfo(root);
  const status = new Map();
  const ignored = new Set();
  if (!info.isRepo) return { ...info, base: EMPTY_TREE, status, ignored, branchState: null };

  const st = await git(
    root,
    "status",
    "--porcelain=v2",
    "--branch",
    "--no-ahead-behind",
    "-z",
    "--untracked-files=all",
  );
  let branchHead = "";
  let branchOid = "";
  const parts = st.out.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (!entry) continue;
    if (entry.startsWith("# branch.oid ")) {
      branchOid = entry.slice("# branch.oid ".length);
      continue;
    }
    if (entry.startsWith("# branch.head ")) {
      branchHead = entry.slice("# branch.head ".length);
      continue;
    }
    const type = entry[0];
    let letter, repoPath;
    if (type === "?") {
      letter = "U";
      repoPath = entry.slice(2);
    } else if (type === "1" || type === "u") {
      const f = entry.split(" ");
      const [x, y] = f[1];
      letter = y !== "." ? y : x;
      repoPath = f.slice(8).join(" ");
    } else if (type === "2") {
      letter = "R";
      repoPath = entry.split(" ").slice(9).join(" ");
      i++; // -z rename entries carry origPath in the next NUL field
    } else continue;
    if (repoPath.startsWith(info.prefix)) status.set(repoPath.slice(info.prefix.length), letter);
  }

  // Collapsed listing (dirs get a trailing /) so the tree never walks node_modules etc.
  // Base discovery shares the status cadence; it is not a separate client request.
  const ignoredPaths = git(root, "ls-files", "-z", "-o", "-i", "--exclude-standard", "--directory");
  const localBaseRefs =
    branchHead && branchHead !== "(detached)"
      ? git(
          root,
          "for-each-ref",
          "--format=%(refname:short)",
          "refs/heads/dev",
          "refs/heads/main",
          "refs/heads/master",
        )
      : Promise.resolve({ code: 0, out: "" });
  const [ig, refs] = await Promise.all([ignoredPaths, localBaseRefs]);
  for (const p of ig.out.split("\0")) if (p) ignored.add(p);
  const base = branchOid && branchOid !== "(initial)" ? "HEAD" : EMPTY_TREE;
  /** @type {BranchState | null} */
  let branchState = null;
  if (branchHead === "(detached)" && base === "HEAD") {
    branchState = {
      head: branchOid.slice(0, 7),
      base: null,
      ahead: 0,
      behind: 0,
      detached: true,
    };
  } else if (branchHead) {
    const localBases = new Set(refs.out.split("\n").filter(Boolean));
    const baseBranch = ["dev", "main", "master"].find((name) => localBases.has(name)) ?? null;
    let ahead = 0;
    let behind = 0;
    if (base === "HEAD" && baseBranch && branchHead !== baseBranch) {
      const counts = await git(root, "rev-list", "--left-right", "--count", `${baseBranch}...HEAD`);
      if (counts.code === 0) {
        const [left, right] = counts.out.trim().split(/\s+/).map(Number);
        behind = Number.isFinite(left) ? left : 0;
        ahead = Number.isFinite(right) ? right : 0;
      }
    }
    branchState = { head: branchHead, base: baseBranch, ahead, behind, detached: false };
  }
  return { ...info, base, status, ignored, branchState };
}

const MAX_DIR_ENTRIES = 500;

/** @param {string} root @param {GitState} gs @param {string} [dir] @returns {TreeNode[]} */
export function buildTree(root, gs, dir = "") {
  /** @type {TreeNode[]} */
  const nodes = [];
  let entries;
  try {
    entries = readdirSync(join(root, dir), { withFileTypes: true });
  } catch {
    return nodes;
  }
  entries.sort(
    (a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name),
  );
  for (const e of entries) {
    if (e.name === ".git") continue;
    // Junk dirs that aren't gitignored (caches, browser profiles) can hold
    // tens of thousands of entries — cap per directory so the tree JSON and
    // the DOM stay sane.
    if (nodes.length >= MAX_DIR_ENTRIES) {
      nodes.push({
        name: `… ${entries.length - nodes.length} more entries not shown`,
        path: `${dir}/…`,
        truncated: true,
      });
      break;
    }
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) {
      const isIgnored = gs.ignored.has(`${rel}/`);
      // Ignored dirs are shown (dimmed) but not walked — keeps the tree small.
      const children = isIgnored ? [] : buildTree(root, gs, rel);
      // VS Code-style folder decoration: flag dirs containing any change.
      nodes.push({
        name: e.name,
        path: rel,
        dir: true,
        ignored: isIgnored,
        children,
        dirty: children.some((c) => (c.dir ? c.dirty : !!c.status)),
      });
    } else if (e.isFile()) {
      nodes.push({
        name: e.name,
        path: rel,
        dir: false,
        status: gs.status.get(rel) ?? null,
        ignored: gs.ignored.has(rel),
      });
    }
  }
  return nodes;
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** @param {string} diffText @returns {Hunk[]} */
export function parseHunks(diffText) {
  /** @type {Hunk[]} */
  const hunks = [];
  for (const line of diffText.split("\n")) {
    const m = line.match(HUNK_RE);
    if (m) {
      const [, oldStart, oldLines = "1", newStart, newLines = "1"] = m;
      hunks.push({
        oldStart: +oldStart,
        oldLines: +oldLines,
        newStart: +newStart,
        newLines: +newLines,
        kind: +newLines === 0 ? "deleted" : +oldLines === 0 ? "added" : "modified",
        patch: line,
      });
    } else if (hunks.length && /^[-+ \\]/.test(line)) {
      hunks[hunks.length - 1].patch += `\n${line}`;
    }
  }
  return hunks;
}

// Zero-context diff: each hunk is one contiguous change, so gutter marks sit
// exactly on the changed lines and nearby edits never merge into one hunk
// (git -U3 would). The popup patch then gets up to 3 context lines re-added
// around each change from the worktree content, below.
/**
 * @param {string} root
 * @param {string} rel
 * @param {string | null} status
 * @param {string} base
 * @param {string} content
 * @returns {Promise<Hunk[]>}
 */
async function fileHunks(root, rel, status, base, content) {
  if (!status || status === "D") return [];
  const { out } =
    status === "U"
      ? await git(root, "diff", "--no-index", "--no-color", "-U0", "--", "/dev/null", rel)
      : await git(root, "diff", base, "--no-color", "-U0", "--", rel);
  const lines = content.replace(/\n$/, "").split("\n");
  return parseHunks(out).map((h) => withContext(h, lines, 3));
}

// Context lines are identical on both diff sides, so they can come straight
// from the current file; only the hunk header math differs per side (a side
// with count 0 uses the line-after-which convention, hence the +1).
/** @param {Hunk} h @param {string[]} lines @param {number} ctx @returns {Hunk} */
export function withContext(h, lines, ctx) {
  const start = h.newLines === 0 ? h.newStart + 1 : h.newStart;
  const before = Math.min(ctx, start - 1);
  const endNew = h.newLines === 0 ? h.newStart : h.newStart + h.newLines - 1;
  const after = Math.min(ctx, Math.max(0, lines.length - endNew));
  const above = lines.slice(start - 1 - before, start - 1).map((l) => ` ${l}`);
  const below = lines.slice(endNew, endNew + after).map((l) => ` ${l}`);
  const oldStart = h.oldStart - before + (h.oldLines === 0 ? 1 : 0);
  const newStart = h.newStart - before + (h.newLines === 0 ? 1 : 0);
  const header = `@@ -${oldStart},${h.oldLines + before + after} +${newStart},${h.newLines + before + after} @@`;
  const body = h.patch.split("\n").slice(1);
  return { ...h, patch: [header, ...above, ...body, ...below].join("\n") };
}

/**
 * Resolve a request path safely under root; returns null on traversal or .git.
 * @param {string} root
 * @param {string} rel
 * @returns {{abs: string, rel: string} | null}
 */
export function safePath(root, rel) {
  rel = rel.replace(/^\/+/, "");
  const abs = resolve(root, rel);
  if (abs !== root && !abs.startsWith(`${root}/`)) return null;
  const inside = relative(root, abs);
  if (inside === ".git" || inside.startsWith(".git/")) return null;
  return { abs, rel: inside };
}

/**
 * @param {string} root
 * @param {import("./projects.js").ProjectTarget} target
 * @param {typeof fsWatch} [watchFactory]
 */
export async function createProjectRuntime(root, target, watchFactory = fsWatch) {
  /** @type {Set<ReadableStreamDefaultController<string>>} */
  const clients = new Set();
  let closed = false;
  /** @type {Promise<void> | null} */
  let closePromise = null;
  /** @type {Set<string>} */
  let pendingChanged = new Set(),
    pendingGit = false,
    /** @type {ReturnType<typeof setTimeout> | null} */
    flushTimer = null;

  // gitStatus refreshes the event filter when the tree is requested.
  /** @type {Set<string>} */
  let ignoredDirs = new Set();
  /** @param {GitState} gs */
  const rememberIgnored = (gs) => {
    ignoredDirs = new Set(
      [...gs.ignored].filter((p) => p.endsWith("/")).map((p) => p.slice(0, -1)),
    );
    return gs;
  };
  /** @param {string} rel */
  const inIgnoredDir = (rel) => {
    const parts = rel.split("/");
    for (let i = 1; i <= parts.length; i++)
      if (ignoredDirs.has(parts.slice(0, i).join("/"))) return true;
    return false;
  };
  rememberIgnored(await gitStatus(root));

  function broadcast() {
    flushTimer = null;
    const payload = `data: ${JSON.stringify({ changed: [...pendingChanged], git: pendingGit })}\n\n`;
    pendingChanged = new Set();
    pendingGit = false;
    for (const c of clients) {
      try {
        c.enqueue(payload);
      } catch {
        clients.delete(c);
      }
    }
  }

  // Bun's recursive watcher skips symlink targets. Its ignore predicate filters
  // events, but does not prevent watches from being installed in skipped dirs.
  /** @param {string} rel */
  const skipRel = (rel) =>
    rel.split("/").includes("node_modules") ||
    rel === ".git/objects" ||
    rel.startsWith(".git/objects/") ||
    inIgnoredDir(rel);

  /** @param {string | null | undefined} filename */
  function noteChange(filename) {
    if (closed) return;
    const rel = filename == null ? "" : String(filename);
    if (rel && skipRel(rel)) return;
    if (rel === ".git" || rel.startsWith(".git/")) pendingGit = true;
    else pendingChanged.add(rel); // Empty path invalidates the whole tree.
    if (!flushTimer) flushTimer = setTimeout(broadcast, 200);
  }

  let watchErrors = 0;
  /** @param {unknown} err */
  const reportWatchError = (err) => {
    const code = /** @type {NodeJS.ErrnoException} */ (err)?.code;
    const detail = err instanceof Error ? err.message : String(err);
    const message =
      code === "ENOSPC" && process.platform === "linux"
        ? `peruse: watcher: ${detail}; raise fs.inotify.max_user_watches for large trees`
        : `peruse: watcher: ${detail}`;
    if (++watchErrors <= 3) console.error(message);
    else if (watchErrors === 4) console.error("peruse: further watcher errors suppressed");
  };
  /** @type {import("node:fs").FSWatcher | null} */
  let watcher = null;
  try {
    watcher = watchFactory(
      root,
      {
        recursive: true,
        ignore: (path) => {
          // Bun passes root-relative paths; accept absolute paths as well.
          const rel = isAbsolute(path) ? relative(root, path) : path;
          return !!rel && skipRel(rel);
        },
      },
      (_event, filename) => noteChange(filename),
    );
    watcher.on("error", reportWatchError);
  } catch (err) {
    reportWatchError(err);
  }
  // fs.watch installs recursive watches before returning.
  const ready = Promise.resolve();
  const pingTimer = setInterval(() => {
    for (const c of clients) {
      try {
        c.enqueue(": ping\n\n");
      } catch {
        clients.delete(c);
      }
    }
  }, 30_000);
  pingTimer.unref?.();

  return {
    root,
    target,
    rememberIgnored,
    ready,
    get closed() {
      return closed;
    },
    /** @param {ReadableStreamDefaultController<string>} client */
    addClient(client) {
      if (closed) {
        client.close();
        return false;
      }
      clients.add(client);
      return true;
    },
    /** @param {ReadableStreamDefaultController<string>} client */
    removeClient(client) {
      clients.delete(client);
    },
    close() {
      if (!closePromise)
        closePromise = (async () => {
          closed = true;
          clearInterval(pingTimer);
          if (flushTimer) clearTimeout(flushTimer);
          for (const client of clients) {
            try {
              client.close();
            } catch {}
          }
          clients.clear();
          await watcher?.close();
        })();
      return closePromise;
    },
  };
}

/** @param {StartOptions} options */
export async function startServer({
  root,
  configFile,
  projects: fixedProjects,
  port,
  host,
  portFixed = false,
  watchFactory = fsWatch,
  enumerationTtlMs,
}) {
  ensureFreshClient();
  const runningVersion = await resolveRunningVersion();
  const initialProjects =
    fixedProjects ??
    (root
      ? [
          {
            path: root,
            name: "project",
            lastOpened: new Date().toISOString(),
          },
        ]
      : null);
  const registry = () => initialProjects ?? readProjects(configFile);
  const enumerate = createProjectEnumerator({ ttlMs: enumerationTtlMs });
  /** @type {Map<string, Awaited<ReturnType<typeof createProjectRuntime>>>} */
  const runtimes = new Map();
  /** @type {Map<string, Promise<Awaited<ReturnType<typeof createProjectRuntime>>>>} */
  const runtimeStarts = new Map();
  /** @type {Set<Promise<void>>} */
  const runtimeCloses = new Set();
  let stopped = false;

  /** @param {import("./projects.js").ProjectTarget | undefined} target */
  const targetIsCurrent = (target) =>
    !!target &&
    !target.missing &&
    !!statSync(target.path, { throwIfNoEntry: false })?.isDirectory() &&
    isCurrentProjectTarget(target);

  /**
   * @param {Awaited<ReturnType<typeof createProjectRuntime>>} runtime
   * @param {import("./projects.js").ProjectTarget | undefined} target
   */
  const runtimeMatchesTarget = (runtime, target) =>
    !!target && runtime.root === target.path && isCurrentProjectTarget(runtime.target);

  /**
   * @param {string} routeName
   * @param {Awaited<ReturnType<typeof createProjectRuntime>>} runtime
   */
  function closeRuntime(routeName, runtime) {
    if (runtimes.get(routeName) === runtime) runtimes.delete(routeName);
    const closing = runtime.close();
    runtimeCloses.add(closing);
    void closing.then(
      () => runtimeCloses.delete(closing),
      () => runtimeCloses.delete(closing),
    );
    return closing;
  }

  /** @param {import("./projects.js").ProjectEntry[]} projects */
  const registryIdentity = (projects) =>
    JSON.stringify(
      projects
        .map((project) => ({ name: project.name, path: resolve(project.path) }))
        .sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path)),
    );

  /** @param {string} routeName */
  async function resolveProject(routeName) {
    if (stopped) return null;
    const projects = registry();
    const identity = registryIdentity(projects);
    const targets = await enumerate(projects);
    if (stopped) return null;
    const target = targets.find((candidate) => candidate.routeName === routeName);
    // Enumeration is cached briefly, so validate both existence and target
    // incarnation before reusing or creating a runtime.
    if (!target || !targetIsCurrent(target)) {
      const stale = runtimes.get(routeName);
      if (stale) await closeRuntime(routeName, stale);
      return null;
    }
    let runtime = runtimes.get(routeName);
    if (!runtime || !runtimeMatchesTarget(runtime, target)) {
      if (runtime) await closeRuntime(routeName, runtime);
      let starting = runtimeStarts.get(routeName);
      if (!starting) {
        starting = (async () => {
          const created = await createProjectRuntime(target.path, target, watchFactory);
          if (stopped) await closeRuntime(routeName, created);
          return created;
        })();
        runtimeStarts.set(routeName, starting);
        void starting.then(
          () => {
            if (runtimeStarts.get(routeName) === starting) runtimeStarts.delete(routeName);
          },
          () => {
            if (runtimeStarts.get(routeName) === starting) runtimeStarts.delete(routeName);
          },
        );
      }
      runtime = await starting;
      if (stopped) {
        await closeRuntime(routeName, runtime);
        return null;
      }
      const mapped = runtimes.get(routeName);
      if (mapped) {
        if (mapped !== runtime) await closeRuntime(routeName, runtime);
        runtime = mapped;
      } else {
        runtimes.set(routeName, runtime);
      }
    }
    await runtime.ready;
    // Registry identity or target incarnation can change while watcher startup
    // is pending. Never return a runtime that was unmapped, closed, or
    // superseded across that asynchronous boundary.
    if (
      stopped ||
      runtime.closed ||
      runtimes.get(routeName) !== runtime ||
      registryIdentity(registry()) !== identity ||
      !targetIsCurrent(target) ||
      !runtimeMatchesTarget(runtime, target)
    ) {
      if (runtimes.get(routeName) === runtime) await closeRuntime(routeName, runtime);
      return null;
    }
    return { target, runtime };
  }

  /** @param {unknown} data @param {number} [status] */
  const json = (data, status = 200) => Response.json(data, { status });

  async function projectListing() {
    const projects = configFile
      ? pruneProjects({ file: configFile }).kept
      : (fixedProjects ?? (root ? registry() : observeMissingProjects()));
    const targets = await enumerate(projects);
    const activeTargets = new Map(
      targets.filter(targetIsCurrent).map((target) => [target.routeName, target]),
    );
    for (const [routeName, runtime] of runtimes) {
      const target = activeTargets.get(routeName);
      if (target && runtimeMatchesTarget(runtime, target)) continue;
      await closeRuntime(routeName, runtime);
    }
    return Promise.all(
      targets.map(async (target) => ({
        ...target,
        summary: target.missing ? null : await gitSummary(target.path),
      })),
    );
  }

  // Walk forward from the default port if it's taken; a user-pinned --port fails loudly.
  /** @param {number} p */
  const serve = (p) =>
    Bun.serve({
      port: p,
      hostname: host,
      // Bun's default 10 s idleTimeout kills quiet connections — fatal for the
      // SSE stream (idle by design, pinged every 30 s) and for slow first
      // /api/tree responses. 0 disables it; the git layer has its own 30 s cap.
      idleTimeout: 0,
      async fetch(req) {
        const url = new URL(req.url);
        const { pathname } = url;

        if (pathname === "/api/projects")
          return json({
            hostname: SERVER_HOSTNAME,
            version: runningVersion,
            projects: await projectListing(),
          });

        const match = pathname.match(/^\/p\/([^/]+)(\/.*)?$/);
        if (match) {
          let routeName;
          try {
            routeName = decodeURIComponent(match[1]);
          } catch {
            return new Response("not found", { status: 404 });
          }
          const tail = match[2] ?? "/";
          const selected = await resolveProject(routeName);
          if (!selected)
            return tail === "/"
              ? new Response(PROJECT_NOT_FOUND_HTML, {
                  status: 404,
                  headers: { "Content-Type": "text/html; charset=utf-8" },
                })
              : new Response("project not found", { status: 404 });
          const { target, runtime } = selected;
          const projectRoot = target.path;

          if (tail === "/") {
            if (configFile) {
              const parent =
                target.kind === "worktree"
                  ? registry().find((project) => project.name === target.parent)
                  : registry().find((project) => project.name === target.name);
              if (parent) registerProject(parent.path, { file: configFile });
            }
            const af = join(DIST, "index.html");
            if (existsSync(af)) return new Response(Bun.file(af));
            return new Response("peruse: no built client found — run `bun run build`", {
              status: 500,
            });
          }

          if (tail === "/api/tree") {
            const t0 = Date.now();
            const gs = runtime.rememberIgnored(await gitStatus(projectRoot));
            const tGit = Date.now();
            const tree = buildTree(projectRoot, gs);
            if (Date.now() - t0 > 2000)
              console.error(
                `peruse: slow /api/tree — git ${tGit - t0} ms, walk ${Date.now() - tGit} ms`,
              );
            return json({
              root: projectRoot,
              isRepo: gs.isRepo,
              branchState: gs.branchState,
              tree,
            });
          }

          if (tail === "/api/file") {
            const sp = safePath(projectRoot, url.searchParams.get("path") ?? "");
            if (!sp || !existsSync(sp.abs) || !statSync(sp.abs).isFile())
              return json({ error: "not found" }, 404);
            const gs = runtime.rememberIgnored(await gitStatus(projectRoot));
            const status = gs.status.get(sp.rel) ?? null;
            const buf = new Uint8Array(await Bun.file(sp.abs).arrayBuffer());
            const binary = buf.slice(0, 8192).includes(0);
            const content = binary ? null : new TextDecoder().decode(buf);
            return json({
              path: sp.rel,
              size: buf.byteLength,
              binary,
              status,
              ignored: gs.ignored.has(sp.rel),
              content,
              hunks:
                gs.isRepo && content !== null
                  ? await fileHunks(projectRoot, sp.rel, status, gs.base, content)
                  : [],
            });
          }

          if (tail.startsWith("/raw/")) {
            const sp = safePath(projectRoot, decodeURIComponent(tail.slice(5)));
            if (!sp || !existsSync(sp.abs) || !statSync(sp.abs).isFile())
              return new Response("not found", { status: 404 });
            return new Response(Bun.file(sp.abs), {
              headers: {
                "Content-Security-Policy":
                  "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:",
              },
            });
          }

          if (tail === "/api/events") {
            /** @type {ReadableStreamDefaultController<string> | null} */
            let ctrl = null;
            const stream = new ReadableStream({
              start(c) {
                ctrl = c;
                if (runtime.addClient(c)) c.enqueue("retry: 1000\n\n");
              },
              cancel() {
                if (ctrl) runtime.removeClient(ctrl);
              },
            });
            return new Response(stream, {
              headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" },
            });
          }

          return new Response("not found", { status: 404 });
        }

        // Prebuilt client assets
        const asset = pathname === "/" ? "index.html" : pathname.slice(1);
        const af = resolve(DIST, asset);
        if (af.startsWith(`${DIST}/`) && existsSync(af) && statSync(af).isFile())
          return new Response(Bun.file(af));
        if (pathname === "/")
          return new Response("peruse: no built client found — run `bun run build`", {
            status: 500,
          });
        return new Response("not found", { status: 404 });
      },
    });

  /** @type {ReturnType<typeof Bun.serve>} */
  let server;
  try {
    for (let p = port; ; p++) {
      try {
        server = serve(p);
        break;
      } catch (err) {
        const addressInUse =
          typeof err === "object" && err !== null && "code" in err && err.code === "EADDRINUSE";
        if (portFixed || !addressInUse || p >= port + 20) throw err;
      }
    }
  } catch (err) {
    // A pinned port that's busy (or any other bind failure) throws before we
    // return a stop() handle — close what's already running so the watcher
    // and ping timer don't leak past the failed startServer() call.
    await Promise.all([...runtimes.values()].map((runtime) => runtime.close()));
    throw err;
  }
  /** Drain until no start can produce a runtime and every watcher close has settled. */
  const drainRuntimes = async () => {
    let failure;
    for (;;) {
      const work = [
        ...runtimeStarts.values(),
        ...[...runtimes].map(([routeName, runtime]) => closeRuntime(routeName, runtime)),
        ...runtimeCloses,
      ];
      if (work.length === 0) break;
      for (const result of await Promise.allSettled(work))
        if (result.status === "rejected" && failure === undefined) failure = result.reason;
    }
    if (failure !== undefined) throw failure;
  };
  /** @type {Promise<void> | null} */
  let stopPromise = null;
  // stop() is for tests and embedders; the CLI just exits. Mark stopped and
  // reject new HTTP work before draining all runtime starts and closes.
  const stop = () => {
    if (!stopPromise) {
      stopped = true;
      server.stop(true);
      stopPromise = drainRuntimes();
    }
    return stopPromise;
  };
  return { port: server.port, host, version: runningVersion, stop };
}

// Dev convenience: `bun run server/index.js [path]` serves without the CLI wrapper.
if (import.meta.main) {
  const root = resolve(process.argv[2] ?? ".");
  const { port, version } = await startServer({ root, port: 7440, host: "127.0.0.1" });
  console.log(`peruse ${version} — serving ${root}\n  → http://127.0.0.1:${port}/p/project/`);
}
