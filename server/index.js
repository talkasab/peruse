// peruse server: static page + file/git/events API. All rendering is client-side.
import { join, resolve, relative, dirname } from "node:path";
import { readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import chokidar from "chokidar";

const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
// Well-known git empty tree — diff base for repos with no commits yet.
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

async function git(root, ...args) {
  const proc = Bun.spawn(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const out = await proc.stdout.text();
  const code = await proc.exited;
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
async function gitStatus(root) {
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

function buildTree(root, gs, dir = "") {
  const nodes = [];
  let entries;
  try { entries = readdirSync(join(root, dir), { withFileTypes: true }); }
  catch { return nodes; }
  entries.sort((a, b) =>
    (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name));
  for (const e of entries) {
    if (e.name === ".git") continue;
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) {
      const isIgnored = gs.ignored.has(rel + "/");
      // Ignored dirs are shown (dimmed) but not walked — keeps the tree small.
      nodes.push({ name: e.name, path: rel, dir: true, ignored: isIgnored,
        children: isIgnored ? [] : buildTree(root, gs, rel) });
    } else if (e.isFile()) {
      nodes.push({ name: e.name, path: rel, dir: false,
        status: gs.status.get(rel) ?? null, ignored: gs.ignored.has(rel) });
    }
  }
  return nodes;
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function parseHunks(diffText) {
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
function withContext(h, lines, ctx) {
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
function safePath(root, rel) {
  rel = rel.replace(/^\/+/, "");
  const abs = resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + "/")) return null;
  const inside = relative(root, abs);
  if (inside === ".git" || inside.startsWith(".git/")) return null;
  return { abs, rel: inside };
}

export async function startServer({ root, port, host, portFixed = false }) {
  const clients = new Set();
  let pendingChanged = new Set(), pendingGit = false, flushTimer = null;

  function broadcast() {
    flushTimer = null;
    const payload = `data: ${JSON.stringify({ changed: [...pendingChanged], git: pendingGit })}\n\n`;
    pendingChanged = new Set(); pendingGit = false;
    for (const c of clients) {
      try { c.enqueue(payload); } catch { clients.delete(c); }
    }
  }

  const watcher = chokidar.watch(root, {
    ignoreInitial: true,
    ignored: (p) => {
      const rel = relative(root, p);
      return rel.split("/").includes("node_modules") || rel.startsWith(".git/objects");
    },
  });
  watcher.on("all", (_event, p) => {
    const rel = relative(root, p);
    if (!rel) return;
    if (rel === ".git" || rel.startsWith(".git/")) pendingGit = true;
    else pendingChanged.add(rel);
    if (!flushTimer) flushTimer = setTimeout(broadcast, 200);
  });
  setInterval(() => {
    for (const c of clients) { try { c.enqueue(": ping\n\n"); } catch { clients.delete(c); } }
  }, 30_000).unref?.();

  const json = (data, status = 200) =>
    Response.json(data, { status });

  // Walk forward from the default port if it's taken; a user-pinned --port fails loudly.
  const serve = (p) => Bun.serve({
    port: p, hostname: host,
    async fetch(req) {
      const url = new URL(req.url);
      const { pathname } = url;

      if (pathname === "/api/tree") {
        const gs = await gitStatus(root);
        return json({ root, isRepo: gs.isRepo, tree: buildTree(root, gs) });
      }

      if (pathname === "/api/file") {
        const sp = safePath(root, url.searchParams.get("path") ?? "");
        if (!sp || !existsSync(sp.abs) || !statSync(sp.abs).isFile())
          return json({ error: "not found" }, 404);
        const gs = await gitStatus(root);
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
  return { port: server.port, host };
}

// Dev convenience: `bun run server/index.js [path]` serves without the CLI wrapper.
if (import.meta.main) {
  const root = resolve(process.argv[2] ?? ".");
  const { port } = await startServer({ root, port: 7440, host: "127.0.0.1" });
  console.log(`peruse (dev) — serving ${root}\n  → http://127.0.0.1:${port}/`);
}
