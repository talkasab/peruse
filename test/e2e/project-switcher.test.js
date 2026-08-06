// Runs in its own `bun test` process, FIRST in the test:e2e script — see
// package.json. In a process that has already cycled other Playwright
// browsers this test's single navigation stalls roughly every other suite
// run (Bun pipe transport, see launchBrowser in fixture.js); in a pristine
// process it has never failed. Regression for the switcher showing option 0
// regardless of route: selection must bind on the asynchronously rendered
// project/worktree options.
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../../server/index.js";
import { registerProject, registryPath, removeProject } from "../../server/projects.js";
import { launchBrowser } from "../fixture.js";

const T = 60_000;

function git(cwd, ...args) {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

test(
  "page title and branch state follow the switcher, landing, and project removal",
  async () => {
    const root = mkdtempSync(join(tmpdir(), "peruse-switcher-e2e-"));
    const configDir = mkdtempSync(join(tmpdir(), "peruse-switcher-config-"));
    const alpha = join(root, "alpha");
    const beta = join(root, "beta");
    const worktree = join(root, "beta-topic");
    mkdirSync(alpha);
    mkdirSync(beta);
    writeFileSync(join(alpha, "README.md"), "# Alpha\n");
    git(beta, "init", "-q");
    git(beta, "config", "user.email", "t@e.st");
    git(beta, "config", "user.name", "Test");
    writeFileSync(join(beta, "README.md"), "# Beta\n");
    git(beta, "add", ".");
    git(beta, "commit", "-qm", "initial");
    git(beta, "worktree", "add", "-qb", "topic", worktree);

    const configFile = registryPath(configDir);
    const alphaProject = registerProject(alpha, { file: configFile });
    const parent = registerProject(beta, { file: configFile });
    const routeName = `${parent.name}:topic`;

    let server, browser;
    try {
      server = await startServer({
        configFile,
        port: 0,
        host: "127.0.0.1",
        portFixed: true,
        watchBudget: 100,
      });
      browser = await launchBrowser();
      const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
      const projectsRequested = Promise.withResolvers();
      const releaseProjects = Promise.withResolvers();
      await page.route("**/api/projects", async (route) => {
        projectsRequested.resolve();
        await releaseProjects.promise;
        await route.continue();
      });

      const landingNavigation = page.goto(`http://127.0.0.1:${server.port}/`);
      await projectsRequested.promise;
      expect(await page.title()).toBe("peruse");
      expect(await page.title()).not.toMatch(/undefined|null/);
      releaseProjects.resolve();
      await landingNavigation;
      await page.waitForSelector(".project-primary");
      expect(await page.title()).toBe(`peruse - ${hostname()}`);

      const missingPage = await browser.newPage();
      const missingResponse = await missingPage.goto(
        `http://127.0.0.1:${server.port}/p/not-registered/`,
      );
      expect(missingResponse?.status()).toBe(404);
      expect(await missingPage.title()).toBe(`peruse - ${hostname()}`);
      expect(await missingPage.locator("body").innerText()).toBe("project not found");
      await missingPage.close();

      await page.locator(".project-primary").first().click();
      await page.waitForURL(`**/p/${encodeURIComponent(alphaProject.name)}/`);
      const firstTitle = `peruse - ${hostname()} - ${alphaProject.name}`;
      await page.waitForFunction((title) => document.title === title, firstTitle);
      expect(await page.title()).toBe(firstTitle);

      await page.waitForFunction(
        () => document.querySelectorAll(".project-switcher option").length === 3,
      );
      await page.locator(".project-switcher").selectOption(parent.name);
      await page.waitForURL(`**/p/${encodeURIComponent(parent.name)}/`);
      const switchedTitle = `peruse - ${hostname()} - ${parent.name}`;
      await page.waitForFunction((title) => document.title === title, switchedTitle);
      expect(await page.title()).toBe(switchedTitle);

      await page.evaluate(
        ({ firstRoute, finalRoute }) => {
          const app = window.Alpine.$data(document.body);
          app.switchProject(firstRoute);
          app.switchProject(finalRoute);
        },
        { firstRoute: alphaProject.name, finalRoute: parent.name },
      );
      await page.waitForTimeout(750);
      expect(new URL(page.url()).pathname).toBe(`/p/${encodeURIComponent(parent.name)}/`);
      expect(await page.title()).toBe(switchedTitle);

      await page.locator(".project-switcher").selectOption(routeName);
      await page.waitForURL(`**/p/${encodeURIComponent(routeName)}/`);
      const worktreeTitle = `peruse - ${hostname()} - ${routeName}`;
      await page.waitForFunction((title) => document.title === title, worktreeTitle);
      expect(await page.locator(".project-switcher").inputValue()).toBe(routeName);
      expect(await page.title()).toBe(worktreeTitle);
      expect(await page.locator(".branch-state").innerText()).toBe("topic");

      await page.selectOption(".project-switcher", parent.name);
      await page.waitForURL(
        `http://127.0.0.1:${server.port}/p/${encodeURIComponent(parent.name)}/`,
      );
      await page.waitForFunction(
        () => document.querySelector(".branch-state")?.textContent === "master",
      );
      expect(await page.locator(".branch-state").innerText()).toBe("master");

      await page.selectOption(".project-switcher", alphaProject.name);
      await page.waitForURL(
        `http://127.0.0.1:${server.port}/p/${encodeURIComponent(alphaProject.name)}/`,
      );
      await page.waitForFunction(() => document.querySelector("#tree .row"));
      expect(await page.locator(".branch-state").isVisible()).toBe(false);

      await page.locator(".brand").click();
      await page.waitForURL(`http://127.0.0.1:${server.port}/`);
      const landingTitle = `peruse - ${hostname()}`;
      await page.waitForFunction((title) => document.title === title, landingTitle);
      expect(await page.title()).toBe(landingTitle);
      expect(await page.title()).not.toMatch(/undefined|null/);

      await page.locator(".project-primary").first().click();
      await page.waitForURL(`**/p/${encodeURIComponent(alphaProject.name)}/`);
      await page.locator("#tree .row", { hasText: "README.md" }).click();
      await page.waitForFunction(() =>
        document.querySelector("#viewer")?.textContent?.includes("Alpha"),
      );
      const removedUrl = page.url();
      let projectRefreshes = 0;
      page.on("request", (request) => {
        if (new URL(request.url()).pathname === "/api/projects") projectRefreshes++;
      });
      expect(removeProject(alphaProject.name, configFile)).toBe(1);
      await fetch(`http://127.0.0.1:${server.port}/api/projects`);
      await page.waitForFunction((title) => document.title === title, landingTitle, {
        timeout: 8_000,
      });
      await page.waitForFunction(
        (route) =>
          ![...document.querySelectorAll(".project-switcher option")].some(
            (option) => option.value === route,
          ),
        alphaProject.name,
      );
      await page.waitForTimeout(1_500);
      expect(projectRefreshes).toBe(1);
      expect(page.url()).toBe(removedUrl);
      expect(await page.locator("#viewer").innerText()).toContain("Alpha");
      expect(await page.title()).toBe(landingTitle);
    } finally {
      await browser?.close();
      await server?.stop();
      rmSync(root, { recursive: true, force: true });
      rmSync(configDir, { recursive: true, force: true });
    }
  },
  T,
);
