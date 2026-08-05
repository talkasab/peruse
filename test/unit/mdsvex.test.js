// The mdsvex composite grammar (web/langs/mdsvex.js). The acceptance question
// for a `.svx` code view is not "does it produce tokens" but "is each region
// visually distinguishable" — so these tests MEASURE distinct token colors per
// region under both Catppuccin themes rather than spot-checking scope names.
import { describe, expect, test } from "bun:test";
import langCss from "@shikijs/langs/css";
import langJs from "@shikijs/langs/javascript";
import langMd from "@shikijs/langs/markdown";
import langScss from "@shikijs/langs/scss";
import langSvelte from "@shikijs/langs/svelte";
import langToml from "@shikijs/langs/toml";
import langTs from "@shikijs/langs/typescript";
import langYaml from "@shikijs/langs/yaml";
import latte from "@shikijs/themes/catppuccin-latte";
import mocha from "@shikijs/themes/catppuccin-mocha";
import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import langMdsvex from "../../web/langs/mdsvex.js";
import { DEEP_SVX, POST_SVX_BASE, STYLE_LANGS_SVX, TOML_SVX } from "../fixture.js";

const THEMES = { "catppuccin-latte": latte, "catppuccin-mocha": mocha };
const highlighter = await createHighlighterCore({
  themes: Object.values(THEMES),
  // The same grammars web/app.js loads that mdsvex reaches into. `svelte`
  // itself supplies javascript/typescript/css/postcss.
  langs: [langMd, langYaml, langToml, langSvelte, langCss, langScss, langTs, langJs, langMdsvex],
  engine: createJavaScriptRegexEngine({ forgiving: true }),
});

const SOURCE_LINES = POST_SVX_BASE.split("\n");

/** Inclusive 0-based line span whose first line contains `from` and last `to`. */
function span(from, to) {
  const start = SOURCE_LINES.findIndex((l) => l.includes(from));
  const end = SOURCE_LINES.findIndex((l, i) => i >= start && l.includes(to));
  if (start < 0 || end < 0) throw new Error(`fixture no longer contains ${from} / ${to}`);
  return [start, end];
}

const REGIONS = {
  frontmatter: span("title: Release Notes", "- mdsvex"),
  script: span("import Callout", "const items:"),
  heading: span("# Release {version}", "# Release {version}"),
  prose: span("Prose with **bold**", "- bullet two"),
  component: span("<Callout kind=", "<Callout kind="),
  controlFlow: span("{#if items.length}", "{/if}"),
  rawHtmlTag: span("{@html", "{@html"),
  fence: span("const answer = 42;", "const answer = 42;"),
  style: span(".callout { color:", ".callout { color:"),
};

/** Distinct colors over the non-blank tokens of an inclusive line span. */
function colorsIn(tokenLines, [start, end]) {
  const colors = new Set();
  for (const line of tokenLines.slice(start, end + 1))
    for (const token of line) if (token.content.trim()) colors.add(token.color);
  return colors;
}

for (const [themeName, theme] of Object.entries(THEMES)) {
  describe(`mdsvex grammar under ${themeName}`, () => {
    const { tokens, fg } = highlighter.codeToTokens(POST_SVX_BASE, {
      lang: "mdsvex",
      theme: themeName,
    });

    // A code view must show the file, not an interpretation of it — and line
    // numbers and git gutter marks are positional, so a dropped or added line
    // would silently misalign every mark below it.
    test("reproduces the source byte for byte, line for line", () => {
      const rebuilt = tokens.map((line) => line.map((t) => t.content).join("")).join("\n");
      expect(rebuilt).toBe(POST_SVX_BASE);
      expect(tokens.length).toBe(SOURCE_LINES.length);
    });

    // The failure this guards is the one both single-grammar options produce:
    // a region tokenized but left entirely at the default foreground, i.e.
    // "highlighted" on paper and plain on screen.
    test.each(Object.keys(REGIONS))("%s is coloured, not plain", (name) => {
      const colors = colorsIn(tokens, REGIONS[name]);
      expect(colors.size).toBeGreaterThan(1);
      expect([...colors].some((c) => c !== fg && c !== theme.fg)).toBe(true);
    });

    // "Coloured" alone would still allow every region to look alike, which is
    // exactly what mapping `.svx` to one grammar produces.
    test("no two regions share the same palette", () => {
      const palettes = Object.entries(REGIONS).map(([name, sp]) => [
        name,
        [...colorsIn(tokens, sp)].sort().join(","),
      ]);
      expect(new Set(palettes.map(([, p]) => p)).size).toBe(palettes.length);
    });

    test("TOML frontmatter has distinct key, punctuation, and value colours", () => {
      const { tokens: tomlTokens } = highlighter.codeToTokens(TOML_SVX, {
        lang: "mdsvex",
        theme: themeName,
      });
      const title = TOML_SVX.split("\n").findIndex((line) => line.startsWith("title"));
      const colors = new Set(
        tomlTokens[title].filter((token) => token.content.trim()).map((token) => token.color),
      );
      expect(colors.size).toBeGreaterThan(1);
    });
  });
}

describe("mdsvex grammar details", () => {
  // Scope stack covering the first occurrence of `needle` on the first line
  // containing `on`. Located by column, not by token text: grammars split
  // tokens where they like (YAML yields "t" + "itle" for a key).
  const scopesAt = (code, on, needle) => {
    const grammar = highlighter.getLanguage("mdsvex");
    let stack = null;
    for (const line of code.split("\n")) {
      const { tokens, ruleStack } = grammar.tokenizeLine(line, stack);
      stack = ruleStack;
      if (!line.includes(on)) continue;
      const col = line.indexOf(needle);
      const hit = tokens.find((t) => t.startIndex <= col && col < t.endIndex);
      if (hit) return hit.scopes.join(" ");
    }
    throw new Error(`no token at ${JSON.stringify(needle)} on a line containing ${on}`);
  };

  test("script and style bodies reach their embedded language", () => {
    expect(scopesAt(POST_SVX_BASE, "const items:", "const")).toContain("source.ts");
    expect(scopesAt(POST_SVX_BASE, ".callout {", "color")).toContain("source.css");
  });

  test("only the eagerly loaded style languages are colorized", () => {
    for (const themeName of Object.keys(THEMES)) {
      const { tokens, fg } = highlighter.codeToTokens(STYLE_LANGS_SVX, {
        lang: "mdsvex",
        theme: themeName,
      });
      const lineColors = (marker) => {
        const line = tokens[STYLE_LANGS_SVX.split("\n").findIndex((text) => text.includes(marker))];
        return new Set(line.filter((token) => token.content.trim()).map((token) => token.color));
      };

      for (const marker of [".css", "$tone", ".postcss"])
        expect(lineColors(marker).size).toBeGreaterThan(1);
      const lessColors = lineColors(".less");
      expect(lessColors.size).toBe(1);
      expect([...lessColors][0].toLowerCase()).toBe(fg.toLowerCase());
    }
    expect(scopesAt(STYLE_LANGS_SVX, "# Styles", "theme")).toContain(
      "meta.embedded.expression.svelte",
    );
    expect(scopesAt(STYLE_LANGS_SVX, "<Widget", "Widget")).toContain("meta.tag.start.svelte");
  });

  test("frontmatter is YAML, not prose", () => {
    expect(scopesAt(POST_SVX_BASE, "title: Release", "title")).toContain("entity.name.tag.yaml");
  });

  test("TOML frontmatter reaches the TOML grammar", () => {
    expect(scopesAt(TOML_SVX, "title =", "title")).toContain("variable.other.key.toml");
  });

  test("URL and email autolinks remain Markdown links, not Svelte tags", () => {
    const url = scopesAt(POST_SVX_BASE, "Autolinks:", "https");
    const email = scopesAt(POST_SVX_BASE, "Autolinks:", "a@example");
    expect(url).toContain("meta.link.inet.markdown");
    expect(email).toContain("meta.link.email.lt-gt.markdown");
    expect(url).not.toContain("meta.tag.start.svelte");
    expect(email).not.toContain("meta.tag.start.svelte");
  });

  test("single-letter, anchor, multiline, and deeply nested real tags stay Svelte", () => {
    expect(scopesAt(POST_SVX_BASE, "<Callout kind=", "Callout")).toContain("meta.tag.start.svelte");
    expect(scopesAt(POST_SVX_BASE, "  answer=", "answer")).toContain(
      "entity.other.attribute-name.svelte",
    );
    expect(scopesAt('<a href="/">link</a>\n', "<a href", "href")).toContain(
      "entity.other.attribute-name.svelte",
    );
    const rebuilt = highlighter
      .codeToTokens(DEEP_SVX, { lang: "mdsvex", theme: "catppuccin-latte" })
      .tokens.map((line) => line.map((token) => token.content).join(""))
      .join("\n");
    expect(rebuilt).toBe(DEEP_SVX);
    expect(scopesAt(DEEP_SVX, DEEP_SVX.slice(0, 20), "X")).toContain("meta.tag.start.svelte");
  });

  test("mustaches inside prose are Svelte expressions", () => {
    // Markdown's paragraph rule owns continuation lines, so nothing but an
    // injection can reach inside prose — this is the assertion that fails if
    // the Svelte rules are demoted to ordinary top-level patterns.
    expect(scopesAt("Prices are {formatMoney(total)} today.\n", "Prices are", "{")).toContain(
      "punctuation.section.embedded.begin.svelte",
    );
  });

  test("braces inside a fence stay code, not mustaches", () => {
    const fenced = "```js\nif (a) { b(); }\n```\n";
    expect(scopesAt(fenced, "if (a)", "{")).not.toContain("embedded.expression.svelte");
    expect(scopesAt(fenced, "if (a)", "if")).toContain("meta.embedded.block.javascript");
  });

  test("a bare `<` in prose does not swallow the paragraph", () => {
    // Svelte's tag rule accepts an empty tag name, so `a < b` would open a tag
    // scope and repaint the rest of the line as attributes.
    const line = "compare a < b and 5 > 3 here\n";
    const { tokens } = highlighter.codeToTokens(line, {
      lang: "mdsvex",
      theme: "catppuccin-latte",
    });
    const colors = new Set(tokens[0].filter((t) => t.content.trim()).map((t) => t.color));
    expect(colors.size).toBe(1);
  });
});
