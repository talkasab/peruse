// A silent SSE refresh always re-requests the CURRENTLY loaded path. When one
// lands while the user is navigating away, the old path must not be re-rendered
// or written back to location.hash. This raced in the shared-page core journeys
// (#26): a link click was undone in roughly a quarter of runs.
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
  "a silent refresh landing mid-navigation does not undo it",
  async () => {
    const root = mkdtempSync(join(tmpdir(), "peruse-nav-e2e-"));
    mkdirSync(join(root, "docs"));
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "docs", "guide.md"), "# Guide\n\nSome prose.\n");
    writeFileSync(join(root, "src", "util.py"), "def load(path):\n    return path\n");

    let srv, browser;
    const pageErrors = [];
    try {
      srv = await startServer({
        root,
        port: 0,
        host: "127.0.0.1",
        portFixed: true,
      });
      browser = await launchBrowser();
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.goto(`http://127.0.0.1:${srv.port}/p/project/#/docs/guide.md`);
      await page.waitForFunction(
        () => document.querySelector("#pane-header .path")?.textContent === "docs/guide.md",
      );

      // Start a silent refresh of the current file, then navigate away before it
      // can settle — the refresh resolves last and would otherwise win.
      await page.evaluate(() => {
        const data = window.Alpine.$data(document.body);
        data.selectFile("docs/guide.md", { preserve: true });
        location.hash = "#/src/util.py";
      });
      await page.waitForFunction(
        () => document.querySelector("#pane-header .path")?.textContent === "src/util.py",
      );
      await page.waitForTimeout(1_000); // let the losing refresh resolve

      expect(await page.evaluate(() => location.hash)).toBe("#/src/util.py");
      expect(
        await page.evaluate(() => document.querySelector("#pane-header .path")?.textContent),
      ).toBe("src/util.py");
      expect(pageErrors).toEqual([]);
    } finally {
      await browser?.close();
      await srv?.stop();
      rmSync(root, { recursive: true, force: true });
    }
  },
  T,
);

// #46: link interception treated the binary card's Download chip as an in-app
// link, cancelling the click and rewriting location.hash. Only that chip is
// exempt: a `download` anchor authored in Markdown still opens in the viewer.
test(
  "the binary card's Download chip downloads; authored download links stay in the viewer",
  async () => {
    const root = mkdtempSync(join(tmpdir(), "peruse-download-e2e-"));
    const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x08, 0x00]);
    mkdirSync(join(root, "assets"));
    writeFileSync(join(root, "assets", "blob.bin"), bytes);
    writeFileSync(join(root, "page.md"), '# Page\n\n<a href="other.md" download>other</a>\n');
    writeFileSync(join(root, "other.md"), "# Other\n");

    let srv, browser;
    const pageErrors = [];
    const downloads = [];
    try {
      srv = await startServer({
        root,
        port: 0,
        host: "127.0.0.1",
        portFixed: true,
      });
      browser = await launchBrowser();
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      page.on("pageerror", (error) => pageErrors.push(error.message));
      page.on("download", (download) => downloads.push(download));
      await page.goto(`http://127.0.0.1:${srv.port}/p/project/#/assets/blob.bin`);
      await page.waitForSelector("#viewer .file-card .chip[download]");

      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 10_000 }),
        page.click("#viewer .file-card .chip[download]"),
      ]);
      expect(download.suggestedFilename()).toBe("blob.bin");
      expect(readFileSync(await download.path())).toEqual(bytes);
      expect(await page.evaluate(() => location.hash)).toBe("#/assets/blob.bin");

      await page.evaluate(() => {
        location.hash = "#/page.md";
      });
      await page.waitForSelector('#viewer a[href="other.md"][download]');
      await page.click('#viewer a[href="other.md"]');
      await page.waitForFunction(
        () => document.querySelector("#pane-header .path")?.textContent === "other.md",
      );
      await page.waitForTimeout(500); // a download would have been announced by now
      expect(downloads.length).toBe(1);
      expect(pageErrors).toEqual([]);
    } finally {
      await browser?.close();
      await srv?.stop();
      rmSync(root, { recursive: true, force: true });
    }
  },
  T,
);
