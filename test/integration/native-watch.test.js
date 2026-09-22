import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createProjectRuntime } from "../../server/index.js";
import { makeFixtureRepo, startFixtureServer } from "../fixture.js";

async function readEvent(reader, predicate, timeout = 2500) {
  const deadline = Date.now() + timeout;
  let buffer = "";
  while (Date.now() < deadline) {
    const result = await Promise.race([
      reader.read(),
      Bun.sleep(Math.max(0, deadline - Date.now())).then(() => ({ timeout: true })),
    ]);
    if (result.timeout || result.done) return null;
    buffer += new TextDecoder().decode(result.value);
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const event = JSON.parse(line.slice(6));
      if (predicate(event)) return event;
    }
  }
  return null;
}

describe("Bun native watcher contract", () => {
  test("events stay live when the process cwd is outside the served root", async () => {
    const root = makeFixtureRepo();
    const cwdBase = mkdtempSync(join(tmpdir(), "peruse-watch-cwd-"));
    const cwd = join(cwdBase, "node_modules/tool");
    mkdirSync(cwd, { recursive: true });
    const modulePath = fileURLToPath(new URL("../../server/index.js", import.meta.url));
    const code = `
      import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
      import { join } from "node:path";
      const { createProjectRuntime } = await import(${JSON.stringify(modulePath)});
      const root = ${JSON.stringify(root)};
      const runtime = await createProjectRuntime(root, { path: root });
      const events = [];
      runtime.addClient({
        enqueue(frame) {
          if (frame.startsWith("data: ")) events.push(JSON.parse(frame.slice(6)));
        },
        close() {},
      });
      async function expectEvent(name, match) {
        for (let i = 0; i < 40; i++) {
          const found = events.find(match);
          if (found) return found;
          await Bun.sleep(50);
        }
        throw new Error("missing " + name + " SSE frame");
      }
      try {
        await runtime.ready;
        appendFileSync(join(root, "README.md"), "root change\\n");
        const top = await expectEvent("root file", (event) => event.changed.includes("README.md"));
        appendFileSync(join(root, "src/util.py"), "# nested change\\n");
        const nested = await expectEvent("nested file", (event) => event.changed.includes("src/util.py"));
        const head = join(root, ".git/HEAD");
        writeFileSync(head, readFileSync(head));
        const git = await expectEvent("git metadata", (event) => event.git === true);
        console.log(JSON.stringify({ top, nested, git }));
      } finally {
        await runtime.close();
      }
    `;
    try {
      const child = Bun.spawn([process.execPath, "-e", code], {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        child.stdout.text(),
        child.stderr.text(),
        child.exited,
      ]);
      if (exitCode !== 0) throw new Error(stderr);
      const { top, nested, git } = JSON.parse(stdout.trim());
      expect(top.changed).toContain("README.md");
      expect(nested.changed).toContain("src/util.py");
      expect(git.git).toBe(true);
      expect(git.changed.some((path) => path.startsWith(".git"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(`${root}-outside`, { recursive: true, force: true });
      rmSync(cwdBase, { recursive: true, force: true });
    }
  });

  test("a recursive watcher catches new directories, poisoned siblings, and a directory swap", async () => {
    const root = makeFixtureRepo();
    const outside = mkdtempSync(join(tmpdir(), "peruse-native-watch-"));
    writeFileSync(join(root, "linkfarm/regular.txt"), "x\n");
    symlinkSync(join(root, "linkfarm/regular.txt", "missing"), join(root, "linkfarm/poison"));
    const server = await startFixtureServer(root, 7591);
    let reader;
    try {
      const response = await Promise.race([
        fetch(`${server.base}/api/events`),
        Bun.sleep(1600).then(() => null),
      ]);
      expect(response?.status).toBe(200);
      reader = response.body.getReader();
      await reader.read();

      mkdirSync(join(root, "linkfarm/new-dir"));
      writeFileSync(join(root, "linkfarm/new-dir/immediate.txt"), "x\n");
      expect(
        await readEvent(reader, (e) => e.changed.includes("linkfarm/new-dir/immediate.txt")),
      ).not.toBeNull();
      await Bun.sleep(50);
      writeFileSync(join(root, "linkfarm/new-dir/delayed.txt"), "x\n");
      expect(
        await readEvent(reader, (e) => e.changed.includes("linkfarm/new-dir/delayed.txt")),
      ).not.toBeNull();

      writeFileSync(join(root, "linkfarm/target.txt"), "before\n");
      await readEvent(reader, (e) => e.changed.includes("linkfarm/target.txt"));
      writeFileSync(join(root, "linkfarm/.tmp"), "after\n");
      renameSync(join(root, "linkfarm/.tmp"), join(root, "linkfarm/target.txt"));
      expect(
        await readEvent(reader, (e) => e.changed.includes("linkfarm/target.txt")),
      ).not.toBeNull();

      mkdirSync(join(root, "live"));
      writeFileSync(join(root, "live/old.txt"), "old\n");
      await readEvent(reader, (e) => e.changed.includes("live/old.txt"));
      mkdirSync(join(outside, "staging"));
      writeFileSync(join(outside, "staging/new.txt"), "before\n");
      renameSync(join(root, "live"), join(root, "old-live"));
      renameSync(join(outside, "staging"), join(root, "live"));
      await readEvent(reader, (e) => e.changed.includes("live"));
      appendFileSync(join(root, "live/new.txt"), "after\n");
      expect(await readEvent(reader, (e) => e.changed.includes("live/new.txt"))).not.toBeNull();
    } finally {
      await reader?.cancel().catch(() => {});
      await server.cleanup();
      rmSync(outside, { recursive: true, force: true });
    }
  }, 20_000);

  test("native callback filters metadata and handles unnamed events, errors, and close", async () => {
    const root = makeFixtureRepo();
    let callback;
    let options;
    let closed = false;
    const watcher = new EventEmitter();
    watcher.close = () => {
      closed = true;
    };
    const watchFactory = (_root, watchOptions, listener) => {
      options = watchOptions;
      callback = listener;
      return watcher;
    };
    const messages = [];
    const originalError = console.error;
    console.error = (message) => messages.push(message);
    let runtime;
    const frames = [];
    try {
      runtime = await createProjectRuntime(root, { path: root }, watchFactory);
      await runtime.ready;
      runtime.addClient({ enqueue: (frame) => frames.push(frame), close: () => {} });
      expect(options.recursive).toBe(true);
      expect(typeof options.ignore).toBe("function");
      expect(options.ignore(".git/objects/abc")).toBe(true);

      callback("change", "README.md");
      callback("rename", ".git/HEAD");
      callback("change", ".git/refs/heads/main");
      callback("change", ".git/index");
      callback("change", ".git/objects/abc");
      callback("change", "ignored-dir/junk.txt");
      callback("change", undefined);
      callback("change", null);
      await Bun.sleep(260);
      const event = JSON.parse(frames.find((frame) => frame.startsWith("data: ")).slice(6));
      expect(event).toEqual({ changed: ["README.md", ""], git: true });

      for (let i = 0; i < 5; i++)
        watcher.emit("error", Object.assign(new Error("limit"), { code: "ENOSPC" }));
      expect(
        messages.filter((message) => message.includes("fs.inotify.max_user_watches")),
      ).toHaveLength(3);
      expect(messages.some((message) => message.includes("suppressed"))).toBe(true);
      const before = frames.length;
      await runtime.close();
      expect(closed).toBe(true);
      callback("change", "README.md");
      await Bun.sleep(260);
      expect(frames).toHaveLength(before);
    } finally {
      console.error = originalError;
      await runtime?.close();
      rmSync(root, { recursive: true, force: true });
      rmSync(`${root}-outside`, { recursive: true, force: true });
    }
  });

  test("a synchronous watch limit failure logs and leaves the project readable", async () => {
    const root = makeFixtureRepo();
    const messages = [];
    const originalError = console.error;
    console.error = (message) => messages.push(message);
    let runtime;
    try {
      runtime = await createProjectRuntime(root, { path: root }, () => {
        throw Object.assign(new Error("watch limit"), { code: "ENOSPC" });
      });
      await runtime.ready;
      expect(runtime.closed).toBe(false);
      expect(messages.some((message) => message.includes("fs.inotify.max_user_watches"))).toBe(
        true,
      );
      await runtime.close();
      expect(runtime.closed).toBe(true);
    } finally {
      console.error = originalError;
      await runtime?.close();
      rmSync(root, { recursive: true, force: true });
      rmSync(`${root}-outside`, { recursive: true, force: true });
    }
  });
});
