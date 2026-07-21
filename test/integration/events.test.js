import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeFixtureRepo, startFixtureServer } from "../fixture.js";

let srv, root;
beforeAll(async () => {
  root = makeFixtureRepo();
  srv = await startFixtureServer(root, 7531);
  await new Promise((r) => setTimeout(r, 700)); // let the initial scan settle
});
afterAll(async () => { await srv?.cleanup(); });

// Read SSE events from a fresh connection until predicate matches or timeout.
async function nextEvent(predicate, { timeout = 4000, act } = {}) {
  const res = await fetch(`${srv.base}/api/events`);
  const reader = res.body.getReader();
  const deadline = Date.now() + timeout;
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
      for (const line of buf.split("\n"))
        if (line.startsWith("data: ")) {
          const ev = JSON.parse(line.slice(6));
          if (predicate(ev)) return ev;
        }
    }
  } finally { reader.cancel().catch(() => {}); }
  return null;
}

describe("SSE change stream", () => {
  test("file change produces a coalesced event naming the path", async () => {
    const ev = await nextEvent((e) => e.changed.includes("README.md"), {
      act: () => appendFileSync(join(root, "README.md"), "\nmore\n"),
    });
    expect(ev).not.toBeNull();
  });

  test("rapid writes coalesce into one batch", async () => {
    const ev = await nextEvent((e) => e.changed.includes("src/util.py"), {
      act: () => {
        appendFileSync(join(root, "src/util.py"), "# a\n");
        appendFileSync(join(root, "README.md"), "b\n");
      },
    });
    expect(ev.changed).toContain("README.md"); // both in the same 200ms batch
  });

  test("a commit surfaces as git:true, not as file events", async () => {
    const ev = await nextEvent((e) => e.git === true, {
      act: () => Bun.spawnSync(["git", "commit", "-aqm", "wip"], { cwd: root }),
    });
    expect(ev).not.toBeNull();
    expect(ev.changed.some((p) => p.startsWith(".git"))).toBe(false);
  });

  test("changes inside gitignored dirs emit nothing (incident 97ef45d)", async () => {
    const ev = await nextEvent((e) => e.changed.some((p) => p.startsWith("ignored-dir")), {
      timeout: 1200,
      act: () => writeFileSync(join(root, "ignored-dir/more.txt"), "x\n"),
    });
    expect(ev).toBeNull();
  });

  test("idle SSE connections survive past 10 s (incident 3087c19: Bun idleTimeout)", async () => {
    const res = await fetch(`${srv.base}/api/events`);
    const reader = res.body.getReader();
    const first = await reader.read();            // retry preamble
    expect(first.done).toBe(false);
    await new Promise((r) => setTimeout(r, 11_500));
    // connection must still be writable/open: a change must still reach us
    const got = await Promise.race([
      (async () => {
        appendFileSync(join(root, "README.md"), "still-alive\n");
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return "closed";
          if (new TextDecoder().decode(value).includes("README.md")) return "event";
        }
      })(),
      new Promise((r) => setTimeout(() => r("timeout"), 4000)),
    ]);
    reader.cancel().catch(() => {});
    expect(got).toBe("event");
  }, 20_000);
});
