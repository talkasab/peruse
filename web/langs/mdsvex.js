// mdsvex (`.svx`) is Markdown with Svelte mixed in: YAML/TOML frontmatter, ordinary
// prose and fences, and — at any point, block or inline — Svelte tags, blocks
// and `{expression}` mustaches. Shiki ships no mdsvex grammar, and neither
// bundled grammar alone is close: `svelte` renders all prose as plain text (and
// misreads `{` inside fences as a mustache), while `markdown` renders every
// Svelte construct as plain text.
//
// So this is a thin composite over the bundled grammars. Most rules are
// `include`s; the two local rules recognize TOML's `+++` frontmatter delimiter
// and protect prose comparisons from Svelte's empty-name tag match.

import langSvelte from "@shikijs/langs/svelte";

const svelte = langSvelte.find((g) => g.scopeName === "source.svelte");

// `<script>`/`<style>` bodies are highlighted by injections that the Svelte
// grammar carries on itself, keyed off the `meta.script.svelte` /
// `meta.lang.<x>.svelte` scopes that `#tags-lang` produces. A grammar's own
// injections only run when that grammar is the tokenization root, so with
// `source.mdsvex` as the root they would never fire — mdsvex has to re-declare
// them. They are reused verbatim rather than reimplemented. With the app's
// deliberately small eager grammar set this colorizes CSS, SCSS, and PostCSS;
// other style `lang` values remain plain inside an otherwise highlighted file.
// The Svelte-store `$name` punctuation injection is deliberately left out: it
// selects on bare `source.ts`/`source.js`, so it would also repaint `$` inside
// ordinary Markdown ```js fences, where it means nothing.
const embeddedBodies = Object.fromEntries(
  Object.entries(svelte?.injections ?? {}).filter(([selector]) =>
    /meta\.(script|style)\.svelte/.test(selector),
  ),
);

/** @type {import("@shikijs/types").LanguageRegistration[]} */
export default [
  {
    name: "mdsvex",
    scopeName: "source.mdsvex",
    displayName: "mdsvex",
    aliases: ["svx"],
    // Plain Markdown. Everything Svelte arrives through the injection below,
    // which outranks these rules wherever the two overlap.
    patterns: [
      { include: "#tomlFrontMatter" },
      { include: "text.html.markdown#frontMatter" },
      { include: "text.html.markdown#block" },
    ],
    repository: {
      // Markdown's bundled frontmatter rule recognizes only `---` YAML.
      // Mirror its begin/while shape for mdsvex's `+++` TOML form so source
      // lines and delimiter scopes stay identical to the YAML path.
      tomlFrontMatter: {
        applyEndPatternLast: true,
        begin: "\\A(?=(\\+{3,})[\\t ]*$)",
        end: "^(?: {0,3}\\1\\+*[\\t ]*)$",
        endCaptures: { 0: { name: "punctuation.definition.end.frontmatter" } },
        patterns: [
          {
            begin: "\\A(\\+{3,})(.*)$",
            beginCaptures: {
              1: { name: "punctuation.definition.begin.frontmatter" },
              2: { name: "comment.frontmatter" },
            },
            contentName: "meta.embedded.block.frontmatter.toml",
            patterns: [{ include: "source.toml" }],
            while: "^(?!(?: {0,3}\\1\\+*[\\t ]*)$)",
          },
        ],
      },
    },
    injections: embeddedBodies,
  },
  {
    // Svelte constructs appear inside prose, not only between blocks, and
    // Markdown's paragraph rule is a begin/while that owns every continuation
    // line: a rule listed alongside `text.html.markdown#block` never gets a
    // look at a paragraph's interior. An injection does, and `L:` gives it
    // priority over the Markdown rules it overlaps.
    name: "mdsvex-svelte-injection",
    scopeName: "svelte.mdsvex.injection",
    displayName: "mdsvex (Svelte injection)",
    injectTo: ["source.mdsvex"],
    injectionSelector:
      "L:source.mdsvex" +
      // literal text, or already handled: fences, inline code, frontmatter,
      // script/style bodies, mustache interiors
      " -markup.raw -markup.fenced_code -meta.embedded -string -comment" +
      // every scope the rules below push, so the injection cannot re-enter its
      // own captures at the same position and recurse until the stack blows
      " -meta.tag -meta.scope.tag -meta.special -meta.script -meta.style -meta.template",
    patterns: [
      { include: "source.svelte#comments" },
      // Before the generic tag rules: only `#tags-lang` stamps the
      // `meta.script.svelte` / `meta.lang.<x>.svelte` scopes the body
      // injections select on. The generic rule would match `<script` first and
      // leave the body as Markdown paragraph text.
      { include: "source.svelte#tags-lang" },
      { include: "source.svelte#special-tags" },
      // The injection outranks Markdown's paragraph rules, so explicitly
      // delegate angle-bracket URL/email autolinks back to Markdown before a
      // generic Svelte tag can claim their leading `<`.
      { include: "text.html.markdown#link-inet" },
      { include: "text.html.markdown#link-email" },
      // Svelte's tag rule matches a bare `<` with an empty tag name, which in a
      // `.svelte` file is fine and in prose is not: `a < b and 5 > 3` would be
      // swallowed as a tag hunting for its `>`. Claim those as plain text.
      { match: "<(?![A-Za-z!/])" },
      { include: "source.svelte#tags-void" },
      { include: "source.svelte#tags-general-end" },
      { include: "source.svelte#tags-general-start" },
      { include: "source.svelte#interpolation" },
    ],
    repository: {},
  },
];
