#!/usr/bin/env bun
// peruse [path] [--port 7440] [--host 127.0.0.1] [--no-open]
import { resolve } from "node:path";
import { existsSync, statSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { startServer } from "../server/index.js";

const HELP = `peruse — lightweight local directory viewer

Usage: peruse [path] [options]

Options:
  --port <n>    Port to listen on (default 7440, or next free port after it;
                an explicitly given port is used as-is or fails)
  --host <h>    Host to bind (default 127.0.0.1; use 0.0.0.0 to allow other
                machines on your LAN/VPN to browse — peruse has no auth, so
                anyone who can reach the port can read the served directory)
  --no-open     Don't open the browser
  --version     Print version
  --help        Show this help`;

const args = process.argv.slice(2);
let root = ".", port = 7440, host = "127.0.0.1", open = true, portFixed = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--help" || a === "-h") { console.log(HELP); process.exit(0); }
  else if (a === "--version" || a === "-v") {
    const pkg = await import("../package.json");
    console.log(pkg.default.version); process.exit(0);
  }
  else if (a === "--port") { port = Number(args[++i]); portFixed = true; }
  else if (a === "--host") host = args[++i];
  else if (a === "--no-open") open = false;
  else if (!a.startsWith("-")) root = a;
  else { console.error(`Unknown option: ${a}\n\n${HELP}`); process.exit(1); }
}

root = resolve(root);
if (!existsSync(root) || !statSync(root).isDirectory()) {
  console.error(`peruse: not a directory: ${root}`);
  process.exit(1);
}
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`peruse: invalid port`);
  process.exit(1);
}

let started;
try {
  started = await startServer({ root, port, host, portFixed });
} catch (err) {
  if (err?.code === "EADDRINUSE") {
    console.error(`peruse: port ${port} is already in use${portFixed ? "" : " (and the next 20)"}`);
    process.exit(1);
  }
  throw err;
}
// When bound to all interfaces, list every address a browser could actually reach
// (LAN, Tailscale, …) — "http://0.0.0.0" itself is not a usable URL.
const urls = [];
if (host === "0.0.0.0" || host === "::") {
  urls.push(`http://127.0.0.1:${started.port}/`);
  for (const addrs of Object.values(networkInterfaces()))
    for (const a of addrs ?? [])
      if (a.family === "IPv4" && !a.internal) urls.push(`http://${a.address}:${started.port}/`);
} else {
  urls.push(`http://${host}:${started.port}/`);
}
console.log(`peruse — serving ${root}\n${urls.map((u) => `  → ${u}`).join("\n")}`);
if (open) {
  const url = urls[0];
  const cmd = process.platform === "darwin" ? ["open", url]
    : process.platform === "win32" ? ["cmd", "/c", "start", "", url]
    : ["xdg-open", url];
  Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" }).unref();
}
