import { afterAll, beforeAll, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchBrowser, makeFixtureRepo, startFixtureServer } from "../fixture.js";

let srv, browser, page;
beforeAll(async () => {
  const root = makeFixtureRepo();
  appendFileSync(join(root, ".gitignore"), "notes/\n");
  mkdirSync(join(root, "notes"));
  writeFileSync(join(root, "notes/todo.md"), "# Todo\n");
  writeFileSync(join(root, ".peruseshow"), "notes/\n");
  srv = await startFixtureServer(root, 0);
  browser = await launchBrowser();
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
}, 60000);
afterAll(async () => {
  await browser?.close();
  await srv?.cleanup();
});

test("allowlisted ignored files expand, render, dim, and hide with the tree toggle", async () => {
  await page.goto(srv.base);
  const notes = page.locator("#tree .row").filter({ hasText: "notes" });
  await notes.waitFor();
  expect(await notes.count()).toBe(1);
  expect(await notes.evaluate((row) => row.classList.contains("dim"))).toBe(true);
  await notes.click();
  const todo = page.locator("#tree .row").filter({ hasText: "todo.md" });
  await todo.waitFor();
  expect(await todo.evaluate((row) => row.classList.contains("dim"))).toBe(true);
  await todo.click();
  await page.waitForFunction(
    () => document.querySelector("#pane-header .path")?.textContent === "notes/todo.md",
  );
  expect(await page.locator(".markdown-body h1").innerText()).toBe("Todo");
  await page.getByRole("button", { name: "hide ignored" }).click();
  expect(await notes.count()).toBe(0);
  expect(await todo.count()).toBe(0);
}, 30000);
