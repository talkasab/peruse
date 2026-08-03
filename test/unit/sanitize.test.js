import { describe, expect, test } from "bun:test";
import langJs from "@shikijs/langs/javascript";
import latte from "@shikijs/themes/catppuccin-latte";
import mocha from "@shikijs/themes/catppuccin-mocha";
import { JSDOM } from "jsdom";
import MarkdownIt from "markdown-it";
import anchor from "markdown-it-anchor";
import footnote from "markdown-it-footnote";
import taskLists from "markdown-it-task-lists";
import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { createHTMLSanitizer } from "../../web/sanitize.js";

const window = new JSDOM("").window;
const sanitizeHTML = createHTMLSanitizer(window);
const md = new MarkdownIt({ html: true, linkify: true }).use(taskLists).use(anchor).use(footnote);
const highlighter = await createHighlighterCore({
  themes: [latte, mocha],
  langs: [langJs],
  engine: createJavaScriptRegexEngine({ forgiving: true }),
});

describe("rendered HTML sanitization", () => {
  test("neutralizes active HTML and Alpine directives from Markdown", () => {
    const rendered = md.render(`
<img src=x onerror="globalThis.exploited = true">

<script>globalThis.exploited = true</script>

<svg onload="globalThis.exploited = true"></svg>

<div x-init="globalThis.exploited = true" @click="globalThis.exploited = true" :class="globalThis.exploited = true" x-bind:title="globalThis.exploited = true">safe text</div>

<iframe srcdoc="<script>globalThis.exploited = true</script>"></iframe>
<object data="javascript:alert(1)"></object>
<embed src="javascript:alert(1)">

<a href="javascript:alert(1)">unsafe link</a>
`);
    const clean = sanitizeHTML(rendered);
    const document = new JSDOM(clean).window.document;

    expect(document.querySelector("img").hasAttribute("onerror")).toBe(false);
    expect(document.querySelector("svg").hasAttribute("onload")).toBe(false);
    expect(document.querySelectorAll("script, iframe, object, embed")).toHaveLength(0);
    expect(document.querySelector("a").hasAttribute("href")).toBe(false);
    const div = document.querySelector("div");
    expect([...div.attributes].map((attr) => attr.name)).not.toContain("x-init");
    expect([...div.attributes].map((attr) => attr.name)).not.toContain("@click");
    expect([...div.attributes].map((attr) => attr.name)).not.toContain(":class");
    expect([...div.attributes].map((attr) => attr.name)).not.toContain("x-bind:title");
    expect(div.textContent).toBe("safe text");
  });

  test("preserves legitimate Markdown HTML and generated markup unchanged", () => {
    const rendered =
      md.render(`# Heading

- [x] complete

Footnote[^1]

[^1]: note

<details><summary>More</summary><kbd>Ctrl</kbd>+<kbd>K</kbd><sub>sub</sub><sup>sup</sup><br><a href="https://example.com"><img src="badge.svg" width="120" height="20" align="left"></a><div align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="dark.png"><img src="light.png"></picture></div><a name="named-anchor"></a></details>
`) +
      highlighter.codeToHtml("const answer = 42;", {
        lang: "javascript",
        themes: { light: "catppuccin-latte", dark: "catppuccin-mocha" },
        defaultColor: false,
      });

    const clean = sanitizeHTML(rendered);
    expect(clean).toBe(rendered);

    const document = new JSDOM(clean).window.document;
    const checkbox = document.querySelector('input[type="checkbox"]');
    expect(checkbox.disabled).toBe(true);
    expect(checkbox.checked).toBe(true);
    expect(document.querySelector("h1").id).toBe("heading");
    expect(document.querySelector(".footnote-ref a").getAttribute("href")).toBe("#fn1");
    expect(document.querySelector(".footnote-backref").getAttribute("href")).toBe("#fnref1");
    expect(document.querySelector(".shiki .line span").getAttribute("style")).toContain(
      "--shiki-light:",
    );
  });

  test("markdown-it already rejects javascript links", () => {
    const rendered = md.render("[unsafe](javascript:alert(1))");
    expect(rendered).not.toContain("href=");
    expect(rendered).toContain("[unsafe](javascript:alert(1))");
  });
});
