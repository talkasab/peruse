import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeFixtureRepo, startFixtureServer } from "../fixture.js";

let srv, root;
beforeAll(async () => {
  root = makeFixtureRepo();
  srv = await startFixtureServer(root, 7531);
  await srv.ready; // wait for the real signal (chokidar's initial scan), not a guessed sleep
});
afterAll(async () => {
  await srv?.cleanup();
});

// Read SSE events from a fresh connection until predicate matches or timeout.
// `never`, if given, is checked against every event seen (including the one
// that satisfies `predicate`) and fails fast — used to pair a negative
// assertion with a positive control so the test can't pass by having missed
// everything.
async function nextEvent(predicate, { timeout = 4000, act, never } = {}) {
  const res = await fetch(`${srv.base}/api/events`);
  const reader = res.body.getReader();
  // act() runs (and, for a synchronous git commit, can block for a bit)
  // before the deadline is set, so it isn't silently eating the timeout.
  act?.();
  const deadline = Date.now() + timeout;
  let buf = "";
  try {
    while (Date.now() < deadline) {
      const { value, done } = await Promise.race([
        reader.read(),
        new Promise((r) => setTimeout(() => r({ timedOut: true }), deadline - Date.now())),
      ]);
      if (value?.timedOut || done) break;
      buf += new TextDecoder().decode(value);
      // Only complete (newline-terminated) lines are parseable JSON — a
      // chunk boundary can split "data: {...}" mid-frame; keep the trailing
      // (possibly incomplete) segment buffered for the next read.
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines)
        if (line.startsWith("data: ")) {
          const ev = JSON.parse(line.slice(6));
          if (never?.(ev)) throw new Error(`unexpected event: ${JSON.stringify(ev)}`);
          if (predicate(ev)) return ev;
        }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
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

  // Commits all pending worktree edits (src/util.py, docs/guide.md go from
  // M to clean) — the two tests that follow only look at file paths, not
  // git status, so this doesn't disturb their assertions; be wary of that
  // if adding a status-sensitive test after this one.
  test("a commit surfaces as git:true, not as file events", async () => {
    const ev = await nextEvent((e) => e.git === true, {
      act: () => Bun.spawnSync(["git", "commit", "-aqm", "wip"], { cwd: root }),
    });
    expect(ev).not.toBeNull();
    expect(ev.changed.some((p) => p.startsWith(".git"))).toBe(false);
  });

  test("changes inside gitignored dirs emit nothing, while a sibling change still does (incident 97ef45d)", async () => {
    // Positive control: without a change that's guaranteed to be reported,
    // this test could pass merely because it waited too little / too much —
    // it must observe the control's event while never seeing ignored-dir.
    const ev = await nextEvent((e) => e.changed.includes("control-not-ignored.txt"), {
      timeout: 1200,
      act: () => {
        writeFileSync(join(root, "ignored-dir/more.txt"), "x\n");
        writeFileSync(join(root, "control-not-ignored.txt"), "x\n");
      },
      never: (e) => e.changed.some((p) => p.startsWith("ignored-dir")),
    });
    expect(ev).not.toBeNull();
  });

  test("idle SSE connections survive past 10 s (incident 3087c19: Bun idleTimeout)", async () => {
    const res = await fetch(`${srv.base}/api/events`);
    const reader = res.body.getReader();
    const first = await reader.read(); // retry preamble
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
