import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startServer } from "../../server/index.js";
import { launchBrowser } from "../fixture.js";

// Run in its own `bun test` process in package.json. The shared fixture documents
// why cycling several Playwright browsers in one Bun process is unstable.
const T = 60_000;

function git(root, ...args) {
  const result = Bun.spawnSync(["git", "--no-optional-locks", ...args], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0)
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
  return result.stdout.toString().trim();
}

test(
  "shows exact branch state for a feature branch ahead of main (#15)",
  async () => {
    const featureBranch =
      "feature/über/東京/this-is-a-deliberately-extremely-long-branch-name-for-layout";
    const featureLabel = `${featureBranch} · 1 ahead`;
    const root = mkdtempSync(join(tmpdir(), "peruse-branch-e2e-"));
    writeFileSync(join(root, "README.md"), "# Branch fixture\n");
    git(root, "init", "-q");
    git(root, "config", "user.email", "t@e.st");
    git(root, "config", "user.name", "Test");
    git(root, "add", "README.md");
    git(root, "commit", "-qm", "baseline");
    git(root, "branch", "-M", "main");
    git(root, "switch", "-qc", featureBranch);
    writeFileSync(join(root, "feature.txt"), "feature commit\n");
    git(root, "add", "feature.txt");
    git(root, "commit", "-qm", "feature");

    let server, browser;
    try {
      server = await startServer({
        root,
        port: 0,
        host: "127.0.0.1",
        portFixed: true,
        watchBudget: 100,
      });
      browser = await launchBrowser();
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await page.goto(`http://127.0.0.1:${server.port}/p/project/`);
      await page.waitForSelector("#tree .row");

      expect(await page.locator(".branch-state").count()).toBe(1);
      expect(await page.locator(".branch-state").innerText()).toBe(featureLabel);

      const responsive = new Map();
      for (const width of [1280, 760, 500, 400, 320]) {
        await page.setViewportSize({ width, height: 800 });
        const geometry = await page.locator(".branch-state").evaluate((badge) => ({
          visible: getComputedStyle(badge).display !== "none",
          width: badge.getBoundingClientRect().width,
          clientWidth: badge.clientWidth,
          scrollWidth: badge.scrollWidth,
          textOverflow: getComputedStyle(badge).textOverflow,
          title: badge.getAttribute("title"),
          ariaLabel: badge.getAttribute("aria-label"),
          documentWidth: document.documentElement.scrollWidth,
        }));
        responsive.set(width, geometry);
      }
      expect(responsive.get(400).documentWidth).toBe(400);
      for (const [width, geometry] of responsive) {
        expect(geometry.documentWidth).toBe(width);
        if (width >= 500) {
          expect(geometry.visible).toBe(true);
          expect(geometry.width).toBeGreaterThanOrEqual(112);
          expect(geometry.scrollWidth).toBeGreaterThan(geometry.clientWidth);
          expect(geometry.textOverflow).toBe("ellipsis");
          expect(geometry.title).toBe(featureLabel);
          expect(geometry.ariaLabel).toBe(featureLabel);
        } else {
          expect(geometry.visible).toBe(false);
        }
      }
      await page.setViewportSize({ width: 1280, height: 800 });

      git(root, "switch", "-q", "main");
      await page.waitForFunction(
        () => document.querySelector(".branch-state")?.textContent === "main",
        null,
        { timeout: 8_000 },
      );
      expect(await page.locator(".branch-state").innerText()).toBe("main");

      const detached = git(root, "rev-parse", "--short", "HEAD");
      git(root, "switch", "-qd", "HEAD");
      await page.waitForFunction(
        (text) => document.querySelector(".branch-state")?.textContent === text,
        `@ ${detached}`,
        { timeout: 8_000 },
      );
      expect(await page.locator(".branch-state").innerText()).toBe(`@ ${detached}`);

      git(root, "switch", "-q", featureBranch);
      await page.waitForFunction(
        (label) => document.querySelector(".branch-state")?.textContent === label,
        featureLabel,
        { timeout: 8_000 },
      );
      writeFileSync(join(root, "second.txt"), "second feature commit\n");
      git(root, "add", "second.txt");
      git(root, "commit", "-qm", "second feature");
      await page.waitForFunction(
        (label) => document.querySelector(".branch-state")?.textContent === label,
        `${featureBranch} · 2 ahead`,
        { timeout: 8_000 },
      );
      expect(await page.locator(".branch-state").innerText()).toBe(`${featureBranch} · 2 ahead`);
    } finally {
      await browser?.close();
      await server?.stop();
      rmSync(root, { recursive: true, force: true });
    }
  },
  T,
);
