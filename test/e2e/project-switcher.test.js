// Runs in its own `bun test` process, FIRST in the test:e2e script — see
// package.json. In a process that has already cycled other Playwright
// browsers this test's single navigation stalls roughly every other suite
// run (Bun pipe transport, see launchBrowser in fixture.js); in a pristine
// process it has never failed. Regression for the switcher showing option 0
// regardless of route: selection must bind on the asynchronously rendered
// project/worktree options.
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../../server/index.js";
import { registerProject, registryPath } from "../../server/projects.js";
import { launchBrowser } from "../fixture.js";

const T = 60_000;

function git(cwd, ...args) {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

test(
  "project switcher selects a non-first worktree route after options render",
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
    registerProject(alpha, { file: configFile });
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
      await page.goto(`http://127.0.0.1:${server.port}/p/${encodeURIComponent(routeName)}/`);
      await page.waitForFunction(
        () => document.querySelectorAll(".project-switcher option").length === 3,
      );

      expect(await page.locator(".project-switcher").inputValue()).toBe(routeName);
    } finally {
      await browser?.close();
      await server?.stop();
      rmSync(root, { recursive: true, force: true });
      rmSync(configDir, { recursive: true, force: true });
    }
  },
  T,
);
