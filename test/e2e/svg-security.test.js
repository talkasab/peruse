import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { launchBrowser, makePlainDir, startFixtureServer } from "../fixture.js";

const wrap = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="24" height="24"><rect width="24" height="24" fill="red"/>${body}</svg>`;

async function securityFixture() {
  const hits = [];
  const beacon = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      hits.push(new URL(request.url).pathname);
      return new Response("ok");
    },
  });
  const origin = `http://127.0.0.1:${beacon.port}`;
  const marker = (name) => `${origin}/${name}`;
  const vectors = {
    script: `<script>fetch('${marker("script")}');alert('SVG_SCRIPT_RAN')</script>`,
    onload: `<g onload="fetch('${marker("child-onload")}');alert('SVG_CHILD_ONLOAD')"/>`,
    foreign: `<foreignObject width="20" height="20"><div xmlns="http://www.w3.org/1999/xhtml"><script>fetch('${marker("foreign-script")}');alert('SVG_FOREIGN')</script><img src="${marker("foreign-img")}"/></div></foreignObject>`,
    image: `<image href="${marker("image-href")}" xlink:href="${marker("image-xlink")}" width="20" height="20"/>`,
    css: `<style>@import url('${marker("css-import")}');</style>`,
    use: `<use href="${marker("use")}#target"/>`,
    font: `<style>@font-face { font-family: hostile; src: url('${marker("font")}'); } text { font-family: hostile; }</style><text y="20">x</text>`,
  };
  const root = makePlainDir();
  for (const [name, body] of Object.entries(vectors)) {
    const svg =
      name === "onload"
        ? wrap(body).replace(
            'width="24"',
            `onload="fetch('${marker("root-onload")}');alert('SVG_ROOT_ONLOAD')" width="24"`,
          )
        : wrap(body);
    writeFileSync(join(root, `${name}.svg`), svg);
  }
  return { root, hits, beacon, vectors };
}

test("top-level raw SVG cannot run script or contact a beacon, while embedded image renders", async () => {
  const fixture = await securityFixture();
  let server, browser;
  try {
    server = await startFixtureServer(fixture.root, 0, { portFixed: true });
    browser = await launchBrowser();
    const page = await browser.newPage();
    const dialogs = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await page.goto(`${server.base}/raw/script.svg`);
    await page.waitForTimeout(200);
    expect(dialogs).toEqual([]);
    expect(fixture.hits).toEqual([]);
    await page.goto(`${server.base}/#/script.svg`);
    await page.waitForFunction(() => document.querySelector("#viewer img")?.naturalWidth === 24);
    expect(dialogs).toEqual([]);
    expect(fixture.hits).toEqual([]);
  } finally {
    await browser?.close();
    await server?.cleanup();
    fixture.beacon.stop();
  }
}, 20_000);

test("all seven hostile SVG vectors stay inert in the rendered view", async () => {
  const fixture = await securityFixture();
  let server, browser;
  try {
    server = await startFixtureServer(fixture.root, 0, { portFixed: true });
    browser = await launchBrowser();
    const page = await browser.newPage();
    const dialogs = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    for (const name of Object.keys(fixture.vectors)) {
      await page.goto(`${server.base}/#/${name}.svg`);
      await page.waitForFunction(() => document.querySelector("#viewer img")?.naturalWidth === 24);
      await page.waitForTimeout(100);
      expect({ name, dialogs, hits: fixture.hits }).toEqual({ name, dialogs: [], hits: [] });
      expect(await page.locator("#viewer svg, #viewer script, #viewer foreignObject").count()).toBe(
        0,
      );
    }
  } finally {
    await browser?.close();
    await server?.cleanup();
    fixture.beacon.stop();
  }
}, 30_000);
