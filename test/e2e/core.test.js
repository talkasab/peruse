// Core E2E journeys in Chromium. Each incident-tagged assertion guards a
// bug that actually shipped during development (refs = fixing commits).
// Chromium binary: PERUSE_CHROMIUM env, else playwright-core's default.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { launchBrowser, makeFixtureRepo, startFixtureServer } from "../fixture.js";

let srv, root, browser, page;
const T = 30_000;
// Throwing inside a Playwright event listener doesn't fail the test (the
// listener isn't on the test's own call stack) — collect instead and assert
// per-test in afterEach, which does fail it.
let pageErrors = [];

beforeAll(async () => {
  root = makeFixtureRepo();
  srv = await startFixtureServer(root, 7561); // fixture defaults to a generous watch budget
  browser = await launchBrowser();
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("pageerror", (e) => pageErrors.push(e.message));
}, 60_000);
afterAll(async () => {
  // Best-effort teardown, bounded under the 5 s hook timeout: a Bun-stalled
  // browser.close() (or a wedged watcher close) must not fail an otherwise
  // green run — process exit reaps the browser and server either way.
  await Promise.race([
    Promise.allSettled([browser?.close(), srv?.cleanup()]),
    new Promise((resolve) => setTimeout(resolve, 3500)),
  ]);
});
afterEach(() => {
  // finally: a failing expect throws, and without the reset one page error
  // would cascade into failing every subsequent test too
  try {
    expect(pageErrors).toEqual([]);
  } finally {
    pageErrors = [];
  }
});

const openFile = async (path) => {
  await page.goto(`${srv.base}/#/${path}`);
  await page.waitForFunction(
    (p) => document.querySelector("#pane-header .path")?.textContent === p,
    path,
  );
};

describe("smoke", () => {
  // Own page, not the shared journeys tab: inserting the landing page's
  // extra cross-document hop into the shared tab destabilized the whole file
  // under Bun's Playwright pipe transport (10/10 clean without it vs ~1-in-3
  // failing runs with it; see the launchBrowser note in fixture.js).
  test(
    "landing page lists the registered project",
    async () => {
      const landing = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      try {
        await landing.goto(srv.origin);
        await landing.waitForSelector(".project-card");
        expect(await landing.locator(".project-name").innerText()).toBe(srv.project.name);
        expect(await landing.locator(".project-summary").innerText()).toContain("change");
      } finally {
        await landing.close();
      }
    },
    T,
  );

  // The job here is booting without a pageerror (checked by the global
  // afterEach); status/dirty-dot/dim presence is exercised properly, with
  // real content assertions, by the journeys below.
  test(
    "page boots clean; tree renders",
    async () => {
      await page.goto(srv.base);
      await page.waitForSelector("#tree .row");
      expect(await page.locator("#tree .row").count()).toBeGreaterThan(0);
      expect(await page.locator(".project-switcher option").count()).toBe(1);
      expect(await page.locator(".project-switcher").inputValue()).toBe(srv.project.name);
    },
    T,
  );
});

describe("code review journey", () => {
  test(
    "marks on exact changed lines; popup shows only the clicked change",
    async () => {
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
      // +20px lands inside the gutter (GUTTER_PX=64 in app.js); the gutter has
      // no separate DOM element, so there's nothing more specific to target.
      await page.mouse.click(box.x + 20, box.y + box.height / 2);
      await page.waitForSelector(".hunk-popup");
      const body = await page.locator(".hp-body").innerText();
      expect(body).toContain('def load(path, mode="r"):');
      expect(body).not.toContain("+def exists"); // incident 0314503
      // split toggle & Esc
      await page.click(".hp-view");
      await page.waitForSelector(".d2h-file-side-diff");
      await page.keyboard.press("Escape");
      expect(await page.locator(".hunk-popup").count()).toBe(0);
    },
    T,
  );

  test(
    "wholly-new files show no marks at all (incident 41acf4a)",
    async () => {
      await openFile("docs/new.md");
      await page.waitForSelector(".markdown-body");
      expect(await page.locator(".rail-mark").count()).toBe(0);
      await page.click("#pane-header button:has-text('Raw')");
      await page.waitForSelector(".shiki .line");
      expect(await page.locator(".line.hl-add").count()).toBe(0);
    },
    T,
  );
});

describe("markdown review journey", () => {
  test(
    "frontmatter card, single-x rail, innermost marks, arrows, links",
    async () => {
      await openFile("docs/guide.md");
      await page.waitForSelector(".rail-mark");
      // incident a113c4f: frontmatter renders as a card, not body text
      expect(await page.locator(".fm-card").count()).toBe(1);
      expect(await page.locator(".markdown-body p").first().innerText()).not.toContain("Created:");
      // incident b637380/c5b614c: every rail bar on ONE x
      const xs = await page.$$eval(".rail-mark", (els) =>
        els.map((e) => Math.round(e.getBoundingClientRect().left)),
      );
      expect(new Set(xs).size).toBe(1);
      // incident d461de7: innermost marking — one bullet edited → one li marked
      const lis = await page.$$eval(".markdown-body ul li", (els) =>
        els.map((e) => e.classList.contains("md-changed")),
      );
      expect(lis.filter(Boolean).length).toBe(1);
      // incident b8dcc0f: marked li's box is not dislocated from siblings
      const liX = await page.$$eval(".markdown-body ul li", (els) => [
        ...new Set(els.map((e) => Math.round(e.getBoundingClientRect().left))),
      ]);
      expect(liX.length).toBe(1);
      // arrows walk the changes and open popups on DIFFERENT hunks each press
      // (asserting popup presence alone can't fail: a popup left open by the
      // previous press would satisfy it even if the arrow did nothing)
      await page.click("[title='Next change']");
      await page.waitForSelector(".hunk-popup");
      const first = await page.locator(".hunk-popup").getAttribute("data-hunk");
      await page.click("[title='Previous change']");
      await page.waitForSelector(".hunk-popup");
      const afterPrev = await page.locator(".hunk-popup").getAttribute("data-hunk");
      expect(afterPrev).not.toBe(first);
      await page.keyboard.press("Escape");
      // relative link navigates in-app
      await page.click(".markdown-body a:has-text('util')");
      await page.waitForFunction(
        () => document.querySelector("#pane-header .path")?.textContent === "src/util.py",
      );
      expect(page.url()).toContain("#/src/util.py");
    },
    T,
  );

  test(
    "headers pin inside the pane; body never scrolls (incidents b8dcc0f/d461de7)",
    async () => {
      await openFile("docs/guide.md");
      await page.waitForSelector(".markdown-body section");
      const r = await page.evaluate(() => {
        const s = document.querySelector("#viewer-scroll");
        // Derived, not magic: scroll to well inside "Section Two"'s filler
        // content (its own section's offsetTop + 200px), so its h2 is the one
        // that ends up pinned regardless of how the fixture content reflows.
        // guide.md has 3 sections (Guide/h1, Section One/h2, Section Two/h2);
        // the last one is the only one with enough content below it to still
        // be scrolled into (and have its own heading pinned) 200px in.
        const sections = document.querySelectorAll(".markdown-body section");
        const target = sections[sections.length - 1].offsetTop + 200;
        s.scrollTop = target;
        const pane = s.getBoundingClientRect();
        const pinned = [...document.querySelectorAll(".markdown-body h1, .markdown-body h2")]
          .map((h) => Math.round(h.getBoundingClientRect().top - pane.top))
          .filter((y) => y >= -3 && y <= 3);
        return {
          scrolled: s.scrollTop,
          target,
          pinned: pinned.length,
          bodyScroll: document.scrollingElement.scrollTop,
        };
      });
      expect(r.scrolled).toBeGreaterThan(0); // the pane itself scrolls…
      expect(Math.abs(r.scrolled - r.target)).toBeLessThanOrEqual(1); // …to where we asked…
      expect(r.bodyScroll).toBe(0); // …never the body (min-height:0 regression)
      expect(r.pinned).toBe(1); // exactly one pinned heading, no ghost stack
    },
    T,
  );
});

describe("live updates", () => {
  test(
    "SSE re-render preserves the open popup; new files join the tree",
    async () => {
      await openFile("src/util.py");
      await page.waitForSelector(".line[data-hunk]");
      const line = page.locator(".line[data-hunk]").first();
      const box = await line.boundingBox();
      // +20px: gutter click, see the comment on the equivalent click above.
      await page.mouse.click(box.x + 20, box.y + box.height / 2);
      await page.waitForSelector(".hunk-popup");
      appendFileSync(join(root, "src/util.py"), "# live-edit\n");
      await page.waitForFunction(() => document.body.innerText.includes("live-edit"), null, {
        timeout: 8000,
      });
      expect(await page.locator(".hunk-popup").count()).toBe(1);
      writeFileSync(join(root, "created-live.md"), "# hello\n");
      await page.waitForSelector("#tree .row:has-text('created-live.md')", { timeout: 8000 });
    },
    T,
  );
});

describe("theming", () => {
  test(
    "toggling theme flips computed colors on a Shiki token and an open popup",
    async () => {
      await openFile("src/util.py");
      await page.waitForSelector(".shiki .line span");
      // openFile() re-navigates to the same path/hash as the previous ("live
      // updates") test, which is a no-op for page.goto() (URL unchanged) — the
      // popup that test left open survives, so a click here would TOGGLE IT
      // CLOSED instead of opening one. Clear it first for a known starting state.
      await page.keyboard.press("Escape");
      const line = page.locator(".line[data-hunk]").first();
      const box = await line.boundingBox();
      await page.mouse.click(box.x + 20, box.y + box.height / 2); // open a popup too
      await page.waitForSelector(".hunk-popup");
      const before = await page.evaluate(() => ({
        theme: document.documentElement.dataset.theme,
        token: getComputedStyle(document.querySelector(".shiki .line span")).color,
        popup: getComputedStyle(document.querySelector(".hp-body")).backgroundColor,
      }));
      await page.click(".theme-btn");
      await page.waitForFunction(
        (prev) => document.documentElement.dataset.theme !== prev,
        before.theme,
      );
      const after = await page.evaluate(() => ({
        theme: document.documentElement.dataset.theme,
        token: getComputedStyle(document.querySelector(".shiki .line span")).color,
        popup: getComputedStyle(document.querySelector(".hp-body")).backgroundColor,
      }));
      expect(after.theme).not.toBe(before.theme);
      expect(after.token).not.toBe(before.token);
      expect(after.popup).not.toBe(before.popup);
      await page.keyboard.press("Escape");
      // leave the toggle as found: other tests assume the default (latte) theme
      await page.click(".theme-btn");
    },
    T,
  );
});
