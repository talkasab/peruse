import { afterEach, describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { packageRootFrom, resolveRunningVersion } from "../../server/index.js";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function layout(version) {
  const root = mkdtempSync(join(tmpdir(), "peruse-version-layout-"));
  roots.push(root);
  mkdirSync(join(root, "server"));
  writeFileSync(join(root, "server", "index.js"), "// fixture server module\n");
  writeFileSync(join(root, "package.json"), JSON.stringify({ version }));
  return root;
}

function git(root, ...args) {
  const result = Bun.spawnSync(["git", "--no-optional-locks", ...args], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

function gitAt(root, date, ...args) {
  const result = Bun.spawnSync(["git", "--no-optional-locks", ...args], {
    cwd: root,
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

describe("running version resolution (#35)", () => {
  test("the server module resolves the same package root in checkout and npm layouts", () => {
    const checkout = layout("1.2.3");
    const npmPackage = layout("1.2.3");
    expect(packageRootFrom(pathToFileURL(join(checkout, "server", "index.js")).href)).toBe(
      checkout,
    );
    expect(packageRootFrom(pathToFileURL(join(npmPackage, "server", "index.js")).href)).toBe(
      npmPackage,
    );
  });

  test("clean and dirty checkouts use commit and Git-reported file timestamps", async () => {
    const root = layout("9.8.7");
    writeFileSync(join(root, "source.txt"), "committed\n");
    git(root, "init", "-q");
    git(root, "config", "user.email", "version@example.test");
    git(root, "config", "user.name", "Version Test");
    git(root, "add", ".");
    gitAt(root, "2026-08-06T20:00:00Z", "commit", "-qm", "clean checkout");

    expect(await resolveRunningVersion(root)).toBe("v9.8.7-dev.20260806200000");

    appendFileSync(join(root, "source.txt"), "dirty\n");
    const modifiedTime = new Date("2026-08-06T20:30:00Z");
    utimesSync(join(root, "source.txt"), modifiedTime, modifiedTime);
    writeFileSync(join(root, "untracked.txt"), "newer untracked file\n");
    const untrackedTime = new Date("2026-08-06T21:01:44Z");
    utimesSync(join(root, "untracked.txt"), untrackedTime, untrackedTime);

    expect(await resolveRunningVersion(root)).toBe("v9.8.7-dev.20260806210144-dirty");
  });

  test("a packaged layout is plain and failed checkout Git resolution is marked dev", async () => {
    const packaged = layout("4.5.6");
    expect(await resolveRunningVersion(packaged)).toBe("v4.5.6");

    const brokenCheckout = layout("7.8.9");
    mkdirSync(join(brokenCheckout, ".git"));
    expect(await resolveRunningVersion(brokenCheckout)).toBe("v7.8.9 (dev)");
  });
});
