import { expect, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildTree } from "../../server/index.js";
import { parsePeruseShow } from "../../server/peruseshow.js";
import { makeFixtureRepo, startFixtureServer } from "../fixture.js";

const find = (nodes, path) => {
  for (const node of nodes) {
    if (node.path === path) return node;
    if (node.dir && path.startsWith(`${node.path}/`)) return find(node.children, path);
  }
  return null;
};

test(".peruseshow walks selected ignored paths, reloads, and filters live events", async () => {
  const root = makeFixtureRepo();
  appendFileSync(join(root, ".gitignore"), "build/\nnotes/\nnode_modules/\n");
  for (const dir of ["build", "notes", "node_modules"])
    mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, "build/out.txt"), "generated\n");
  writeFileSync(join(root, "notes/todo.md"), "# Todo\n");
  writeFileSync(join(root, "notes/other.md"), "# Other\n");
  writeFileSync(join(root, "notes/private.local.md"), "# Local\n");
  writeFileSync(join(root, "node_modules/x"), "hidden\n");
  const srv = await startFixtureServer(root, 0);
  try {
    let tree = (await srv.json("/api/tree")).body.tree;
    expect(find(tree, "build").children).toEqual([]);
    expect(find(tree, "notes").children).toEqual([]);

    writeFileSync(join(root, ".peruseshow"), "notes/\n");
    tree = (await srv.json("/api/tree")).body.tree;
    expect(find(tree, "notes").ignored).toBe(true);
    expect(find(tree, "notes/todo.md").ignored).toBe(true);
    expect(find(tree, "build").children).toEqual([]);
    expect(find(tree, "node_modules").children).toEqual([]);
    expect(find(tree, ".git")).toBeNull();
    expect((await srv.json("/api/file?path=notes/todo.md")).body.ignored).toBe(true);

    writeFileSync(join(root, ".peruseshow"), "/notes/todo.md\n");
    tree = (await srv.json("/api/tree")).body.tree;
    expect(find(tree, "notes/todo.md")?.ignored).toBe(true);
    expect(find(tree, "notes/other.md")).toBeNull();
    writeFileSync(join(root, ".peruseshow"), "notes/private.local.md\n");
    tree = (await srv.json("/api/tree")).body.tree;
    expect(find(tree, "notes/private.local.md")?.ignored).toBe(true);
    expect(find(tree, "notes/todo.md")).toBeNull();
    writeFileSync(join(root, ".peruseshow"), "notes/\n");
    await srv.json("/api/tree");

    const response = await fetch(`${srv.base}/api/events`);
    const reader = response.body.getReader();
    try {
      await reader.read(); // retry preamble
      writeFileSync(join(root, "notes/todo.md"), "# Updated\n");
      writeFileSync(join(root, "node_modules/x"), "still hidden\n");
      let seenNote = false;
      let buffer = "";
      const deadline = Date.now() + 3000;
      while (!seenNote && Date.now() < deadline) {
        const result = await Promise.race([
          reader.read(),
          Bun.sleep(Math.max(0, deadline - Date.now())).then(() => ({ timeout: true })),
        ]);
        if (result.timeout || result.done) break;
        buffer += new TextDecoder().decode(result.value);
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const event = JSON.parse(line.slice(6));
          expect(event.changed).not.toContain("node_modules/x");
          if (event.changed.includes("notes/todo.md")) seenNote = true;
        }
      }
      expect(seenNote).toBe(true);
    } finally {
      reader.cancel().catch(() => {});
    }

    writeFileSync(join(root, ".peruseshow"), "notes/\nbuild/\n");
    tree = (await srv.json("/api/tree")).body.tree;
    expect(find(tree, "build/out.txt").ignored).toBe(true);
    expect(find(tree, "node_modules").children).toEqual([]);
  } finally {
    await srv.cleanup();
  }
}, 10000);

test("bare patterns do not walk or watch nested node_modules", async () => {
  const root = makeFixtureRepo();
  appendFileSync(join(root, ".gitignore"), "node_modules/\n");
  mkdirSync(join(root, "node_modules/pkg/sub"), { recursive: true });
  writeFileSync(join(root, "node_modules/pkg/sub/file.js"), "one\n");
  writeFileSync(join(root, "node_modules/pkg/sub/build"), "one\n");
  const srv = await startFixtureServer(root, 0);
  try {
    for (const [pattern, changed] of [
      ["*.local.md", "node_modules/pkg/sub/file.js"],
      ["n", "node_modules/pkg/sub/file.js"],
      ["build/", "node_modules/pkg/sub/build"],
    ]) {
      writeFileSync(join(root, ".peruseshow"), `${pattern}\n`);
      const tree = (await srv.json("/api/tree")).body.tree;
      expect(find(tree, "node_modules").children).toEqual([]);
      expect(find(tree, "node_modules/pkg")).toBeNull();

      const response = await fetch(`${srv.base}/api/events`);
      const reader = response.body.getReader();
      try {
        await reader.read();
        writeFileSync(join(root, changed), `${pattern}\n`);
        appendFileSync(join(root, "README.md"), "control\n");
        let sawControl = false;
        let buffer = "";
        const deadline = Date.now() + 3000;
        while (!sawControl && Date.now() < deadline) {
          const result = await Promise.race([
            reader.read(),
            Bun.sleep(Math.max(0, deadline - Date.now())).then(() => ({ timeout: true })),
          ]);
          if (result.timeout || result.done) break;
          buffer += new TextDecoder().decode(result.value);
          const lines = buffer.split("\n");
          buffer = lines.pop();
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const event = JSON.parse(line.slice(6));
            expect(event.changed).not.toContain(changed);
            if (event.changed.includes("README.md")) sawControl = true;
          }
        }
        expect(sawControl).toBe(true);
      } finally {
        reader.cancel().catch(() => {});
      }
    }
  } finally {
    await srv.cleanup();
  }
}, 10000);

test("a bare glob keeps a 500-ignored-directory tree walk bounded", () => {
  const root = mkdtempSync(join(tmpdir(), "peruse-show-scale-"));
  const ignored = new Set();
  try {
    for (let i = 0; i < 500; i++) {
      const name = `d${String(i).padStart(3, "0")}`;
      ignored.add(`${name}/`);
      mkdirSync(join(root, name, "pkg/sub"), { recursive: true });
      writeFileSync(join(root, name, "pkg/sub/file.js"), "x\n");
    }
    const gs = (show) => ({ ignored, status: new Map(), show });
    const measure = (show) => {
      let best = Infinity;
      for (let i = 0; i < 3; i++) {
        const start = performance.now();
        const tree = buildTree(root, gs(show));
        best = Math.min(best, performance.now() - start);
        expect(tree).toHaveLength(500);
        expect(tree.every((node) => node.children.length === 0)).toBe(true);
      }
      return best;
    };
    const baseline = measure(parsePeruseShow(""));
    const bareGlob = measure(parsePeruseShow("*.local.md\n"));
    expect(bareGlob).toBeLessThan(Math.max(30, baseline * 5));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
