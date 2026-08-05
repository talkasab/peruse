import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newestFileMtime } from "../../server/index.js";

describe("checkout client freshness", () => {
  test("a nested web source participates in the newest-mtime decision", () => {
    const root = mkdtempSync(join(tmpdir(), "peruse-freshness-"));
    try {
      mkdirSync(join(root, "langs"));
      const top = join(root, "app.js");
      const nested = join(root, "langs/mdsvex.js");
      writeFileSync(top, "top\n");
      writeFileSync(nested, "nested\n");
      utimesSync(top, 1000, 1000);
      utimesSync(nested, 2000, 2000);

      expect(newestFileMtime(root)).toBe(2_000_000);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
