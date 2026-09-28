// Cache validation for the prebuilt client (issue #45). dist/ is immutable for
// a given build, so a browser must revalidate on every load and transfer a body
// only when the file actually changed — without an ETag it applies heuristic
// caching and can run a stale client bundle against a new server.
import { afterAll, describe, expect, test } from "bun:test";
import { makePlainDir, startFixtureServer } from "../fixture.js";

const cleanups = [];
afterAll(async () => {
  for (const c of cleanups.reverse()) await c();
});

describe("prebuilt client cache validation (#45)", () => {
  test("/, /app.js and /style.css carry ETag + no-cache and 304 on If-None-Match", async () => {
    const s = await startFixtureServer(makePlainDir(), 7571, { budget: 64 });
    cleanups.push(s.cleanup);

    // A checkout resolves a versioned tag (`v1.1.0-dev.<stamp>`); the ETag must
    // carry it so that a rebuild always invalidates every cached copy.
    const versionToken = String(s.version).split(/[\s(]/)[0];
    expect(versionToken).toStartWith("v");

    const etags = new Map();
    for (const [path, type] of [
      ["/", "text/html"],
      ["/app.js", "javascript"],
      ["/style.css", "text/css"],
    ]) {
      const response = await fetch(s.origin + path);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-cache");
      expect(response.headers.get("content-type")).toContain(type);
      const etag = response.headers.get("etag");
      expect(etag).toContain(versionToken);
      expect((await response.text()).length).toBeGreaterThan(0);
      etags.set(path, etag);

      const revalidated = await fetch(s.origin + path, {
        headers: { "If-None-Match": etag },
      });
      expect(revalidated.status).toBe(304);
      expect(revalidated.headers.get("etag")).toBe(etag);
      expect(revalidated.headers.get("cache-control")).toBe("no-cache");
      expect(await revalidated.text()).toBe("");
    }
    // Content-derived tags: distinct assets must not share one tag.
    expect(new Set(etags.values()).size).toBe(etags.size);
  });

  test("the project page serves the same validating index.html", async () => {
    const s = await startFixtureServer(makePlainDir(), 7572, { budget: 64 });
    cleanups.push(s.cleanup);

    const page = await fetch(`${s.base}/`);
    expect(page.status).toBe(200);
    const etag = page.headers.get("etag");
    expect(page.headers.get("cache-control")).toBe("no-cache");
    expect(etag).toBe((await fetch(`${s.origin}/`)).headers.get("etag"));

    const revalidated = await fetch(`${s.base}/`, { headers: { "If-None-Match": etag } });
    expect(revalidated.status).toBe(304);
    expect(await revalidated.text()).toBe("");
  });
});
