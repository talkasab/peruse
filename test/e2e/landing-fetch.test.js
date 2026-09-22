import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startServer } from "../../server/index.js";
import { registerProject, registryPath } from "../../server/projects.js";
import { launchBrowser } from "../fixture.js";
import { measureContrast } from "./contrast.js";

const T = 30_000;
let browser, server, emptyServer, projectDir, configDir, emptyConfigDir, project;

beforeAll(async () => {
  projectDir = mkdtempSync(join(tmpdir(), "peruse-landing-project-"));
  configDir = mkdtempSync(join(tmpdir(), "peruse-landing-config-"));
  emptyConfigDir = mkdtempSync(join(tmpdir(), "peruse-landing-empty-"));
  writeFileSync(join(projectDir, "README.md"), "# Landing fixture\n");
  project = registerProject(projectDir, { file: registryPath(configDir) });
  server = await startServer({
    configFile: registryPath(configDir),
    port: 0,
    host: "127.0.0.1",
    portFixed: true,
  });
  emptyServer = await startServer({
    configFile: registryPath(emptyConfigDir),
    port: 0,
    host: "127.0.0.1",
    portFixed: true,
  });
  browser = await launchBrowser();
}, 60_000);

afterAll(async () => {
  await Promise.allSettled([browser?.close(), server?.stop(), emptyServer?.stop()]);
  for (const dir of [projectDir, configDir, emptyConfigDir]) {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

test(
  "a failed initial fetch shows an error and retry restores the project list",
  async () => {
    const page = await browser.newPage();
    let attempts = 0;
    try {
      await page.route("**/api/projects", async (route) => {
        attempts++;
        if (attempts <= 3) await route.abort();
        else await route.continue();
      });
      await page.goto(`http://127.0.0.1:${server.port}/`);
      const retry = page.getByRole("button", { name: "Retry" });
      await retry.waitFor();
      expect(
        await page.locator(".landing").getByText("Couldn't reach the server").isVisible(),
      ).toBe(true);
      expect(await page.getByText("No projects yet", { exact: false }).isVisible()).toBe(false);
      expect(attempts).toBe(3);
      for (let i = 0; i < 2; i++) {
        const message = page.locator(".landing").getByText("Couldn't reach the server");
        const button = page.getByRole("button", { name: "Retry" });
        const contrast = await Promise.all([
          message.evaluate(measureContrast),
          button.evaluate(measureContrast),
        ]);
        for (const sample of contrast) expect(sample.ratio).toBeGreaterThanOrEqual(4.5);
        await page.locator(".theme-btn").click();
      }
      await retry.click();
      await page.waitForSelector(".project-card");
      expect(await page.locator(".project-name").allInnerTexts()).toEqual([project.name]);
      expect(
        await page.locator(".landing").getByText("Couldn't reach the server").isVisible(),
      ).toBe(false);
      expect(await page.getByText("No projects yet", { exact: false }).isVisible()).toBe(false);
    } finally {
      await page.close();
    }
  },
  T,
);

test(
  "a sustained projects failure keeps the error and retry control visible",
  async () => {
    const page = await browser.newPage();
    let attempts = 0;
    try {
      await page.route("**/api/projects", async (route) => {
        attempts++;
        await route.fulfill({ status: 503, body: "unavailable" });
      });
      await page.goto(`http://127.0.0.1:${server.port}/`);
      const retry = page.getByRole("button", { name: "Retry" });
      await retry.waitFor();
      expect(attempts).toBe(3);
      await retry.click();
      await page.waitForFunction(
        () => window.Alpine.$data(document.body).projectsLoadState === "loading",
      );
      await retry.waitFor();
      expect(attempts).toBe(6);
      expect(await retry.isVisible()).toBe(true);
      expect(await page.getByText("No projects yet", { exact: false }).isVisible()).toBe(false);
      expect(await page.locator(".project-card").count()).toBe(0);
    } finally {
      await page.close();
    }
  },
  T,
);

test(
  "a project route retries its initial fetch and starts live updates",
  async () => {
    const page = await browser.newPage();
    const pageErrors = [];
    let attempts = 0;
    try {
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.route("**/api/projects", async (route) => {
        attempts++;
        if (attempts === 1) await route.abort();
        else await route.continue();
      });
      await page.goto(`http://127.0.0.1:${server.port}/p/${encodeURIComponent(project.name)}/`);
      await page.waitForSelector("#tree .row");
      expect(attempts).toBe(2);
      expect(await page.locator(".project-load-error").count()).toBe(0);
      writeFileSync(join(projectDir, "live-after-retry.txt"), "live update\n");
      await page.locator("#tree .row .name", { hasText: "live-after-retry.txt" }).waitFor();
      expect(pageErrors).toEqual([]);
    } finally {
      await page.close();
    }
  },
  T,
);

test(
  "a project route recovers from sustained failure through Retry",
  async () => {
    const page = await browser.newPage();
    const pageErrors = [];
    let recover = false;
    let attempts = 0;
    try {
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.route("**/api/projects", async (route) => {
        attempts++;
        if (recover) await route.continue();
        else await route.fulfill({ status: 503, body: "unavailable" });
      });
      await page.goto(`http://127.0.0.1:${server.port}/p/${encodeURIComponent(project.name)}/`);
      const retry = page.getByRole("button", { name: "Retry" });
      await retry.waitFor({ timeout: 8_000 });
      expect(await page.locator(".project-load-error").isVisible()).toBe(true);
      expect(await page.locator("#tree .row").count()).toBe(0);
      expect(attempts).toBe(3);
      recover = true;
      await retry.click();
      await page.waitForSelector("#tree .row");
      expect(await page.locator(".project-load-error").count()).toBe(0);
      expect(pageErrors).toEqual([]);
    } finally {
      await page.close();
    }
  },
  T,
);

test(
  "a valid projects listing remains usable when its HTTP status is 503",
  async () => {
    const page = await browser.newPage();
    const listing = await (await fetch(`http://127.0.0.1:${server.port}/api/projects`)).json();
    try {
      await page.route("**/api/projects", (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify(listing),
        }),
      );
      await page.goto(`http://127.0.0.1:${server.port}/p/${encodeURIComponent(project.name)}/`);
      await page.waitForSelector("#tree .row", { timeout: 8_000 });
      expect(await page.locator("#tree .row").count()).toBeGreaterThan(0);
    } finally {
      await page.close();
    }
  },
  T,
);

test(
  "an unusable projects listing shows an error without uncaught exceptions",
  async () => {
    const page = await browser.newPage();
    const pageErrors = [];
    let recover = false;
    try {
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.route("**/api/projects", async (route) => {
        if (recover) await route.continue();
        else
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ hostname: "test", version: "test", projects: null }),
          });
      });
      await page.goto(`http://127.0.0.1:${server.port}/`);
      const retry = page.getByRole("button", { name: "Retry" });
      await retry.waitFor();
      expect(pageErrors).toEqual([]);
      expect(await page.getByText("No projects yet", { exact: false }).isVisible()).toBe(false);
      recover = true;
      await retry.click();
      await page.waitForSelector(".project-card");
      expect(pageErrors).toEqual([]);
    } finally {
      await page.close();
    }
  },
  T,
);

test(
  "an empty registry shows the empty-library message",
  async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`http://127.0.0.1:${emptyServer.port}/`);
      await page.getByText("No projects yet", { exact: false }).waitFor();
      expect(
        await page.locator(".landing").getByText("Couldn't reach the server").isVisible(),
      ).toBe(false);
      expect(await page.getByRole("button", { name: "Retry" }).isVisible()).toBe(false);
      expect(await page.locator(".project-card").count()).toBe(0);
    } finally {
      await page.close();
    }
  },
  T,
);
