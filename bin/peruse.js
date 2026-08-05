#!/usr/bin/env bun
import { existsSync, statSync } from "node:fs";
import { networkInterfaces } from "node:os";
// peruse [path] [--port 7440] [--host 127.0.0.1]
import { resolve } from "node:path";
import { startServer } from "../server/index.js";
import {
  pruneProjects,
  readProjects,
  registerProject,
  registryPath,
  removeProject,
} from "../server/projects.js";

// The watcher costs one fd per watched path, and stock shells (macOS: 256)
// are far too small for real trees. Re-exec once through sh with the soft
// limit raised toward the hard limit; if raising fails, the server's watch
// budget still keeps us alive, just with fewer live paths.
if (process.platform !== "win32" && !process.env.PERUSE_FDS_RAISED) {
  const soft = Number(Bun.spawnSync(["sh", "-c", "ulimit -n"]).stdout.toString().trim()) || 0;
  if (soft > 0 && soft < 4096) {
    const proc = Bun.spawnSync(
      [
        "sh",
        "-c",
        'ulimit -n 10240 2>/dev/null || ulimit -n "$(ulimit -Hn)" 2>/dev/null; exec "$@"',
        "sh",
        process.execPath,
        ...process.argv.slice(1),
      ],
      { stdio: ["inherit", "inherit", "inherit"], env: { ...process.env, PERUSE_FDS_RAISED: "1" } },
    );
    process.exit(proc.exitCode ?? 0);
  }
}

const HELP = `peruse — lightweight local directory viewer

Usage: peruse [path] [options]
       peruse add <path>
       peruse rm <name-or-path>
       peruse list
       peruse prune

Options:
  --port <n>    Port to listen on (default 7440, or next free port after it;
                an explicitly given port is used as-is or fails)
  --host <h>    Host to bind (default 127.0.0.1; use 0.0.0.0 to allow other
                machines on your LAN/VPN to browse — peruse has no auth, so
                anyone who can reach the port can read the served directory)
  --version     Print version
  --help        Show this help`;

const args = process.argv.slice(2);
/** @type {string | null} */
let root = null,
  port = 7440,
  host = "127.0.0.1",
  portFixed = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--help" || a === "-h") {
    console.log(HELP);
    process.exit(0);
  } else if (a === "--version" || a === "-v") {
    const pkg = await import("../package.json");
    console.log(pkg.default.version);
    process.exit(0);
  } else if (a === "--port") {
    port = Number(args[++i]);
    portFixed = true;
  } else if (a === "--host") host = args[++i];
  else if (!a.startsWith("-") && root === null) root = a;
  else if (["add", "rm"].includes(root ?? "") && i === 1) continue;
  else {
    console.error(`Unknown option: ${a}\n\n${HELP}`);
    process.exit(1);
  }
}

const configFile = registryPath();
if (root === "add") {
  const path = resolve(args[1] ?? ".");
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    console.error(`peruse: not a directory: ${path}`);
    process.exit(1);
  }
  const project = registerProject(path, { file: configFile });
  console.log(`${project.name}\t${project.path}`);
  process.exit(0);
}
if (root === "rm") {
  const selector = args[1];
  if (!selector) {
    console.error("peruse: rm requires a project name or path");
    process.exit(1);
  }
  const removed = removeProject(selector, configFile);
  if (!removed) {
    console.error(`peruse: project not found: ${selector}`);
    process.exit(1);
  }
  console.log(`removed ${selector}`);
  process.exit(0);
}
if (root === "list") {
  for (const project of readProjects(configFile))
    console.log(`${project.name}\t${project.path}\t${project.lastOpened}`);
  process.exit(0);
}
if (root === "prune") {
  const { removed } = pruneProjects({ file: configFile, immediate: true });
  for (const project of removed) console.log(`removed ${project.name}\t${project.path}`);
  if (!removed.length) console.log("no missing projects");
  process.exit(0);
}
if (root !== null) {
  root = resolve(root);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.error(`peruse: not a directory: ${root}`);
    process.exit(1);
  }
}
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`peruse: invalid port`);
  process.exit(1);
}

let started;
const selected = root ? registerProject(root, { file: configFile }) : null;
try {
  started = await startServer({ configFile, port, host, portFixed });
} catch (err) {
  const addressInUse =
    typeof err === "object" && err !== null && "code" in err && err.code === "EADDRINUSE";
  if (addressInUse) {
    console.error(`peruse: port ${port} is already in use${portFixed ? "" : " (and the next 20)"}`);
    process.exit(1);
  }
  throw err;
}
// When bound to all interfaces, list every address a browser could actually reach
// (LAN, Tailscale, …) — "http://0.0.0.0" itself is not a usable URL.
const urls = [];
if (host === "0.0.0.0" || host === "::") {
  urls.push(`http://127.0.0.1:${started.port}`);
  for (const addrs of Object.values(networkInterfaces()))
    for (const a of addrs ?? [])
      if (a.family === "IPv4" && !a.internal) urls.push(`http://${a.address}:${started.port}`);
} else {
  urls.push(`http://${host}:${started.port}`);
}
// No auto-open, deliberately (owner decision 2026-08-05): peruse's home
// use case is remote — the server host is not where the browser lives, so
// spawning one here would be useless at best. The URLs are the product.
const destination = selected ? `/p/${encodeURIComponent(selected.name)}/` : "/";
const destinationUrls = urls.map((url) => `${url}${destination}`);
console.log(
  `peruse — serving ${readProjects(configFile).length} project(s)\n` +
    destinationUrls.map((url) => `  → ${url}`).join("\n"),
);
