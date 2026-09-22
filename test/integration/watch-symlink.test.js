import { afterAll, beforeAll, describe, expect, test } from "bun:test";
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
import { makeFixtureRepo, startFixtureServer } from "../fixture.js";

// Bun watches siblings of an ENOTDIR symlink without a scan or fallback.
let srv, root, lateParent;
const withTimeout = (promise, ms, fallback) =>
  Promise.race([promise, new Promise((r) => setTimeout(() => r(fallback), ms))]);

beforeAll(async () => {
  root = makeFixtureRepo();
  writeFileSync(join(root, "linkfarm/target.txt"), "original\n");
  // Points through README.md, a regular file → realpath fails ENOTDIR.
  symlinkSync(join(root, "README.md", "nope"), join(root, "linkfarm/poison"));
  srv = await startFixtureServer(root, 7534);
});
afterAll(async () => {
  await srv?.cleanup();
  if (lateParent) rmSync(lateParent, { recursive: true, force: true });
});

// Reads SSE from a fresh connection until predicate matches or timeout.
async function nextEvent(predicate, { timeout = 8000, act } = {}) {
  const deadline = Date.now() + timeout;
  const res = await Promise.race([
    fetch(`${srv.base}/api/events`),
    new Promise((resolve) => setTimeout(() => resolve(null), Math.max(0, deadline - Date.now()))),
  ]);
  if (!res) return null;
  const reader = res.body.getReader();
  act?.();
  let buf = "";
  try {
    while (Date.now() < deadline) {
      const { value, done } = await Promise.race([
        reader.read(),
        new Promise((r) => setTimeout(() => r({ timedOut: true }), deadline - Date.now())),
      ]);
      if (value?.timedOut || done) break;
      buf += new TextDecoder().decode(value);
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines)
        if (line.startsWith("data: ")) {
          const ev = JSON.parse(line.slice(6));
          if (predicate(ev)) return ev;
        }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return null;
}

describe("a scan-breaking symlink (issue #17)", () => {
  test("the project still serves — a poisoned symlink does not delay requests", async () => {
    const status = await withTimeout(
      fetch(`${srv.base}/api/tree`).then((r) => r.status),
      15_000,
      "hung",
    );
    expect(status).toBe(200);
  }, 20_000);

  test("changes in the poisoned directory still reach clients", async () => {
    const ev = await nextEvent((e) => e.changed.some((p) => p === "linkfarm/live.txt"), {
      act: () => writeFileSync(join(root, "linkfarm/live.txt"), "brand new\n"),
    });
    expect(ev).not.toBeNull();
  }, 20_000);

  test("an atomic rename-over reports the replaced target", async () => {
    const ev = await nextEvent((e) => e.changed.includes("linkfarm/target.txt"), {
      act: () => {
        writeFileSync(join(root, "linkfarm/.target.tmp"), "replacement\n");
        renameSync(join(root, "linkfarm/.target.tmp"), join(root, "linkfarm/target.txt"));
      },
    });
    expect(ev).not.toBeNull();
    expect(ev.changed.filter((path) => path === "linkfarm/target.txt")).toHaveLength(1);
  }, 20_000);

  test("a subdirectory created in the poisoned directory becomes watched too", async () => {
    const made = await nextEvent((e) => e.changed.includes("linkfarm/fresh"), {
      act: () => mkdirSync(join(root, "linkfarm/fresh")),
    });
    expect(made).not.toBeNull();
    // The recursive native watcher picks up the new directory.
    const inside = await nextEvent((e) => e.changed.includes("linkfarm/fresh/inner.txt"), {
      act: () => writeFileSync(join(root, "linkfarm/fresh/inner.txt"), "x\n"),
    });
    expect(inside).not.toBeNull();
  }, 20_000);

  test("a poisoned directory moved in after startup gains live coverage", async () => {
    lateParent = mkdtempSync(join(tmpdir(), "peruse-late-poison-"));
    const source = join(lateParent, "late-poison");
    const destination = join(root, "linkfarm/late-poison");
    mkdirSync(source);
    writeFileSync(join(source, "base.txt"), "base\n");
    writeFileSync(join(source, "inside.txt"), "before\n");
    symlinkSync("base.txt/nope", join(source, "poison"));
    const moved = await nextEvent((e) => e.changed.includes("linkfarm/late-poison"), {
      act: () => renameSync(source, destination),
    });
    expect(moved).not.toBeNull();

    const inside = await nextEvent((e) => e.changed.includes("linkfarm/late-poison/inside.txt"), {
      act: () => appendFileSync(join(destination, "inside.txt"), "after\n"),
    });
    expect(inside).not.toBeNull();
  }, 20_000);

  test("a removed watched directory cannot crash later events", async () => {
    const removed = await nextEvent((e) => e.changed.includes("linkfarm/fresh"), {
      act: () => rmSync(join(root, "linkfarm/fresh"), { recursive: true, force: true }),
    });
    expect(removed).not.toBeNull();
    const sibling = await nextEvent((e) => e.changed.includes("README.md"), {
      act: () => appendFileSync(join(root, "README.md"), "still alive\n"),
    });
    expect(sibling).not.toBeNull();
  }, 20_000);

  test("changes elsewhere in the tree are unaffected", async () => {
    const ev = await nextEvent((e) => e.changed.includes("README.md"), {
      act: () => appendFileSync(join(root, "README.md"), "\nmore\n"),
    });
    expect(ev).not.toBeNull();
  }, 20_000);
});
