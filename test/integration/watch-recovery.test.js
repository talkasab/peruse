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
import { removeProject } from "../../server/projects.js";
import { makeFixtureRepo, startFixtureServer } from "../fixture.js";

// Issue #17: a symlink whose realpath() fails with an errno outside chokidar's
// survivable set (ENOTDIR here — a link pointing *through* a regular file)
// destroys the listing of its directory. Before the recovery, that both left
// the directory silently unwatched and left chokidar's 'ready' pending
// forever, which — since the first request for a project awaits it — meant the
// project served nothing at all. Every assertion here races a timeout so a
// regression fails the test instead of hanging the suite.
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
  test("closing a stalled runtime settles its waiting request without an unhandled rejection", async () => {
    const closingRoot = makeFixtureRepo();
    symlinkSync(join(closingRoot, "README.md", "nope"), join(closingRoot, "linkfarm/close-poison"));
    const closing = await startFixtureServer(closingRoot, 7535);
    const unhandled = [];
    const onUnhandled = (reason) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const request = fetch(`${closing.base}/api/tree`).then(
        (response) => ({ status: response.status }),
        (error) => ({ error }),
      );
      await Bun.sleep(300);
      expect(removeProject(closing.project.name, closing.configFile)).toBe(1);

      const invalidatedAt = performance.now();
      const listing = await withTimeout(
        fetch(`${closing.origin}/api/projects`).then((response) => response.status),
        1000,
        "hung",
      );
      expect(listing).toBe(200);
      const result = await withTimeout(request, 1000, "hung");
      expect(result).not.toBe("hung");
      expect(result.status).toBe(404);
      expect(performance.now() - invalidatedAt).toBeLessThan(1000);
      await Bun.sleep(0);
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      await closing.cleanup();
    }
  });

  test("the project still serves — the stalled scan does not hang requests", async () => {
    const status = await withTimeout(
      fetch(`${srv.base}/api/tree`).then((r) => r.status),
      15_000,
      "hung",
    );
    expect(status).toBe(200);
  }, 20_000);

  test("changes in the stranded directory still reach clients", async () => {
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

  test("a subdirectory created in the stranded directory becomes watched too", async () => {
    const made = await nextEvent((e) => e.changed.includes("linkfarm/fresh"), {
      act: () => mkdirSync(join(root, "linkfarm/fresh")),
    });
    expect(made).not.toBeNull();
    // fs.watch is not recursive, so the new directory only stays live because
    // recovery hands it to chokidar as it appears.
    const inside = await nextEvent((e) => e.changed.includes("linkfarm/fresh/inner.txt"), {
      act: () => writeFileSync(join(root, "linkfarm/fresh/inner.txt"), "x\n"),
    });
    expect(inside).not.toBeNull();
  }, 20_000);

  test("a poisoned directory moved in after recovery gains live coverage", async () => {
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

  test("a vanished recovered directory cannot crash later events", async () => {
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
