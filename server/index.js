// peruse server: static page + file/git/events API. All rendering is client-side.
import { join, resolve, relative, dirname } from "node:path";
import { readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import chokidar from "chokidar";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(PKG, "dist");

// Running from a checkout, a git pull must never silently serve a stale
// client: rebuild dist/ whenever web/ sources are newer. No-op for the npm
// package and compiled binaries (no web/ shipped).
function ensureFreshClient() {
  const webDir = join(PKG, "web");
  if (!existsSync(webDir)) return;
  const newest = Math.max(...readdirSync(webDir)
    .map((f) => statSync(join(webDir, f)).mtimeMs));
  const distApp = join(DIST, "app.js");
  if (!existsSync(distApp) || statSync(distApp).mtimeMs < newest) {
    console.error("peruse: client sources newer than dist/ — rebuilding…");
    const r = Bun.spawnSync(["bun", "run", "build"], { cwd: PKG, stdout: "inherit", stderr: "inherit" });
    if (r.exitCode !== 0) console.error("peruse: build failed — serving the stale client");
  }
}
// Well-known git empty tree — diff base for repos with no commits yet.
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

// stderr is IGNORED, never piped-and-unread: a chatty git (permission
// warnings, advisories) filling an unread 64 KB pipe blocks forever and
// hangs the request. The timeout bounds any other pathology (dead mounts,
// index locks); a killed git degrades to "no status" instead of a hang.
async function git(root, ...args) {
  const t0 = Date.now();
  const proc = Bun.spawn(["git", ...args], {
    cwd: root, stdout: "pipe", stderr: "ignore", timeout: 30_000,
  });
  const out = await proc.stdout.text();
  const code = await proc.exited;
  const ms = Date.now() - t0;
  if (ms > 2000)
    console.error(`peruse: slow git ${args.join(" ").slice(0, 60)} — ${ms} ms` +
      (code === 143 ? " (killed by 30 s timeout)" : ""));
  return { code, out };
}

/** @returns {Promise<{isRepo: boolean, prefix: string, base: string}>} */
async function gitInfo(root) {
  const { code, out } = await git(root, "rev-parse", "--show-prefix");
  if (code !== 0) return { isRepo: false, prefix: "", base: EMPTY_TREE };
  const head = await git(root, "rev-parse", "--verify", "-q", "HEAD");
  return { isRepo: true, prefix: out.trim(), base: head.code === 0 ? "HEAD" : EMPTY_TREE };
}

/** Status letter per path (M/A/D/R/U) + set of gitignored paths (dirs end with /). */
export async function gitStatus(root) {
  const info = await gitInfo(root);
  const status = new Map();
  const ignored = new Set();
  if (!info.isRepo) return { ...info, status, ignored };

  const st = await git(root, "status", "--porcelain=v2", "-z", "--untracked-files=all");
  const parts = st.out.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (!entry) continue;
    const type = entry[0];
    let letter, repoPath;
    if (type === "?") { letter = "U"; repoPath = entry.slice(2); }
    else if (type === "1" || type === "u") {
      const f = entry.split(" ");
      const [x, y] = f[1];
      letter = y !== "." ? y : x;
      repoPath = f.slice(8).join(" ");
    } else if (type === "2") {
      letter = "R";
      repoPath = entry.split(" ").slice(9).join(" ");
      i++; // -z rename entries carry origPath in the next NUL field
    } else continue;
    if (repoPath.startsWith(info.prefix))
      status.set(repoPath.slice(info.prefix.length), letter);
  }

  // Collapsed listing (dirs get a trailing /) so the tree never walks node_modules etc.
  const ig = await git(root, "ls-files", "-z", "-o", "-i", "--exclude-standard", "--directory");
  for (const p of ig.out.split("\0")) if (p) ignored.add(p);
  return { ...info, status, ignored };
}

const MAX_DIR_ENTRIES = 500;

export function buildTree(root, gs, dir = "") {
  const nodes = [];
  let entries;
  try { entries = readdirSync(join(root, dir), { withFileTypes: true }); }
  catch { return nodes; }
  entries.sort((a, b) =>
    (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name));
  for (const e of entries) {
    if (e.name === ".git") continue;
    // Junk dirs that aren't gitignored (caches, browser profiles) can hold
    // tens of thousands of entries — cap per directory so the tree JSON and
    // the DOM stay sane.
    if (nodes.length >= MAX_DIR_ENTRIES) {
      nodes.push({ name: `… ${entries.length - nodes.length} more entries not shown`,
        path: `${dir}/…`, truncated: true });
      break;
    }
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) {
      const isIgnored = gs.ignored.has(rel + "/");
      // Ignored dirs are shown (dimmed) but not walked — keeps the tree small.
      const children = isIgnored ? [] : buildTree(root, gs, rel);
      // VS Code-style folder decoration: flag dirs containing any change.
      nodes.push({ name: e.name, path: rel, dir: true, ignored: isIgnored, children,
        dirty: children.some((c) => (c.dir ? c.dirty : !!c.status)) });
    } else if (e.isFile()) {
      nodes.push({ name: e.name, path: rel, dir: false,
        status: gs.status.get(rel) ?? null, ignored: gs.ignored.has(rel) });
    }
  }
  return nodes;
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parseHunks(diffText) {
  const hunks = [];
  for (const line of diffText.split("\n")) {
    const m = line.match(HUNK_RE);
    if (m) {
      const [, oldStart, oldLines = "1", newStart, newLines = "1"] = m;
      hunks.push({
        oldStart: +oldStart, oldLines: +oldLines, newStart: +newStart, newLines: +newLines,
        kind: +newLines === 0 ? "deleted" : +oldLines === 0 ? "added" : "modified",
        patch: line,
      });
    } else if (hunks.length && /^[-+ \\]/.test(line)) {
      hunks[hunks.length - 1].patch += "\n" + line;
    }
  }
  return hunks;
}

// Zero-context diff: each hunk is one contiguous change, so gutter marks sit
// exactly on the changed lines and nearby edits never merge into one hunk
// (git -U3 would). The popup patch then gets up to 3 context lines re-added
// around each change from the worktree content, below.
async function fileHunks(root, rel, status, base, content) {
  if (!status || status === "D") return [];
  const { out } = status === "U"
    ? await git(root, "diff", "--no-index", "--no-color", "-U0", "--", "/dev/null", rel)
    : await git(root, "diff", base, "--no-color", "-U0", "--", rel);
  const lines = content.replace(/\n$/, "").split("\n");
  return parseHunks(out).map((h) => withContext(h, lines, 3));
}

// Context lines are identical on both diff sides, so they can come straight
// from the current file; only the hunk header math differs per side (a side
// with count 0 uses the line-after-which convention, hence the +1).
export function withContext(h, lines, ctx) {
  const start = h.newLines === 0 ? h.newStart + 1 : h.newStart;
  const before = Math.min(ctx, start - 1);
  const endNew = h.newLines === 0 ? h.newStart : h.newStart + h.newLines - 1;
  const after = Math.min(ctx, Math.max(0, lines.length - endNew));
  const above = lines.slice(start - 1 - before, start - 1).map((l) => " " + l);
  const below = lines.slice(endNew, endNew + after).map((l) => " " + l);
  const oldStart = h.oldStart - before + (h.oldLines === 0 ? 1 : 0);
  const newStart = h.newStart - before + (h.newLines === 0 ? 1 : 0);
  const header =
    `@@ -${oldStart},${h.oldLines + before + after} +${newStart},${h.newLines + before + after} @@`;
  const body = h.patch.split("\n").slice(1);
  return { ...h, patch: [header, ...above, ...body, ...below].join("\n") };
}

/** Resolve a request path safely under root; returns null on traversal or .git. */
export function safePath(root, rel) {
  rel = rel.replace(/^\/+/, "");
  const abs = resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + "/")) return null;
  const inside = relative(root, abs);
  if (inside === ".git" || inside.startsWith(".git/")) return null;
  return { abs, rel: inside };
}

export async function startServer({ root, port, host, portFixed = false }) {
  ensureFreshClient();
  const clients = new Set();
  let pendingChanged = new Set(), pendingGit = false, flushTimer = null;

  // Gitignored dirs are never shown expanded, so they're never watched either.
  // Crucial on macOS, where each watched directory costs a file descriptor
  // (kqueue, default ulimit 256) — a stray browser-profile or cache dir in the
  // repo would otherwise starve the whole server. Refreshed on every gitStatus.
  let ignoredDirs = new Set();
  const rememberIgnored = (gs) => {
    ignoredDirs = new Set(
      [...gs.ignored].filter((p) => p.endsWith("/")).map((p) => p.slice(0, -1)));
    return gs;
  };
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
    pendingChanged = new Set(); pendingGit = false;
    for (const c of clients) {
      try { c.enqueue(payload); } catch { clients.delete(c); }
    }
  }

  // followSymlinks:false keeps the scan inside the root and off special files
  // (Chrome's SingletonSocket symlink→unix-socket makes realpath throw
  // EOPNOTSUPP on macOS); the error handler keeps any remaining scanner
  // surprise from crashing the server — worst case one directory isn't watched.
  // Unconditional backstop, independent of .gitignore: never watch more than
  // WATCH_BUDGET directories. Each watched dir costs a kqueue fd on macOS
  // (soft ulimit is often 256–10240) and an inotify watch on Linux; a huge
  // un-ignored junk dir must cost live updates for its corner of the tree,
  // never the whole server.
  // Default budget derives from the process's real fd limit. Empirically each
  // watched path costs ~2-3 fds under Bun (watch handle + event plumbing), so
  // an eighth of the limit leaves room for those multiples plus the runtime
  // baseline, HTTP traffic, and scan-time directory reads — even on a
  // hard-capped 256-fd process. "unlimited" → cap. The CLI's ulimit re-exec
  // makes the normal-case limit 10240, i.e. a 1280-path budget.
  let softFd = 0;
  try {
    softFd = Number((await Bun.spawn(["sh", "-c", "ulimit -n"]).stdout.text()).trim()) || 0;
  } catch {}
  const WATCH_BUDGET = Number(process.env.PERUSE_WATCH_BUDGET)
    || (softFd > 0 ? Math.min(5000, Math.floor(softFd / 8)) : 5000);
  // Below ~1024 fds even the watcher's initial scan (concurrent opendir) can
  // starve the process, budget or no budget — verified empirically. The CLI
  // re-execs with a raised limit before we get here, so landing in this branch
  // means the hard limit itself is tiny: run without live updates rather than
  // hang. PERUSE_WATCH_BUDGET forces watching on for whoever wants to gamble.
  const watchable = Number(process.env.PERUSE_WATCH_BUDGET) > 0
    || softFd === 0 || softFd >= 1024;
  // The budget counts every distinct path admitted to the watcher — chokidar
  // holds an fd per watched FILE as well as per directory under Bun, and it
  // doesn't reliably pass `stats` to this callback, so admission is decided on
  // first sight of each path and remembered for consistency across calls.
  const admitted = new Set();
  let budgetWarned = false;
  let watcher = null;
  if (!watchable) {
    console.error(`peruse: fd limit too low (${softFd}) even to scan safely — ` +
      `live updates disabled; raise \`ulimit -n\` (hard limit) to enable them`);
  } else {
    watcher = chokidar.watch(root, {
      ignoreInitial: true,
      followSymlinks: false,
      ignored: (p, stats) => {
        if (stats && !stats.isFile() && !stats.isDirectory()) return true; // sockets, FIFOs, …
        const rel = relative(root, p);
        if (rel.split("/").includes("node_modules") || rel.startsWith(".git/objects")
          || inIgnoredDir(rel)) return true;
        if (!admitted.has(rel)) {
          if (admitted.size >= WATCH_BUDGET) {
            if (!budgetWarned) {
              budgetWarned = true;
              console.error(`peruse: watch budget (${WATCH_BUDGET} paths, from the fd limit) ` +
                `reached — live updates disabled for the rest of the tree; gitignore large ` +
                `generated directories, raise \`ulimit -n\`, or set PERUSE_WATCH_BUDGET`);
            }
            return true;
          }
          admitted.add(rel);
        }
        return false;
      },
    });
    let watchErrors = 0;
    watcher.on("error", (err) => {
      if (++watchErrors <= 3) console.error(`peruse: watcher: ${err.message ?? err}`);
      else if (watchErrors === 4) console.error("peruse: further watcher errors suppressed");
    });
    watcher.on("all", (_event, p) => {
      const rel = relative(root, p);
      if (!rel) return;
      if (rel === ".git" || rel.startsWith(".git/")) pendingGit = true;
      else pendingChanged.add(rel);
      if (!flushTimer) flushTimer = setTimeout(broadcast, 200);
    });
  }
  const pingTimer = setInterval(() => {
    for (const c of clients) { try { c.enqueue(": ping\n\n"); } catch { clients.delete(c); } }
  }, 30_000);
  pingTimer.unref?.();

  const json = (data, status = 200) =>
    Response.json(data, { status });

  // Walk forward from the default port if it's taken; a user-pinned --port fails loudly.
  const serve = (p) => Bun.serve({
    port: p, hostname: host,
    // Bun's default 10 s idleTimeout kills quiet connections — fatal for the
    // SSE stream (idle by design, pinged every 30 s) and for slow first
    // /api/tree responses. 0 disables it; the git layer has its own 30 s cap.
    idleTimeout: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const { pathname } = url;

      if (pathname === "/api/tree") {
        const t0 = Date.now();
        const gs = rememberIgnored(await gitStatus(root));
        const tGit = Date.now();
        const tree = buildTree(root, gs);
        if (Date.now() - t0 > 2000)
          console.error(`peruse: slow /api/tree — git ${tGit - t0} ms, walk ${Date.now() - tGit} ms`);
        return json({ root, isRepo: gs.isRepo, tree });
      }

      if (pathname === "/api/file") {
        const sp = safePath(root, url.searchParams.get("path") ?? "");
        if (!sp || !existsSync(sp.abs) || !statSync(sp.abs).isFile())
          return json({ error: "not found" }, 404);
        const gs = rememberIgnored(await gitStatus(root));
        const status = gs.status.get(sp.rel) ?? null;
        const buf = new Uint8Array(await Bun.file(sp.abs).arrayBuffer());
        const binary = buf.slice(0, 8192).includes(0);
        const content = binary ? null : new TextDecoder().decode(buf);
        return json({
          path: sp.rel, size: buf.byteLength, binary, status,
          ignored: gs.ignored.has(sp.rel),
          content,
          hunks: gs.isRepo && !binary
            ? await fileHunks(root, sp.rel, status, gs.base, content) : [],
        });
      }

      if (pathname.startsWith("/raw/")) {
        const sp = safePath(root, decodeURIComponent(pathname.slice(5)));
        if (!sp || !existsSync(sp.abs) || !statSync(sp.abs).isFile())
          return new Response("not found", { status: 404 });
        return new Response(Bun.file(sp.abs));
      }

      if (pathname === "/api/events") {
        let ctrl;
        const stream = new ReadableStream({
          start(c) { ctrl = c; clients.add(c); c.enqueue("retry: 1000\n\n"); },
          cancel() { clients.delete(ctrl); },
        });
        return new Response(stream, {
          headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" },
        });
      }

      // Prebuilt client assets
      const asset = pathname === "/" ? "index.html" : pathname.slice(1);
      const af = resolve(DIST, asset);
      if (af.startsWith(DIST + "/") && existsSync(af) && statSync(af).isFile())
        return new Response(Bun.file(af));
      if (pathname === "/" )
        return new Response("peruse: no built client found — run `bun run build`", { status: 500 });
      return new Response("not found", { status: 404 });
    },
  });

  let server;
  for (let p = port; ; p++) {
    try { server = serve(p); break; }
    catch (err) {
      if (portFixed || err?.code !== "EADDRINUSE" || p >= port + 20) throw err;
    }
  }
  // stop() is for tests and embedders; the CLI just exits.
  const stop = async () => {
    clearInterval(pingTimer);
    if (flushTimer) clearTimeout(flushTimer);
    await watcher?.close();
    server.stop(true);
  };
  return { port: server.port, host, stop };
}

// Dev convenience: `bun run server/index.js [path]` serves without the CLI wrapper.
if (import.meta.main) {
  const root = resolve(process.argv[2] ?? ".");
  const { port } = await startServer({ root, port: 7440, host: "127.0.0.1" });
  console.log(`peruse (dev) — serving ${root}\n  → http://127.0.0.1:${port}/`);
}
