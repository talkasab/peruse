// Core E2E journeys in Chromium. Each incident-tagged assertion guards a
// bug that actually shipped during development (refs = fixing commits).
// Chromium binary: PERUSE_CHROMIUM env, else playwright-core's default.
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { makeFixtureRepo, startFixtureServer } from "../fixture.js";

let srv, root, browser, page;
const T = 30_000;

beforeAll(async () => {
  root = makeFixtureRepo();
  srv = await startFixtureServer(root, 7561); // fixture defaults to a generous watch budget
  browser = await chromium.launch({
    executablePath: process.env.PERUSE_CHROMIUM || undefined,
    args: ["--no-sandbox"],
  });
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("pageerror", (e) => { throw new Error(`pageerror: ${e.message}`); });
}, 60_000);
afterAll(async () => { await browser?.close(); await srv?.cleanup(); });

const openFile = async (path) => {
  await page.goto(`${srv.base}/#/${path}`);
  await page.waitForFunction(
    (p) => document.querySelector("#pane-header .path")?.textContent === p, path);
};

describe("smoke", () => {
  test("page boots clean; tree shows statuses, dirty dots, dimmed ignored", async () => {
    await page.goto(srv.base);
    await page.waitForSelector("#tree .row");
    // tree starts collapsed: root-level letters only (U on data.bin)
    expect(await page.locator("#tree .row .status:visible").count()).toBeGreaterThan(0);
    expect(await page.locator("#tree .dirty-dot:visible").count()).toBeGreaterThan(0);
    expect(await page.locator("#tree .row.dim").count()).toBeGreaterThan(0);
  }, T);
});

describe("code review journey", () => {
  test("marks on exact changed lines; popup shows only the clicked change", async () => {
    await openFile("src/util.py");
    await page.waitForSelector(".line.hl-mod");
    // incident 53f812a/0314503: exact -U0 lines, not merged -U3 ranges
    const marked = await page.$$eval(".line.hl-mod", (els) => els.length);
    expect(marked).toBe(2); // lines 3-4 only
    // incident dd900e4: additions get marks but are NOT clickable
    expect(await page.locator(".line.hl-add").count()).toBeGreaterThan(0);
    expect(await page.locator(".line.hl-add[data-hunk]").count()).toBe(0);
    // popup: only the clicked change (+ context), never the whole file
    const line = page.locator(".line[data-hunk]").first();
    const box = await line.boundingBox();
    await page.mouse.click(box.x + 20, box.y + box.height / 2);
    await page.waitForSelector(".hunk-popup");
    const body = await page.locator(".hp-body").innerText();
    expect(body).toContain('def load(path, mode="r"):');
    expect(body).not.toContain("+def exists");   // incident 0314503
    // split toggle & Esc
    await page.click(".hp-view");
    await page.waitForSelector(".d2h-file-side-diff");
    await page.keyboard.press("Escape");
    expect(await page.locator(".hunk-popup").count()).toBe(0);
  }, T);

  test("wholly-new files show no marks at all (incident 41acf4a)", async () => {
    await openFile("docs/new.md");
    await page.waitForSelector(".markdown-body");
    expect(await page.locator(".rail-mark").count()).toBe(0);
    await page.click("#pane-header button:has-text('Raw')");
    await page.waitForSelector(".shiki .line");
    expect(await page.locator(".line.hl-add").count()).toBe(0);
  }, T);
});

describe("markdown review journey", () => {
  test("frontmatter card, single-x rail, innermost marks, arrows, links", async () => {
    await openFile("docs/guide.md");
    await page.waitForSelector(".rail-mark");
    // incident a113c4f: frontmatter renders as a card, not body text
    expect(await page.locator(".fm-card").count()).toBe(1);
    expect(await page.locator(".markdown-body p").first().innerText())
      .not.toContain("Created:");
    // incident b637380/c5b614c: every rail bar on ONE x
    const xs = await page.$$eval(".rail-mark", (els) =>
      els.map((e) => Math.round(e.getBoundingClientRect().left)));
    expect(new Set(xs).size).toBe(1);
    // incident d461de7: innermost marking — one bullet edited → one li marked
    const lis = await page.$$eval(".markdown-body ul li", (els) =>
      els.map((e) => e.classList.contains("md-changed")));
    expect(lis.filter(Boolean).length).toBe(1);
    // incident b8dcc0f: marked li's box is not dislocated from siblings
    const liX = await page.$$eval(".markdown-body ul li", (els) =>
      [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().left)))]);
    expect(liX.length).toBe(1);
    // arrows walk the changes and open popups
    await page.click("[title='Next change']");
    await page.waitForSelector(".hunk-popup");
    await page.click("[title='Previous change']");
    await page.waitForSelector(".hunk-popup");
    await page.keyboard.press("Escape");
    // relative link navigates in-app
    await page.click(".markdown-body a:has-text('util')");
    await page.waitForFunction(() =>
      document.querySelector("#pane-header .path")?.textContent === "src/util.py");
    expect(page.url()).toContain("#/src/util.py");
  }, T);

  test("headers pin inside the pane; body never scrolls (incidents b8dcc0f/d461de7)", async () => {
    await openFile("docs/guide.md");
    await page.waitForSelector(".markdown-body section");
    const r = await page.evaluate(() => {
      const s = document.querySelector("#viewer-scroll");
      s.scrollTop = 5000;
      const pane = s.getBoundingClientRect();
      const pinned = [...document.querySelectorAll(".markdown-body h1, .markdown-body h2")]
        .map((h) => Math.round(h.getBoundingClientRect().top - pane.top))
        .filter((y) => y >= -2 && y <= 2);
      return { scrolled: s.scrollTop, pinned: pinned.length,
        bodyScroll: document.scrollingElement.scrollTop };
    });
    expect(r.scrolled).toBeGreaterThan(500); // the pane itself scrolls…
    expect(r.bodyScroll).toBe(0);            // …never the body (min-height:0 regression)
    expect(r.pinned).toBe(1);                // exactly one pinned heading, no ghost stack
  }, T);
});

describe("live updates", () => {
  test("SSE re-render preserves the open popup; new files join the tree", async () => {
    await openFile("src/util.py");
    await page.waitForSelector(".line[data-hunk]");
    const line = page.locator(".line[data-hunk]").first();
    const box = await line.boundingBox();
    await page.mouse.click(box.x + 20, box.y + box.height / 2);
    await page.waitForSelector(".hunk-popup");
    appendFileSync(join(root, "src/util.py"), "# live-edit\n");
    await page.waitForFunction(() => document.body.innerText.includes("live-edit"), null, { timeout: 8000 });
    expect(await page.locator(".hunk-popup").count()).toBe(1);
    writeFileSync(join(root, "created-live.md"), "# hello\n");
    await page.waitForSelector("#tree .row:has-text('created-live.md')", { timeout: 8000 });
  }, T);
});
