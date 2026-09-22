import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchBrowser, startFixtureServer } from "../fixture.js";

describe("Quartz-style Markdown links", () => {
  let srv, browser, page;
  const T = 30_000;

  beforeAll(async () => {
    const root = mkdtempSync(join(tmpdir(), "peruse-links-"));
    for (const dir of ["glossary", "roadmap", "guides", "empty", "assets"])
      mkdirSync(join(root, "knowledge", dir), { recursive: true });
    writeFileSync(join(root, "knowledge/index.md"), "# Knowledge\n\n[Empty](./empty/)\n");
    writeFileSync(
      join(root, "knowledge/glossary/a.md"),
      "# A\n\n" +
        "[Absolute B](/glossary/b.md)\n\n[Relative C](./c.md)\n\n" +
        "[Roadmap](/roadmap/)\n\n[Roadmap bare](/roadmap)\n\n" +
        "[Guides](../guides/)\n\n[Empty](../empty/)\n\n" +
        "[Extensionless B](/glossary/b)\n\n[Missing](/glossary/missing.md)\n\n" +
        "[C section](./c.md#section-two)\n\n[Query B](/glossary/b.md?v=1)\n\n" +
        "[Query C section](/glossary/c.md?v=1#section-two)\n\n" +
        "[Home](/)\n\n![Diagram](/assets/diagram.svg)\n\n" +
        "![Relative diagram](../assets/diagram.svg?v=1#shape)\n",
    );
    writeFileSync(join(root, "knowledge/glossary/b.md"), "# B\n");
    writeFileSync(
      join(root, "knowledge/glossary/c.md"),
      `# C\n\n${Array.from({ length: 45 }, (_, i) => `Before ${i + 1}.`).join("\n\n")}\n\n## Section Two\n\n${Array.from({ length: 35 }, (_, i) => `After ${i + 1}.`).join("\n\n")}\n`,
    );
    writeFileSync(join(root, "knowledge/roadmap/index.md"), "# Roadmap index\n");
    writeFileSync(join(root, "knowledge/guides/README.md"), "# Guides readme\n");
    writeFileSync(
      join(root, "knowledge/assets/diagram.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4"/></svg>',
    );
    srv = await startFixtureServer(root, 0, { portFixed: true });
    browser = await launchBrowser();
    page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await srv?.cleanup();
  });

  const open = async (path = "knowledge/glossary/a.md") => {
    await page.goto(`${srv.base}/#/${path}`);
    await page.waitForFunction(
      (expected) => document.querySelector("#pane-header .path")?.textContent === expected,
      path,
    );
  };
  const click = (name) =>
    page.locator(".markdown-body").getByRole("link", { name, exact: true }).click();
  const expectFile = async (path, title) => {
    await page.waitForFunction(
      (expected) => document.querySelector("#pane-header .path")?.textContent === expected,
      path,
      { timeout: 3000 },
    );
    expect(await page.evaluate(() => location.hash)).toBe(`#/${path}`);
    expect(await page.locator(".markdown-body h1").innerText()).toBe(title);
  };

  test(
    "absolute, relative, and extensionless links resolve through the tree",
    async () => {
      for (const [name, path, title] of [
        ["Absolute B", "knowledge/glossary/b.md", "B"],
        ["Relative C", "knowledge/glossary/c.md", "C"],
        ["Extensionless B", "knowledge/glossary/b.md", "B"],
      ]) {
        await open();
        await click(name);
        await expectFile(path, title);
      }
      await open();
      await click("Missing");
      await page.waitForFunction(() => location.hash.endsWith("/glossary/glossary/missing.md"));
      expect(await page.evaluate(() => location.hash)).toBe(
        "#/knowledge/glossary/glossary/missing.md",
      );
      await page.locator(".markdown-body").waitFor({ state: "detached", timeout: 3000 });
      expect(await page.locator(".markdown-body").count()).toBe(0);
    },
    T,
  );

  test(
    "directory links render index or README and select the expanded folder",
    async () => {
      for (const [name, path, title, folder] of [
        ["Roadmap", "knowledge/roadmap/index.md", "Roadmap index", "roadmap"],
        ["Roadmap bare", "knowledge/roadmap/index.md", "Roadmap index", "roadmap"],
        ["Guides", "knowledge/guides/README.md", "Guides readme", "guides"],
      ]) {
        await open();
        await click(name);
        await expectFile(path, title);
        const row = page.locator("#tree .row.selected").filter({ hasText: folder });
        expect(await row.count()).toBe(1);
        expect(await row.locator(".twist.open").count()).toBe(1);
      }
      await open();
      await click("Empty");
      const empty = page.locator("#tree .row.selected").filter({ hasText: "empty" });
      expect(await empty.count()).toBe(1);
      expect(await empty.locator(".twist.open").count()).toBe(1);
      expect(await page.locator(".markdown-body h1").innerText()).toBe("A");
      expect(await page.evaluate(() => location.hash)).toBe("#/knowledge/glossary/a.md");
    },
    T,
  );

  test(
    "a queried file link opens the file instead of a blank pane",
    async () => {
      await open();
      await click("Query B");
      await page.waitForFunction(() => location.hash !== "#/knowledge/glossary/a.md");
      expect(await page.evaluate(() => location.hash)).toBe("#/knowledge/glossary/b.md");
      await expectFile("knowledge/glossary/b.md", "B");
      await open();
      await click("Query C section");
      await expectFile("knowledge/glossary/c.md", "C");
      const top = await page.locator("h2#section-two").evaluate((element) => {
        const pane = document.querySelector("#viewer-scroll").getBoundingClientRect();
        return element.getBoundingClientRect().top - pane.top;
      });
      expect(top).toBeGreaterThanOrEqual(0);
      expect(top).toBeLessThanOrEqual(12);
    },
    T,
  );

  test(
    "the root link opens the content-root index",
    async () => {
      await open();
      await click("Home");
      await expectFile("knowledge/index.md", "Knowledge");
    },
    T,
  );

  test(
    "folder links highlight both the folder and open file, then clear on another file",
    async () => {
      await open();
      await click("Roadmap");
      await expectFile("knowledge/roadmap/index.md", "Roadmap index");
      expect(await page.locator("#tree .row.selected").filter({ hasText: "roadmap" }).count()).toBe(
        1,
      );
      expect(
        await page.locator("#tree .row.selected").filter({ hasText: "index.md" }).count(),
      ).toBe(1);
      await page.locator("#tree .row").filter({ hasText: "a.md" }).click();
      await expectFile("knowledge/glossary/a.md", "A");
      expect(await page.locator("#tree .row.selected").filter({ hasText: "roadmap" }).count()).toBe(
        0,
      );
      expect(await page.locator("#tree .row.selected").filter({ hasText: "a.md" }).count()).toBe(1);
    },
    T,
  );

  test(
    "a cross-file fragment scrolls within the new file without changing its route",
    async () => {
      await open();
      await click("C section");
      await expectFile("knowledge/glossary/c.md", "C");
      const top = await page.locator("h2#section-two").evaluate((element) => {
        const pane = document.querySelector("#viewer-scroll").getBoundingClientRect();
        return element.getBoundingClientRect().top - pane.top;
      });
      expect(top).toBeGreaterThanOrEqual(0);
      expect(top).toBeLessThanOrEqual(12);
    },
    T,
  );

  test(
    "a bundle-absolute image uses the same content-root resolution",
    async () => {
      await open();
      const img = page.locator('.markdown-body img[alt="Diagram"]');
      expect(await img.getAttribute("src")).toBe(
        `${new URL(srv.base).pathname}/raw/knowledge/assets/diagram.svg`,
      );
      await img.evaluate((element) => element.decode());
      expect(await img.evaluate((element) => element.naturalWidth)).toBe(4);
      const relative = page.locator('.markdown-body img[alt="Relative diagram"]');
      expect(await relative.getAttribute("src")).toBe(
        `${new URL(srv.base).pathname}/raw/knowledge/assets/diagram.svg?v=1#shape`,
      );
    },
    T,
  );
});
