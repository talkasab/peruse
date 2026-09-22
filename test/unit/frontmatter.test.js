import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { parseFrontmatter, renderFrontmatter, splitFrontmatter } from "../../web/lib.js";
import { createHTMLSanitizer } from "../../web/sanitize.js";

const fixture = (name) =>
  readFileSync(join(import.meta.dir, "../fixtures/frontmatter", name), "utf8");
const frontmatter = (name) => splitFrontmatter(fixture(name));
const card = (fm) => JSDOM.fragment(renderFrontmatter(fm).card).querySelector(".fm-card");
const allMarkup = (fm) => Object.values(renderFrontmatter(fm)).join("");

describe("structured YAML frontmatter", () => {
  test("top-level lists of maps move to ordered footers with per-key source ranges", () => {
    const fm = frontmatter("imaging-problem-list.md");
    const rendered = renderFrontmatter(fm);
    const header = JSDOM.fragment(rendered.card);
    const footers = JSDOM.fragment(rendered.footers);
    const rows = [...header.querySelectorAll(".fm-card > tbody > tr")];
    expect(rows).toHaveLength(7);
    expect(rows.map((row) => row.getAttribute("data-lines"))).toEqual([
      "2-2",
      "3-3",
      "4-4",
      "5-5",
      "6-6",
      "7-7",
      "8-8",
    ]);
    expect(header.querySelectorAll(".fm-nested-table")).toHaveLength(0);
    const jump = rows.at(-1).querySelector(".fm-jump");
    expect(jump.getAttribute("href")).toBe("#fm-sources");
    expect(jump.textContent).toBe("9 sources ↓");
    const footer = footers.querySelector(".fm-footer");
    expect(footer.id).toBe("fm-sources");
    expect(footer.getAttribute("data-lines")).toBe("8-35");
    expect(footer.querySelectorAll(".fm-nested-table tbody tr")).toHaveLength(9);

    const generic = splitFrontmatter(
      "---\ntitle: Generic\nevidence:\n  - id: first\n  - id: second\nreferences:\n  - url: https://example.test/\n---\n",
    );
    const genericRendered = renderFrontmatter(generic);
    const genericFooters = JSDOM.fragment(genericRendered.footers);
    expect([...genericFooters.querySelectorAll(".fm-footer")].map((item) => item.id)).toEqual([
      "fm-evidence",
      "fm-references",
    ]);
    expect(genericRendered.card).toContain('href="#fm-evidence"');
    expect(genericRendered.card).toContain('href="#fm-references"');

    const hostile = splitFrontmatter('---\n"<img src=x onerror=alert(1)>":\n  - id: safe\n---\n');
    const hostileMarkup = allMarkup(hostile);
    const hostileDOM = JSDOM.fragment(hostileMarkup);
    expect(hostileDOM.querySelectorAll("img")).toHaveLength(0);
    expect(hostileDOM.querySelector(".fm-footer-title").textContent).toBe(
      "<img src=x onerror=alert(1)>",
    );
    expect(hostileDOM.querySelector(".fm-jump").getAttribute("href")).toBe(
      `#fm-${encodeURIComponent("<img src=x onerror=alert(1)>")}`,
    );
  });

  test("invalid YAML keeps the line card and produces no footer", () => {
    const rendered = renderFrontmatter(frontmatter("invalid-yaml.md"));
    expect(rendered.footers).toBe("");
    const fallback = JSDOM.fragment(rendered.card).querySelector(".fm-card");
    expect(fallback.getAttribute("data-lines")).toBe("1-4");
    expect(fallback.querySelectorAll(":scope > tbody > tr")).toHaveLength(2);
  });

  test("one-item lists use a singular count and aliases share one footer", () => {
    const fm = splitFrontmatter(
      "---\nsources: &source_list\n  - id: only\nderived: *source_list\n---\n",
    );
    const rendered = renderFrontmatter(fm);
    const cardDOM = JSDOM.fragment(rendered.card);
    const footerDOM = JSDOM.fragment(rendered.footers);
    const jumps = [...cardDOM.querySelectorAll(".fm-jump")];
    expect(jumps.map((jump) => jump.textContent)).toEqual(["1 source ↓", "1 derived ↓"]);
    expect(jumps.map((jump) => jump.getAttribute("href"))).toEqual(["#fm-sources", "#fm-sources"]);
    expect(footerDOM.querySelectorAll(".fm-footer")).toHaveLength(1);
    expect(footerDOM.querySelectorAll(".fm-nested-table tbody tr")).toHaveLength(1);
  });

  test("OKF sample parses maps and lists and renders seven rows, four chips, nine sources", () => {
    const fm = frontmatter("imaging-problem-list.md");
    const data = parseFrontmatter(fm.source).data;
    expect(Object.keys(data)).toEqual([
      "type",
      "title",
      "description",
      "tags",
      "status",
      "generated",
      "sources",
    ]);
    expect(data.generated).toEqual({ by: "codex/gpt-6", at: "2026-09-21T20:34:50Z" });
    expect(data.tags).toHaveLength(4);
    expect(data.sources).toHaveLength(9);
    expect(data.sources[0].id).toBe("ipl-main");

    const element = card(fm);
    expect(element.querySelectorAll(":scope > tbody > tr")).toHaveLength(7);
    expect(element.querySelectorAll(".fm-chip")).toHaveLength(4);
    expect(element.querySelectorAll(".fm-nested-table tbody tr")).toHaveLength(0);
    const footer = JSDOM.fragment(renderFrontmatter(fm).footers);
    expect(footer.querySelectorAll(".fm-nested-table tbody tr")).toHaveLength(9);
    expect(
      [...footer.querySelectorAll(".fm-nested-table thead th")].map((th) => th.textContent),
    ).toEqual(["id", "resource", "title"]);
    expect(element.querySelectorAll(".fm-subcard tr")).toHaveLength(2);
    expect(element.querySelectorAll(".fm-raw")).toHaveLength(0);
    expect(footer.querySelectorAll('.fm-nested-table a[href^="https://"]')).toHaveLength(9);
    expect(element.getAttribute("data-lines")).toBeNull();
    expect(fm.body.split("\n")).toHaveLength(fixture("imaging-problem-list.md").split("\n").length);
  });

  test("flow map and sequence render their structure", () => {
    const map = frontmatter("flow-map.md");
    const sequence = frontmatter("flow-sequence.md");
    expect(parseFrontmatter(map.source).data.generated).toEqual({
      by: "codex/gpt-6",
      at: "2026-09-21T20:34:50Z",
    });
    expect(card(map).querySelectorAll(".fm-subcard tr")).toHaveLength(2);
    expect(parseFrontmatter(sequence.source).data.tags).toEqual([
      "data-structures",
      "imaging-problem-list",
      "fhir",
    ]);
    expect(card(sequence).querySelectorAll(".fm-chip")).toHaveLength(3);
  });

  test("list-of-map columns come from every item without filling missing keys", () => {
    const fm = splitFrontmatter("---\nsources:\n  - id: first\n  - constructor: second\n---\n");
    const table = JSDOM.fragment(renderFrontmatter(fm).footers).querySelector(".fm-nested-table");
    expect([...table.querySelectorAll("thead th")].map((cell) => cell.textContent)).toEqual([
      "id",
      "constructor",
    ]);
    const rows = [...table.querySelectorAll(":scope > tbody > tr")].map((row) =>
      [...row.querySelectorAll("td")].map((cell) => cell.textContent),
    );
    expect(rows).toEqual([
      ["first", ""],
      ["", "second"],
    ]);
  });

  test("folded scalar renders its folded text as a paragraph", () => {
    const fm = frontmatter("folded-scalar.md");
    expect(parseFrontmatter(fm.source).data.description).toBe(
      "First line of a folded description with a URL https://example.com/spec.",
    );
    expect(card(fm).querySelector(".fm-paragraph").textContent).toBe(
      "First line of a folded description with a URL https://example.com/spec.",
    );
  });

  test("invalid YAML, multiple documents, and non-map roots use raw fallback", () => {
    const invalid = frontmatter("invalid-yaml.md");
    expect(parseFrontmatter(invalid.source)).toBeNull();
    expect(card(invalid).querySelectorAll(":scope > tbody > tr")).toHaveLength(2);
    expect(card(invalid).querySelectorAll(":scope > tbody > tr")[1].textContent).toBe(
      "sources[one, two",
    );
    expect(parseFrontmatter("a: 1\n---\nb: 2")).toBeNull();
    const sequenceRoot = "- one\n- two";
    expect(parseFrontmatter(sequenceRoot)).toBeNull();
    expect(
      card(splitFrontmatter(`---\n${sequenceRoot}\n---\n`)).querySelectorAll(".fm-raw").length,
    ).toBeGreaterThan(0);
  });

  test("frontmatter-only file retains a card and line accounting", () => {
    const content = fixture("frontmatter-only.md");
    const fm = splitFrontmatter(content);
    expect(fm.body.trim()).toBe("");
    expect(fm.body.split("\n")).toHaveLength(content.split("\n").length);
    expect(card(fm).querySelectorAll(":scope > tbody > tr")).toHaveLength(2);
    expect(card(fm).querySelectorAll(".fm-chip")).toHaveLength(2);
  });

  test("hostile keys, values, chips, headers, and block scalars stay escaped", () => {
    const payload = "<img src=x onerror=alert(1)>";
    const escaped = "&lt;img src=x onerror=alert(1)&gt;";
    const fm = frontmatter("hostile.md");
    const rendered = allMarkup(fm);
    expect(rendered).toContain(`<th>${escaped}</th><td>${escaped}</td>`);
    expect(rendered).toContain(`<span class="fm-chip">${escaped}</span>`);
    expect(rendered).toContain(`<th>${escaped}</th><th>id</th>`);
    expect(rendered).toContain(`<td>${escaped}</td>`);
    expect(rendered).toContain(`<p class="fm-paragraph">${escaped}\n  "quoted" 'literal'</p>`);
    expect(rendered).toContain(`<p class="fm-paragraph">${escaped} "quoted" 'folded'</p>`);
    expect(rendered).toContain('<span class="fm-chip">quote " and \'</span>');
    expect(rendered).not.toContain(payload);

    const sanitizer = createHTMLSanitizer(new JSDOM("").window);
    const sanitized = JSDOM.fragment(sanitizer(rendered));
    expect(sanitized.querySelectorAll("img, script, iframe")).toHaveLength(0);
    expect(sanitized.textContent).toContain(payload);
  });

  test("only HTTP(S) scalars become links and quoted hrefs stay in one attribute", () => {
    const rendered = allMarkup(frontmatter("hostile.md"));
    expect(rendered).toContain('href="https://example.test/a&quot;b\'c"');
    const links = [...JSDOM.fragment(rendered).querySelectorAll('a[href^="http"]')];
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "https://example.test/a\"b'c",
      "http://example.test/ok",
    ]);
    for (const scheme of ["javascript:", "data:", "vbscript:", "//example.test/unsafe"])
      expect(rendered).toContain(scheme);
    expect(links.every((link) => /^https?:\/\//.test(link.getAttribute("href")))).toBe(true);
  });

  test("a very long scalar stays escaped and readable", () => {
    const long = "x".repeat(5000);
    const fm = splitFrontmatter(`---\nlong: ${long}<img src=x onerror=alert(1)>\n---\n`);
    const rendered = allMarkup(fm);
    expect(rendered).toContain(`${long}&lt;img src=x onerror=alert(1)&gt;`);
    expect(JSDOM.fragment(rendered).querySelectorAll("img")).toHaveLength(0);
    expect(card(fm).querySelector("td").textContent).toBe(`${long}<img src=x onerror=alert(1)>`);
  });

  test("empty collections leave their cells empty and null differs from quoted null", () => {
    const fm = splitFrontmatter(
      "---\nempty_list: []\nempty_map: {}\nstale_after:\nquoted_null: 'null'\n---\n",
    );
    const cells = [...card(fm).querySelectorAll(":scope > tbody > tr > td")];
    expect(cells[0].innerHTML).toBe("");
    expect(cells[1].innerHTML).toBe("");
    expect(cells[2].innerHTML).toBe('<span class="fm-null" title="null">—</span>');
    expect(cells[3].textContent).toBe("null");
  });

  test("an aliased block scalar keeps paragraph rendering", () => {
    const fm = splitFrontmatter(
      "---\noriginal: &details |-\n  first line\n    indented line\ncopy: *details\n---\n",
    );
    const paragraphs = [...card(fm).querySelectorAll(".fm-paragraph")];
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs.map((item) => item.textContent)).toEqual([
      "first line\n  indented line",
      "first line\n  indented line",
    ]);
  });

  test("sentence punctuation stays outside a URL link", () => {
    const fm = splitFrontmatter("---\nresource: https://example.test/spec.\n---\n");
    const value = card(fm).querySelector("td");
    expect(value.querySelector("a").getAttribute("href")).toBe("https://example.test/spec");
    expect(value.textContent).toBe("https://example.test/spec.");
    expect(value.innerHTML).toBe(
      '<a href="https://example.test/spec" target="_blank" rel="noopener">https://example.test/spec</a>.',
    );
  });
});
