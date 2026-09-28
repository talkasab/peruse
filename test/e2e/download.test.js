// #46: the Download chip on a binary file's card (<a class="chip" … download>
// pointing at /raw/<path>) must reach the browser's own download action. The
// viewer's click handler used to route it through interceptLink, which treated
// the in-app href as an internal link, cancelled the click and rewrote
// location.hash — so no download ever started.
// Deliberately self-contained — its own minimal tree, server and page — so it
// neither shares state with the core journeys nor competes with their fixture.
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startServer } from "../../server/index.js";
import { launchBrowser } from "../fixture.js";

const T = 60_000;

test(
  "the binary file card's Download chip starts a real download",
  async () => {
    const root = mkdtempSync(join(tmpdir(), "peruse-download-e2e-"));
    // A NUL byte makes the server classify the file as binary (file card view).
    const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x08, 0x00]);
    mkdirSync(join(root, "assets"));
    writeFileSync(join(root, "assets", "blob.bin"), bytes);

    let srv, browser;
    const pageErrors = [];
    try {
      srv = await startServer({
        root,
        port: 0,
        host: "127.0.0.1",
        portFixed: true,
        watchBudget: 100,
      });
      browser = await launchBrowser();
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.goto(`http://127.0.0.1:${srv.port}/p/project/#/assets/blob.bin`);
      await page.waitForSelector("#viewer .file-card .chip[download]");

      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.click("#viewer .file-card .chip[download]"),
      ]);

      expect(download.suggestedFilename()).toBe("blob.bin");
      expect(readFileSync(await download.path())).toEqual(bytes);
      // The chip click must not be swallowed as an in-app navigation either.
      expect(await page.evaluate(() => location.hash)).toBe("#/assets/blob.bin");
      expect(pageErrors).toEqual([]);
    } finally {
      await browser?.close();
      await srv?.stop();
      rmSync(root, { recursive: true, force: true });
    }
  },
  T,
);
