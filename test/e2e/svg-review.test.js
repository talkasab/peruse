import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

import { launchBrowser, makePlainDir, startFixtureServer } from "../fixture.js";

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  const result = Buffer.alloc(8 + data.length + 4);
  result.writeUInt32BE(data.length, 0);
  body.copy(result, 4);
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 8 + data.length);
  return result;
}

function png(width) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  const pixels = Buffer.alloc(1 + width * 4);
  for (let x = 0; x < width; x++) {
    pixels[1 + x * 4] = 255;
    pixels[1 + x * 4 + 3] = 255;
  }
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

test("raster image refreshes when its bytes change", async () => {
  const root = makePlainDir();
  const path = join(root, "pic.png");
  writeFileSync(path, png(20));
  let server, browser;
  try {
    server = await startFixtureServer(root, 0, { portFixed: true });
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.goto(`${server.base}/#/pic.png`);
    const image = page.locator("#viewer .image-view img");
    await page.waitForFunction(() => document.querySelector("#viewer img")?.naturalWidth === 20);
    const before = await image.getAttribute("src");
    writeFileSync(path, png(40));
    await page.waitForFunction(
      () => document.querySelector("#viewer img")?.naturalWidth === 40,
      undefined,
      { timeout: 8_000 },
    );
    expect(await image.getAttribute("src")).not.toBe(before);
  } finally {
    await browser?.close();
    await server?.cleanup();
  }
}, 20_000);

test("invalid SVG opens its source while binary SVG keeps the download card", async () => {
  const root = makePlainDir();
  writeFileSync(join(root, "empty.svg"), "");
  writeFileSync(join(root, "notxml.svg"), "This is plain text");
  writeFileSync(join(root, "binary.svg"), Buffer.from([0, 1, 2]));
  let server, browser;
  try {
    server = await startFixtureServer(root, 0, { portFixed: true });
    browser = await launchBrowser();
    const page = await browser.newPage();
    for (const name of ["empty.svg", "notxml.svg"]) {
      await page.goto(`${server.base}/#/${name}`);
      if (name === "notxml.svg") await page.getByText("This is plain text").waitFor();
      await page
        .locator("#viewer .notice")
        .getByText("SVG preview unavailable; showing source")
        .waitFor();
      expect(await page.locator("#viewer .image-view").count()).toBe(0);
      expect(await page.getByRole("button", { name: "Rendered" }).count()).toBe(1);
    }
    expect(await page.locator("#viewer").innerText()).toContain("This is plain text");
    await page.goto(`${server.base}/#/binary.svg`);
    await page.locator("#viewer .file-card").waitFor();
    expect(await page.locator("#viewer .file-card a[download]").count()).toBe(1);
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll("button")].every(
          (button) =>
            button.textContent?.trim() !== "Source" || button.getClientRects().length === 0,
        ),
      undefined,
      { timeout: 3_000 },
    );
    expect(await page.getByRole("button", { name: "Source" }).count()).toBe(0);
  } finally {
    await browser?.close();
    await server?.cleanup();
  }
}, 20_000);
