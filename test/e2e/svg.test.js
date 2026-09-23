import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { launchBrowser, startFixtureServer } from "../fixture.js";

const svg = (width) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="24" viewBox="0 0 ${width} 24">
  <rect width="${width}" height="24" fill="#89b4fa"/>
</svg>\n`;
const rgb = (hex) =>
  `rgb(${[1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)).join(", ")})`;

function git(cwd, ...args) {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

test("SVG renders safely, toggles to marked source, and refreshes after an edit", async () => {
  const root = mkdtempSync(join(tmpdir(), "peruse-svg-e2e-"));
  const changedPath = join(root, "changed.svg");
  writeFileSync(changedPath, svg(24));
  git(root, "init", "-q");
  git(root, "config", "user.email", "t@e.st");
  git(root, "config", "user.name", "Test");
  git(root, "add", "changed.svg");
  git(root, "commit", "-qm", "baseline");
  writeFileSync(changedPath, svg(32));
  writeFileSync(
    join(root, "hostile.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><script>console.log("SVG_SCRIPT_RAN");alert("SVG_SCRIPT_RAN")</script><image href="payload.png"/><rect width="16" height="16"/></svg>',
  );

  let server, browser;
  try {
    server = await startFixtureServer(root, 0, { portFixed: true });
    browser = await launchBrowser();
    const page = await browser.newPage();
    const scriptMessages = [];
    const externalRequests = [];
    page.on("console", (message) => {
      if (message.text().includes("SVG_SCRIPT_RAN")) scriptMessages.push(message.text());
    });
    page.on("request", (request) => {
      if (request.url().endsWith("/raw/payload.png")) externalRequests.push(request.url());
    });
    page.on("dialog", (dialog) => {
      scriptMessages.push(dialog.message());
      void dialog.dismiss();
    });

    await page.goto(`${server.base}/#/changed.svg`);
    const image = page.locator("#viewer .image-view img");
    await image.waitFor({ timeout: 8_000 });
    await page.waitForFunction(() => document.querySelector("#viewer img")?.naturalWidth === 32);
    expect(await page.locator("#viewer .shiki").count()).toBe(0);
    expect(await page.locator("#viewer svg").count()).toBe(0);
    expect(new URL(await image.getAttribute("src"), server.origin).pathname).toBe(
      `${new URL(server.base).pathname}/raw/changed.svg`,
    );
    const mime = await page.evaluate(async () =>
      (await fetch(document.querySelector("#viewer img").src)).headers.get("content-type"),
    );
    expect(mime).toContain("image/svg+xml");
    expect(await page.locator("#pane-header .chip-group span").innerText()).toContain("change");
    expect(await page.locator("#pane-header .chip-arrow").first().isVisible()).toBe(false);

    const backgrounds = [];
    for (let i = 0; i < 2; i++) {
      backgrounds.push(
        await page.locator(".image-view").evaluate((element) => ({
          theme: document.documentElement.dataset.theme,
          gradient: getComputedStyle(element).backgroundImage,
          latte: getComputedStyle(document.documentElement)
            .getPropertyValue("--ctp-latte-base")
            .trim(),
          mocha: getComputedStyle(document.documentElement)
            .getPropertyValue("--ctp-mocha-base")
            .trim(),
        })),
      );
      await page.locator(".theme-btn").click();
    }
    expect(backgrounds.map(({ theme }) => theme).sort()).toEqual(["latte", "mocha"]);
    for (const { gradient, latte, mocha } of backgrounds) {
      expect(gradient).toContain(rgb(latte));
      expect(gradient).toContain(rgb(mocha));
    }

    await page.getByRole("button", { name: "Source" }).click();
    await page.locator("#viewer .shiki .line").first().waitFor();
    expect(await page.locator("#viewer .image-view").count()).toBe(0);
    expect(await page.locator("#viewer .line.hl-mod").count()).toBeGreaterThan(0);
    expect(await page.locator("#pane-header .chip-arrow").first().isVisible()).toBe(true);
    await page.locator("#viewer .line[data-hunk]").first().click();
    expect(await page.locator("#viewer .hunk-popup").count()).toBe(1);
    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      window.__svgCopied = null;
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: async (value) => (window.__svgCopied = value) },
      });
    });
    await page.locator(".copy-raw").click();
    expect(await page.evaluate(() => window.__svgCopied)).toBe(svg(32));
    writeFileSync(changedPath, svg(40));
    await page.waitForFunction(() =>
      document.querySelector("#viewer .shiki")?.textContent?.includes('width="40"'),
    );
    await page.getByRole("button", { name: "Rendered" }).click();
    await image.waitFor();
    await page.waitForFunction(() => document.querySelector("#viewer img")?.naturalWidth === 40);
    const before = await image.getAttribute("src");
    writeFileSync(changedPath, svg(48)); // same byte count as width 32
    await page.waitForFunction(() => document.querySelector("#viewer img")?.naturalWidth === 48);
    expect(await image.getAttribute("src")).not.toBe(before);

    await page.goto(`${server.base}/#/hostile.svg`);
    await page.waitForFunction(() => document.querySelector("#viewer img")?.naturalWidth === 16);
    expect(await page.locator("#viewer svg, #viewer script").count()).toBe(0);
    expect(scriptMessages).toEqual([]);
    expect(externalRequests).toEqual([]);
  } finally {
    await browser?.close();
    await server?.cleanup();
  }
}, 30_000);
