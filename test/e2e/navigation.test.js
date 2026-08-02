// A silent SSE refresh always re-requests the CURRENTLY loaded path. When one
// lands while the user is navigating away, the old path must not be re-rendered
// or written back to location.hash. This raced in the shared-page core journeys
// (#26): a link click was undone in roughly a quarter of runs.
// Deliberately self-contained — its own minimal tree, server and page — so it
// neither shares state with the core journeys nor competes with their fixture.
import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { startServer } from "../../server/index.js";

const T = 60_000;

test("a silent refresh landing mid-navigation does not undo it", async () => {
  const root = mkdtempSync(join(tmpdir(), "peruse-nav-e2e-"));
  mkdirSync(join(root, "docs"));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "docs", "guide.md"), "# Guide\n\nSome prose.\n");
  writeFileSync(join(root, "src", "util.py"), "def load(path):\n    return path\n");

  let srv, browser;
  const pageErrors = [];
  try {
    srv = await startServer({
      root, port: 0, host: "127.0.0.1", portFixed: true, watchBudget: 100,
    });
    await srv.ready;
    browser = await chromium.launch({
      executablePath: process.env.PERUSE_CHROMIUM || undefined,
      args: ["--no-sandbox"],
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(`http://127.0.0.1:${srv.port}/#/docs/guide.md`);
    await page.waitForFunction(() =>
      document.querySelector("#pane-header .path")?.textContent === "docs/guide.md");

    // Start a silent refresh of the current file, then navigate away before it
    // can settle — the refresh resolves last and would otherwise win.
    await page.evaluate(() => {
      const data = window.Alpine.$data(document.body);
      data.selectFile("docs/guide.md", { preserve: true });
      location.hash = "#/src/util.py";
    });
    await page.waitForFunction(() =>
      document.querySelector("#pane-header .path")?.textContent === "src/util.py");
    await page.waitForTimeout(1_000); // let the losing refresh resolve

    expect(await page.evaluate(() => location.hash)).toBe("#/src/util.py");
    expect(await page.evaluate(() =>
      document.querySelector("#pane-header .path")?.textContent)).toBe("src/util.py");
    expect(pageErrors).toEqual([]);
  } finally {
    await browser?.close();
    await srv?.stop();
    rmSync(root, { recursive: true, force: true });
  }
}, T);
