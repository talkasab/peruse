// Core E2E journeys in Chromium. Each incident-tagged assertion guards a
// bug that actually shipped during development (refs = fixing commits).
// Chromium binary: PERUSE_CHROMIUM env, else playwright-core's default.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  launchBrowser,
  makeFixtureRepo,
  POST_SVX_EDITED,
  SVX_HL_LINE_LIMIT,
  startFixtureServer,
} from "../fixture.js";

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
      // +20px lands inside the line-number gutter; the gutter has
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

describe("mdsvex code view", () => {
  // Region markers, matched against the rendered line text. Kept in step with
  // POST_SVX_BASE in fixture.js.
  const MARKERS = {
    frontmatter: "title: Release Notes",
    script: "const items:",
    prose: "Prose with",
    component: "<Callout kind=",
    controlFlow: "{#each items as item",
    fence: "const answer = 42;",
    style: ".callout { color:",
  };

  // Distinct computed colours of the spans on the line carrying each marker.
  const palettes = (markers) =>
    page.evaluate((m) => {
      const lines = [...document.querySelectorAll(".shiki .line")];
      return Object.fromEntries(
        Object.entries(m).map(([name, marker]) => {
          const line = lines.find((l) => l.textContent.includes(marker));
          const colors = [...(line?.querySelectorAll("span") ?? [])]
            .filter((s) => s.textContent.trim())
            .map((s) => getComputedStyle(s).color);
          return [name, [...new Set(colors)]];
        }),
      );
    }, markers);

  test(
    "renders as highlighted source with every region visually distinct",
    async () => {
      await openFile("docs/post.svx");
      await page.waitForSelector(".shiki .line");
      // A code view, never a rendered document — and therefore no Rendered/Raw
      // toggle, which only markdown gets.
      expect(await page.locator(".markdown-body").count()).toBe(0);
      expect(await page.locator("#pane-header button:has-text('Raw')").isVisible()).toBe(false);
      expect(await page.locator(".notice").count()).toBe(0);

      const latte = await palettes(MARKERS);
      // Name the region in the assertion so a failure says which one went flat.
      const multicoloured = Object.entries(latte).map(([name, c]) => [name, c.length > 1]);
      expect(multicoloured).toEqual(Object.keys(MARKERS).map((name) => [name, true]));
      // Every region paints a palette no other region paints. The failure mode
      // of mapping .svx to a single grammar is regions that tokenize fine and
      // all come out the same default foreground.
      const signature = (p) => Object.values(p).map((c) => [...c].sort().join(","));
      expect(new Set(signature(latte)).size).toBe(Object.keys(MARKERS).length);

      // …and the same holds in the other theme, not just after a colour shift.
      await page.click(".theme-btn");
      await page.waitForFunction(() => document.documentElement.dataset.theme === "mocha");
      const mocha = await palettes(MARKERS);
      expect(new Set(signature(mocha)).size).toBe(Object.keys(MARKERS).length);
      expect(signature(mocha)).not.toEqual(signature(latte));
      await page.click(".theme-btn"); // leave the toggle as found
      await page.waitForFunction(() => document.documentElement.dataset.theme === "latte");
    },
    T,
  );

  test(
    "TOML frontmatter is visibly tokenized in both themes",
    async () => {
      await openFile("docs/toml.svx");
      await page.waitForSelector(".shiki .line");
      const titleColors = () =>
        page.evaluate(() => {
          const line = [...document.querySelectorAll(".shiki .line")].find((candidate) =>
            candidate.textContent.includes('title = "TOML Notes"'),
          );
          return [
            ...new Set(
              [...line.querySelectorAll("span")]
                .filter((span) => span.textContent.trim())
                .map((span) => getComputedStyle(span).color),
            ),
          ];
        });
      const latte = await titleColors();
      expect(latte.length).toBeGreaterThan(1);
      await page.click(".theme-btn");
      await page.waitForFunction(() => document.documentElement.dataset.theme === "mocha");
      const mocha = await titleColors();
      expect(mocha.length).toBeGreaterThan(1);
      expect(mocha).not.toEqual(latte);
      await page.click(".theme-btn");
      await page.waitForFunction(() => document.documentElement.dataset.theme === "latte");
    },
    T,
  );

  test(
    "line numbers align with the source and gutter marks open the usual popup",
    async () => {
      await openFile("docs/post.svx");
      await page.waitForSelector(".line.hl-mod");
      const rendered = await page.$$eval(".shiki .line", (els) => els.map((l) => l.textContent));
      // Line numbers are CSS counters over .line, so "aligned" means one .line
      // per source line, in order, carrying the source's own text.
      expect(rendered).toEqual(POST_SVX_EDITED.split("\n"));

      const line = page.locator(".line[data-hunk]").first();
      const box = await line.boundingBox();
      await page.mouse.click(box.x + 20, box.y + box.height / 2); // gutter, see above
      await page.waitForSelector(".hunk-popup");
      expect(await page.locator(".hp-body").innerText()).toContain("const items");
      await page.keyboard.press("Escape");
    },
    T,
  );

  test(
    "the mdsvex line boundary is independent of a terminal newline",
    async () => {
      for (const [path, renderedLines] of [
        ["docs/at-limit.svx", SVX_HL_LINE_LIMIT + 1],
        ["docs/at-limit-unterminated.svx", SVX_HL_LINE_LIMIT],
      ]) {
        await openFile(path);
        await page.waitForSelector(".notice, .shiki .line span");
        expect(await page.locator(".notice").count()).toBe(0);
        // Highlighting preserves the terminal newline as an empty final DOM
        // row even though it does not count as another logical source line.
        expect(await page.locator(".shiki .line").count()).toBe(renderedLines);
      }

      for (const path of ["docs/over-limit.svx", "docs/over-limit-unterminated.svx"]) {
        await openFile(path);
        await page.waitForSelector(".notice");
        expect(await page.locator(".shiki .line").count()).toBe(SVX_HL_LINE_LIMIT + 1);
        expect(await page.locator(".shiki .line span").count()).toBe(0);
      }
    },
    T,
  );

  test(
    "a legacy oversized .svx takes the plain-source fallback",
    async () => {
      await openFile("docs/huge.svx");
      await page.waitForSelector(".notice");
      expect(await page.locator(".notice").innerText()).toContain("syntax highlighting disabled");
      // plainPre emits bare .line elements with no token spans at all
      expect(await page.locator(".shiki .line").count()).toBeGreaterThan(10_000);
      expect(await page.locator(".shiki .line span").count()).toBe(0);
    },
    T,
  );
});

describe("word wrap (#25)", () => {
  const setWrap = async (enabled) => {
    const current = await page.locator("#viewer").evaluate((v) => v.hasAttribute("data-wrap"));
    if (current === enabled) return;
    await page.click(".wrap-btn");
    await page.waitForFunction(
      (wanted) => document.querySelector("#viewer").hasAttribute("data-wrap") === wanted,
      enabled,
    );
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
  };

  const scrollState = (selector) =>
    page.evaluate((targetSelector) => {
      const scroll = document.querySelector("#viewer-scroll");
      const target = document.querySelector(targetSelector);
      const lineHeight = Number.parseFloat(getComputedStyle(target).lineHeight);
      return {
        top: target.getBoundingClientRect().top - scroll.getBoundingClientRect().top,
        scrollTop: scroll.scrollTop,
        max: Math.max(0, scroll.scrollHeight - scroll.clientHeight),
        endGap: Math.max(0, scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop),
        viewportHeight: scroll.clientHeight,
        tolerance: Math.max(1, lineHeight * 0.15),
      };
    }, selector);

  const visibleLineState = () =>
    page.evaluate(() => {
      const scroll = document.querySelector("#viewer-scroll");
      const viewport = scroll.getBoundingClientRect();
      const lines = [...document.querySelectorAll(".shiki > code > .line")];
      const visible = lines
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => {
          const box = line.getBoundingClientRect();
          return box.bottom > viewport.top + 1 && box.top < viewport.bottom - 1;
        })
        .map(({ index }) => index);
      const lineHeight = Number.parseFloat(getComputedStyle(lines[0]).lineHeight);
      return {
        visible,
        last: lines.length - 1,
        lineHeight,
        viewportHeight: scroll.clientHeight,
        endGap: Math.max(0, scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop),
        tolerance: Math.max(1, lineHeight * 0.15),
      };
    });

  const setEndGap = (gap) =>
    page.$eval(
      "#viewer-scroll",
      (scroll, endGap) => {
        scroll.scrollTop = scroll.scrollHeight - scroll.clientHeight - endGap;
      },
      gap,
    );

  const sharedLines = (before, after) =>
    before.visible.filter((line) => after.visible.includes(line));

  test("wraps grammar-highlighted .svx source (#18 + #25)", async () => {
    await openFile("docs/wide.svx");
    const measure = () =>
      page.evaluate(() => {
        const pre = document.querySelector(".shiki");
        const line = [...document.querySelectorAll(".shiki > code > .line")].find(
          (l) => l.textContent.length > 200,
        );
        const lineHeight = Number.parseFloat(getComputedStyle(line).lineHeight);
        return {
          tokens: pre.querySelectorAll(".line > span").length,
          rows: Math.round(line.offsetHeight / lineHeight),
          overflow: pre.scrollWidth > pre.clientWidth,
        };
      });
    const before = await measure();
    expect(before.tokens).toBeGreaterThan(0); // mdsvex grammar, not the plain fallback
    expect(before.rows).toBe(1);
    expect(before.overflow).toBe(true);
    await setWrap(true);
    const after = await measure();
    expect(after.tokens).toBe(before.tokens);
    expect(after.rows).toBeGreaterThan(1);
    expect(after.overflow).toBe(false);
    await setWrap(false);
  });

  // Per-line geometry inside a <pre class="shiki">. Heights are expressed in
  // line-height units (rows) so the assertions don't depend on the host's
  // monospace metrics, and `lefts` groups the range's per-token rects by their
  // top so each entry is one VISUAL row's left edge.
  const measure = (sel = ".shiki") =>
    page.evaluate((s) => {
      const pre = document.querySelector(s);
      const lh = Number.parseFloat(getComputedStyle(pre).lineHeight);
      const lines = [...pre.querySelectorAll(".line")];
      return {
        count: lines.length,
        wrapped: document.querySelector("#viewer").hasAttribute("data-wrap"),
        overflows: pre.scrollWidth > pre.clientWidth + 1,
        chip: document.querySelector(".wrap-btn").textContent,
        codeRows: Math.round(pre.querySelector("code").offsetHeight / lh),
        lines: lines.map((el) => {
          const range = document.createRange();
          range.selectNodeContents(el);
          const byTop = new Map();
          for (const b of range.getClientRects())
            if (b.width)
              byTop.set(
                Math.round(b.top),
                Math.min(byTop.get(Math.round(b.top)) ?? Infinity, Math.round(b.left)),
              );
          return {
            rows: Math.round(el.offsetHeight / lh),
            lefts: [...new Set(byTop.values())],
          };
        }),
      };
    }, sel);

  const sumRows = (m) => m.lines.reduce((n, l) => n + l.rows, 0);

  test(
    "long lines wrap, short lines keep one row, and the choice persists",
    async () => {
      await openFile("docs/wide.txt");
      await page.waitForSelector(".shiki .line");
      const off = await measure();
      expect(off.wrapped).toBe(false);
      expect(off.chip).toBe("Wrap");
      expect(off.overflows).toBe(true); // long lines scroll horizontally
      expect(off.lines.every((l) => l.rows === 1)).toBe(true);
      expect(off.codeRows).toBe(sumRows(off));

      await page.click(".wrap-btn");
      await page.waitForFunction(() => document.querySelector("#viewer").hasAttribute("data-wrap"));
      const on = await measure();
      expect(on.chip).toBe("No wrap");
      expect(on.wrapped).toBe(true);
      expect(on.overflows).toBe(false);
      expect(on.count).toBe(off.count); // same line spans, none added
      // THE inline-block check: Shiki separates .line spans with literal "\n"
      // text nodes, and a `display: block` .line would render each of those as
      // an extra empty line box — <code> would then be ~2x the rows its lines
      // occupy. Equality here is what rules that out.
      expect(on.codeRows).toBe(sumRows(on));
      expect(on.lines[0].rows).toBe(1); // "short line"
      expect(on.lines[3].rows).toBe(1); // "tail line"
      expect(on.lines[1].rows).toBeGreaterThan(1); // wraps on spaces
      expect(on.lines[2].rows).toBeGreaterThan(1); // needs overflow-wrap: anywhere
      // hanging indent: every visual row of a wrapped line starts at the same
      // x as the unwrapped line did — under the code, not under the gutter
      expect(on.lines[1].lefts).toEqual(off.lines[1].lefts);
      expect(on.lines[2].lefts).toEqual(off.lines[2].lefts);

      // markdown fences have no line-number gutter, so no indent to reserve
      await openFile("docs/guide.md");
      await page.waitForSelector(".markdown-body .shiki .line");
      const fence = await measure(".markdown-body .shiki");
      expect(fence.overflows).toBe(false);
      expect(fence.lines[0].rows).toBeGreaterThan(1);
      expect(fence.lines[0].lefts.length).toBe(1);
      expect(
        await page.$eval(".markdown-body .shiki .line", (el) => getComputedStyle(el).paddingLeft),
      ).toBe("0px");

      // survives a reload, and toggling back restores unwrapped geometry
      await page.reload();
      await page.waitForSelector(".shiki .line");
      expect((await measure()).wrapped).toBe(true);
      await openFile("docs/wide.txt");
      await page.waitForSelector(".shiki .line");
      await page.click(".wrap-btn");
      await page.waitForFunction(
        () => !document.querySelector("#viewer").hasAttribute("data-wrap"),
      );
      const back = await measure();
      expect(back.lines.every((l) => l.rows === 1)).toBe(true);
      expect(back.codeRows).toBe(off.codeRows);
    },
    T,
  );

  test(
    "toggling closes an open hunk popup (its anchor offsets move)",
    async () => {
      await openFile("src/util.py");
      await page.waitForSelector(".line[data-hunk]");
      await page.keyboard.press("Escape"); // known starting state
      const box = await page.locator(".line[data-hunk]").first().boundingBox();
      await page.mouse.click(box.x + 20, box.y + box.height / 2); // gutter click
      await page.waitForSelector(".hunk-popup");
      await page.click(".wrap-btn");
      expect(await page.locator(".hunk-popup").count()).toBe(0);
      await page.click(".wrap-btn"); // leave the toggle as found
    },
    T,
  );

  test(
    "toggling and a rapid round trip keep the same logical line at the viewport top",
    async () => {
      await openFile("docs/long-scroll.txt");
      await page.waitForSelector(".shiki .line");
      await setWrap(false);
      const positionLine = (index) =>
        page.evaluate((i) => {
          const scroll = document.querySelector("#viewer-scroll");
          const line = document.querySelectorAll(".shiki .line")[i];
          scroll.scrollTop += line.getBoundingClientRect().top - scroll.getBoundingClientRect().top;
        }, index);
      const atTop = () =>
        page.evaluate(() => {
          const scroll = document.querySelector("#viewer-scroll");
          const top = scroll.getBoundingClientRect().top;
          const lines = [...document.querySelectorAll(".shiki .line")];
          const index = lines.findIndex((line) => line.getBoundingClientRect().bottom > top + 1);
          const line = lines[index];
          return {
            index,
            top: line.getBoundingClientRect().top - top,
            lineHeight: Number.parseFloat(getComputedStyle(line).lineHeight),
            tolerance: Math.max(1, Number.parseFloat(getComputedStyle(line).lineHeight) * 0.15),
          };
        });

      await positionLine(149);
      expect((await atTop()).index).toBe(149);
      for (const enabled of [true, false]) {
        await setWrap(enabled);
        await page.waitForFunction(
          () => {
            const scroll = document.querySelector("#viewer-scroll");
            const top = scroll.getBoundingClientRect().top;
            const line = document.querySelectorAll(".shiki .line")[149];
            const tolerance = Math.max(
              1,
              Number.parseFloat(getComputedStyle(line).lineHeight) * 0.15,
            );
            return Math.abs(line.getBoundingClientRect().top - top) <= tolerance;
          },
          null,
          { timeout: 3_000 },
        );
        const anchored = await atTop();
        expect(anchored.index).toBe(149);
        expect(Math.abs(anchored.top)).toBeLessThanOrEqual(anchored.tolerance);
      }

      await page.evaluate(() => {
        const button = document.querySelector(".wrap-btn");
        button.click();
        button.click();
      });
      await page.waitForFunction(
        () => !document.querySelector("#viewer").hasAttribute("data-wrap"),
      );
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      const rapid = await atTop();
      expect(rapid.index).toBe(149);
      expect(Math.abs(rapid.top)).toBeLessThanOrEqual(rapid.tolerance);
    },
    T,
  );

  test(
    "wrap preserves code-file top, exact EOF, and a short non-scrolling viewport",
    async () => {
      await openFile("docs/long-scroll.txt");
      await page.waitForSelector(".shiki .line");
      await setWrap(false);
      await page.$eval("#viewer-scroll", (scroll) => {
        scroll.scrollTop = 0;
      });
      const topBefore = await scrollState(".shiki .line:first-child");
      await setWrap(true);
      await setWrap(false);
      const topAfter = await scrollState(".shiki .line:first-child");
      expect(topAfter.scrollTop).toBe(0);
      expect(Math.abs(topAfter.top - topBefore.top)).toBeLessThanOrEqual(topAfter.tolerance);

      await page.$eval("#viewer-scroll", (scroll) => {
        scroll.scrollTop = scroll.scrollHeight;
      });
      const eofBefore = await scrollState(".shiki .line:last-child");
      expect(eofBefore.endGap).toBeLessThanOrEqual(eofBefore.tolerance);
      await setWrap(true);
      const eofWrapped = await scrollState(".shiki .line:last-child");
      expect(eofWrapped.endGap).toBeLessThanOrEqual(eofWrapped.tolerance);

      await openFile("docs/short.txt");
      await page.waitForSelector(".shiki .line");
      await setWrap(false);
      const shortBefore = await scrollState(".shiki .line:first-child");
      expect(shortBefore.max).toBe(0);
      await setWrap(true);
      const shortAfter = await scrollState(".shiki .line:first-child");
      expect(shortAfter.max).toBe(0);
      expect(shortAfter.scrollTop).toBe(0);
    },
    T,
  );

  test(
    "a non-overflowing file that gains a scrollbar still prefers file start",
    async () => {
      await openFile("docs/single-long.txt");
      await page.waitForSelector(".shiki .line");
      await setWrap(false);
      const singleBefore = await scrollState(".shiki .line:first-child");
      expect(singleBefore.max).toBe(0);
      expect(singleBefore.scrollTop).toBe(0);
      await setWrap(true);
      const singleWrapped = await scrollState(".shiki .line:first-child");
      expect(singleWrapped.max).toBeGreaterThan(0);
      expect(singleWrapped.scrollTop).toBe(0);
    },
    T,
  );

  test(
    "visible end content keeps its gap while both sides of the old distance boundary retain content",
    async () => {
      await openFile("docs/long-scroll.txt");
      await page.waitForSelector(".shiki .line");
      await setWrap(false);
      const geometry = await visibleLineState();
      const gaps = [0, 1, 2, 0.5 * geometry.lineHeight, 0.9 * geometry.lineHeight];
      for (const gap of gaps) {
        await setEndGap(gap);
        const before = await visibleLineState();
        expect(before.visible).toContain(before.last);
        await setWrap(true);
        const wrapped = await visibleLineState();
        expect(wrapped.visible).toContain(wrapped.last);
        expect(Math.abs(wrapped.endGap - before.endGap)).toBeLessThanOrEqual(before.tolerance);
        await setWrap(false);
      }

      const boundaryDelta = Math.ceil(geometry.lineHeight);
      for (const gap of [
        geometry.viewportHeight - boundaryDelta,
        geometry.viewportHeight + boundaryDelta,
      ]) {
        await setEndGap(gap);
        const before = await visibleLineState();
        expect(before.visible).not.toContain(before.last);
        await setWrap(true);
        const wrapped = await visibleLineState();
        expect(sharedLines(before, wrapped).length).toBeGreaterThan(0);
        await setWrap(false);
      }
    },
    T,
  );

  test(
    "a viewport-tall final line uses end anchoring only while that line is visible",
    async () => {
      await openFile("docs/tall-final-line.txt");
      await page.waitForSelector(".shiki .line");
      await setWrap(false);
      const geometry = await visibleLineState();
      const boundaryDelta = Math.ceil(geometry.lineHeight);
      const visibleGap = Math.ceil(geometry.lineHeight * 1.05);

      await setEndGap(visibleGap);
      const visibleBefore = await visibleLineState();
      expect(visibleBefore.visible).toContain(visibleBefore.last);
      await setWrap(true);
      const visibleAfter = await visibleLineState();
      expect(visibleAfter.visible).toContain(visibleAfter.last);
      expect(sharedLines(visibleBefore, visibleAfter)).toContain(visibleBefore.last);
      expect(Math.abs(visibleAfter.endGap - visibleBefore.endGap)).toBeLessThanOrEqual(
        visibleBefore.tolerance,
      );

      await page.setViewportSize({ width: 1280, height: 799 });
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      const resized = await visibleLineState();
      expect(resized.visible).toContain(resized.last);
      await setWrap(false);
      const resizedUnwrapped = await visibleLineState();
      expect(Math.abs(resizedUnwrapped.endGap - resized.endGap)).toBeLessThanOrEqual(
        resized.tolerance,
      );
      await setWrap(true);
      const resizedWrapped = await visibleLineState();
      expect(Math.abs(resizedWrapped.endGap - resized.endGap)).toBeLessThanOrEqual(
        resized.tolerance,
      );
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      await setWrap(false);
      await setEndGap(geometry.viewportHeight - boundaryDelta);
      const hiddenBefore = await visibleLineState();
      expect(hiddenBefore.visible).not.toContain(hiddenBefore.last);
      await setWrap(true);
      const hiddenAfter = await visibleLineState();
      expect(sharedLines(hiddenBefore, hiddenAfter).length).toBeGreaterThan(0);
    },
    T,
  );

  test(
    "Markdown anchors viewport-tall fences, ordinary blocks, and exact EOF",
    async () => {
      await openFile("docs/wrap-anchor.md");
      await page.waitForSelector(".markdown-body .shiki");
      await setWrap(false);
      await page.$eval(".markdown-body .shiki", (fence) => {
        const scroll = document.querySelector("#viewer-scroll");
        scroll.scrollTop += fence.getBoundingClientRect().top - scroll.getBoundingClientRect().top;
      });
      const original = await scrollState(".markdown-body .shiki");
      for (let cycle = 0; cycle < 3; cycle++) {
        await setWrap(true);
        const wrapped = await scrollState(".markdown-body .shiki");
        expect(Math.abs(wrapped.top - original.top)).toBeLessThanOrEqual(wrapped.tolerance);
        await setWrap(false);
        const returned = await scrollState(".markdown-body .shiki");
        expect(Math.abs(returned.top - original.top)).toBeLessThanOrEqual(returned.tolerance);
      }

      const blockSelector = ".markdown-body section:last-child p:nth-of-type(15)";
      await page.$eval(blockSelector, (block) => {
        const scroll = document.querySelector("#viewer-scroll");
        scroll.scrollTop += block.getBoundingClientRect().top - scroll.getBoundingClientRect().top;
      });
      const blockBefore = await scrollState(blockSelector);
      await setWrap(true);
      const blockAfter = await scrollState(blockSelector);
      expect(Math.abs(blockAfter.top - blockBefore.top)).toBeLessThanOrEqual(blockAfter.tolerance);

      await setWrap(false);
      await page.$eval("#viewer-scroll", (scroll) => {
        scroll.scrollTop = scroll.scrollHeight;
      });
      const eofBefore = await scrollState(".markdown-body section:last-child p:last-child");
      expect(eofBefore.endGap).toBeLessThanOrEqual(eofBefore.tolerance);
      await setWrap(true);
      const eofWrapped = await scrollState(".markdown-body section:last-child p:last-child");
      expect(eofWrapped.endGap).toBeLessThanOrEqual(eofWrapped.tolerance);
    },
    T,
  );

  test(
    "wrapped modified marks span the line and the gutter fits six digits",
    async () => {
      await openFile("src/wrapped-change.js");
      await page.waitForSelector(".line.hl-mod");
      await setWrap(true);
      const mark = await page.$eval(".line.hl-mod", (line) => {
        const lh = Number.parseFloat(getComputedStyle(line).lineHeight);
        const generated = getComputedStyle(line, "::after");
        return {
          rows: line.offsetHeight / lh,
          lineHeight: line.offsetHeight,
          markHeight: Number.parseFloat(generated.height),
          markContent: generated.content,
        };
      });
      expect(mark.rows).toBeGreaterThan(2);
      expect(mark.markContent).not.toBe("none");
      expect(Math.abs(mark.markHeight - mark.lineHeight)).toBeLessThanOrEqual(1);

      await openFile("src/util.py");
      await page.waitForSelector(".line.hl-del");
      await setWrap(true);
      const deletion = await page.$eval(".line.hl-del", (line) => ({
        bar: getComputedStyle(line, "::after").content,
        wedge: getComputedStyle(line, "::before").backgroundImage,
      }));
      expect(deletion.bar).toBe("none");
      expect(deletion.wedge).not.toBe("none");

      await openFile("docs/wide.txt");
      await page.waitForSelector(".shiki .line");
      await setWrap(true);
      const gutter = await page.$eval(".shiki .line", (line) => {
        const pre = line.closest(".shiki");
        const pseudo = getComputedStyle(line, "::before");
        const probe = document.createElement("span");
        probe.textContent = "100000";
        probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre";
        probe.style.font = getComputedStyle(pre).font;
        document.body.appendChild(probe);
        const digitWidth = probe.getBoundingClientRect().width;
        probe.remove();
        const numberWidth = Number.parseFloat(pseudo.width);
        const padding = Number.parseFloat(pseudo.paddingRight);
        const margin = Number.parseFloat(pseudo.marginRight);
        return {
          digitWidth,
          numberWidth,
          gutter: Number.parseFloat(getComputedStyle(pre).getPropertyValue("--code-gutter")),
          components: numberWidth + padding + margin,
          indent: Number.parseFloat(getComputedStyle(line).paddingLeft),
        };
      });
      expect(gutter.numberWidth + 0.5).toBeGreaterThanOrEqual(gutter.digitWidth);
      expect(Math.abs(gutter.gutter - gutter.components)).toBeLessThanOrEqual(1);
      expect(Math.abs(gutter.indent - gutter.gutter)).toBeLessThanOrEqual(1);
    },
    T,
  );

  test(
    "the chip is shown only where wrapping can change visible content",
    async () => {
      await openFile("docs/empty.txt");
      expect(await page.locator(".wrap-btn").isVisible()).toBe(false);

      await openFile("README.md");
      await page.waitForSelector(".markdown-body");
      expect(await page.locator(".wrap-btn").isVisible()).toBe(false);
      await page.click("#pane-header button:has-text('Raw')");
      await page.waitForSelector(".shiki .line");
      expect(await page.locator(".wrap-btn").isVisible()).toBe(true);

      await openFile("docs/guide.md");
      await page.waitForSelector(".markdown-body .shiki .line");
      expect(await page.locator(".wrap-btn").isVisible()).toBe(true);
    },
    T,
  );
});
