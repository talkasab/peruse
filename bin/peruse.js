#!/usr/bin/env bun
// peruse [path] [--port 7440] [--host 127.0.0.1] [--no-open]
import { resolve } from "node:path";
import { existsSync, statSync } from "node:fs";
import { startServer } from "../server/index.js";

const HELP = `peruse — lightweight local directory viewer

Usage: peruse [path] [options]

Options:
  --port <n>    Port to listen on (default 7440)
  --host <h>    Host to bind (default 127.0.0.1)
  --no-open     Don't open the browser
  --version     Print version
  --help        Show this help`;

const args = process.argv.slice(2);
let root = ".", port = 7440, host = "127.0.0.1", open = true;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--help" || a === "-h") { console.log(HELP); process.exit(0); }
  else if (a === "--version" || a === "-v") {
    const pkg = await import("../package.json");
    console.log(pkg.default.version); process.exit(0);
  }
  else if (a === "--port") port = Number(args[++i]);
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

const url = await startServer({ root, port, host });
console.log(`peruse — serving ${root}\n  → ${url}`);
if (open) {
  const cmd = process.platform === "darwin" ? ["open", url]
    : process.platform === "win32" ? ["cmd", "/c", "start", "", url]
    : ["xdg-open", url];
  Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" }).unref();
}
