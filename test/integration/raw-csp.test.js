import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { makePlainDir, startFixtureServer } from "../fixture.js";

test("every raw file response carries a restrictive CSP", async () => {
  const root = makePlainDir();
  writeFileSync(
    join(root, "image.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>',
  );
  const server = await startFixtureServer(root, 0, { portFixed: true });
  try {
    for (const path of ["image.svg", "note.md"]) {
      const response = await fetch(`${server.base}/raw/${path}`);
      expect(response.status).toBe(200);
      const policy = response.headers.get("content-security-policy");
      expect(policy).toContain("sandbox");
      expect(policy).toContain("default-src 'none'");
    }
  } finally {
    await server.cleanup();
  }
});
