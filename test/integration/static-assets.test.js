// Cache validation for the prebuilt client (#45). Without a validator a browser
// re-downloads the whole bundle on every load, or reuses a copy it cannot
// check; with one it revalidates each load and transfers only what changed.
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { clientAsset } from "../../server/index.js";
import { makePlainDir, startFixtureServer } from "../fixture.js";

test("the client page and assets revalidate with an ETag", async () => {
  const server = await startFixtureServer(makePlainDir(), 0, { portFixed: true });
  try {
    const etags = new Set();
    for (const url of [
      `${server.origin}/`,
      `${server.origin}/app.js`,
      `${server.origin}/style.css`,
      `${server.base}/`,
    ]) {
      const first = await fetch(url);
      expect(first.status).toBe(200);
      expect(first.headers.get("cache-control")).toBe("no-cache");
      const etag = first.headers.get("etag");
      expect(etag).toMatch(/^"[\x21\x23-\x7e]+"$/);
      expect((await first.text()).length).toBeGreaterThan(0);
      etags.add(etag);

      for (const validator of [etag, `W/${etag}`, `"other", ${etag}`, "*"]) {
        const again = await fetch(url, { headers: { "If-None-Match": validator } });
        expect(again.status).toBe(304);
        expect(again.headers.get("etag")).toBe(etag);
        expect(again.headers.get("cache-control")).toBe("no-cache");
        expect(await again.text()).toBe("");
      }

      const head = await fetch(url, { method: "HEAD", headers: { "If-None-Match": etag } });
      expect(head.status).toBe(304);

      const stale = await fetch(url, { headers: { "If-None-Match": '"other", "older"' } });
      expect(stale.status).toBe(200);
      // 304 answers only safe retrievals.
      const posted = await fetch(url, { method: "POST", headers: { "If-None-Match": etag } });
      expect(posted.status).not.toBe(304);
    }
    // `/` and the project page are the same file; the other two differ.
    expect(etags.size).toBe(3);

    // Paths that cannot be stat'ed are ordinary misses, not server errors.
    for (const path of ["/app.js/x", `/${"a".repeat(300)}`, "/missing.js"]) {
      const miss = await fetch(server.origin + path);
      expect(miss.status).toBe(404);
      expect(await miss.text()).toBe("not found");
    }
  } finally {
    await server.cleanup();
  }
});

test("a rebuilt or upgraded client never revalidates as unchanged", async () => {
  const dir = mkdtempSync(join(tmpdir(), "peruse-client-"));
  try {
    const file = join(dir, "app.js");
    const get = new Request("http://peruse.test/app.js");
    const etagOf = (version = "v1.0.0") => clientAsset(file, get, version)?.headers.get("etag");
    expect(clientAsset(file, get, "v1.0.0")).toBeNull();

    writeFileSync(file, "one");
    const original = etagOf();
    expect(etagOf()).toBe(original);

    // A rebuild under the running server, isolated to each thing the tag reads:
    // new size at the same mtime, then the same size at a later mtime.
    const written = new Date(1_700_000_000_000);
    utimesSync(file, written, written);
    const dated = etagOf();
    writeFileSync(file, "three");
    utimesSync(file, written, written);
    const resized = etagOf();
    expect(resized).not.toBe(dated);

    const later = new Date(written.getTime() + 5_000);
    utimesSync(file, later, later);
    const touched = etagOf();
    expect(touched).not.toBe(resized);

    // Package files can share size and mtime across installs; the version differs.
    expect(etagOf("v1.0.1")).not.toBe(touched);

    const revalidated = clientAsset(
      file,
      new Request(get.url, { headers: { "If-None-Match": original } }),
      "v1.0.0",
    );
    expect(revalidated?.status).toBe(200);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
