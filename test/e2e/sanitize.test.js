import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { startServer } from "../../server/index.js";

const T = 60_000;

test("hostile Markdown is inert while supported rendering survives", async () => {
  const root = mkdtempSync(join(tmpdir(), "peruse-sanitize-e2e-"));
  writeFileSync(join(root, "secret.env"), "AWS_SECRET_ACCESS_KEY=hunter2\n");
  writeFileSync(join(root, "README.md"), `# Project

<img src=x onerror="window.__pwned=true;fetch('/raw/secret.env').then(r=>r.text()).then(t=>{window.__exfil=t.trim()})">
<!-- SVG onload is retained as a sanitization input, but was not observed to
execute before the fix and is therefore not used as a positive control. -->
<svg onload="window.__svgProbe=true"></svg>
<div x-init="window.__alpine=true">alpine probe</div>

<details><summary>Details work</summary>body text</details>

Press <kbd>Ctrl</kbd>, H<sub>2</sub>O, x<sup>2</sup>.

- [ ] unchecked
- [x] checked

\`\`\`python
def hello(): return 1
\`\`\`

| a | b |
|---|---|
| 1 | 2 |
`);

  let srv, browser;
  const pageErrors = [];
  try {
    srv = await startServer({
      root, port: 0, host: "127.0.0.1", portFixed: true, watchBudget: 100,
    });
    await srv.ready;
    browser = await chromium.launch({
      executablePath: process.env.PERUSE_CHROMIUM || undefined,
      args: ["--no-sandbox"],
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on("pageerror", (error) => pageErrors.push(error.message));

    // A new page and full navigation make this independent of the shared-page
    // hashchange race tracked separately from the #23 regression.
    await page.goto(`http://127.0.0.1:${srv.port}/#/README.md`, { timeout: 15_000 });
    await page.waitForSelector(".markdown-body", { timeout: 15_000 });
    await page.waitForTimeout(1_500);

    const result = await page.evaluate(() => ({
      pwned: window.__pwned === true,
      alpine: window.__alpine === true,
      exfil: window.__exfil ?? null,
      liveAttributes: document.querySelectorAll("[onerror], [onload], [x-init]").length,
      details: document.querySelector("details summary")?.textContent ?? null,
      kbd: document.querySelectorAll("kbd").length,
      sub: document.querySelectorAll("sub").length,
      sup: document.querySelectorAll("sup").length,
      tables: document.querySelectorAll(".markdown-body table").length,
      checkboxes: document.querySelectorAll('.markdown-body input[type="checkbox"]').length,
      disabledCheckboxes:
        document.querySelectorAll('.markdown-body input[type="checkbox"]:disabled').length,
      checkedCheckboxes:
        document.querySelectorAll('.markdown-body input[type="checkbox"]:checked').length,
      shikiTokens: document.querySelectorAll(".markdown-body .shiki span[style]").length,
    }));

    expect(result.pwned).toBe(false);
    expect(result.alpine).toBe(false);
    expect(result.exfil).toBeNull();
    expect(result.liveAttributes).toBe(0);

    expect(result.details).toBe("Details work");
    expect(result.kbd).toBe(1);
    expect(result.sub).toBe(1);
    expect(result.sup).toBe(1);
    expect(result.tables).toBe(1);
    expect(result.checkboxes).toBe(2);
    expect(result.disabledCheckboxes).toBe(2);
    expect(result.checkedCheckboxes).toBe(1);
    expect(result.shikiTokens).toBeGreaterThan(0);
    expect(pageErrors).toEqual([]);
  } finally {
    await browser?.close();
    await srv?.stop();
    rmSync(root, { recursive: true, force: true });
  }
}, T);
