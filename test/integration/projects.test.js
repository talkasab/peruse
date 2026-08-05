import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../../server/index.js";
import { registerProject, registryPath } from "../../server/projects.js";

let root, configDir, configFile, server, origin, named;
beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "peruse-multi-root-"));
  configDir = mkdtempSync(join(tmpdir(), "peruse-multi-config-"));
  configFile = registryPath(configDir);
  const projectPath = join(root, "encoded");
  mkdirSync(projectPath);
  writeFileSync(join(projectPath, "hello.md"), "# Encoded route\n");
  named = registerProject(projectPath, { file: configFile, name: "Notes & plans" });
  registerProject(join(root, "missing"), { file: configFile, name: "Offline disk" });
  server = await startServer({
    configFile,
    port: 7571,
    host: "127.0.0.1",
    watchBudget: 100,
  });
  origin = `http://127.0.0.1:${server.port}`;
});
afterAll(async () => {
  await server?.stop();
  rmSync(root, { recursive: true, force: true });
  rmSync(configDir, { recursive: true, force: true });
});

describe("multi-root HTTP routing", () => {
  test("serves URL-encoded project names and scopes APIs beneath them", async () => {
    const base = `${origin}/p/${encodeURIComponent(named.name)}`;
    expect((await fetch(`${base}/`)).status).toBe(200);
    const tree = await (await fetch(`${base}/api/tree`)).json();
    expect(tree.tree.some((entry) => entry.name === "hello.md")).toBe(true);
    expect((await fetch(`${origin}/api/tree`)).status).toBe(404);
    expect((await fetch(`${origin}/p/Notes%20%26%20wrong/api/tree`)).status).toBe(404);
  });

  test("landing page and API expose git summaries and dimmable missing entries", async () => {
    const html = await (await fetch(`${origin}/`)).text();
    expect(html).toContain('class="landing"');
    expect(html).toContain('class="project-card"');
    const listing = await (await fetch(`${origin}/api/projects`)).json();
    const online = listing.projects.find((project) => project.name === named.name);
    const missing = listing.projects.find((project) => project.name === "Offline disk");
    expect(online).toMatchObject({ missing: false, kind: "project" });
    expect(missing).toMatchObject({ missing: true, kind: "project", summary: null });
    expect((await fetch(`${origin}/p/Offline%20disk/`)).status).toBe(404);
  });
});
