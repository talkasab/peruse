// peruse client: tree + viewer + inline hunk diffs + SSE live updates.

import langC from "@shikijs/langs/c";
import langCpp from "@shikijs/langs/cpp";
import langCsharp from "@shikijs/langs/csharp";
import langCss from "@shikijs/langs/css";
import langDiff from "@shikijs/langs/diff";
import langDocker from "@shikijs/langs/docker";
import langGo from "@shikijs/langs/go";
import langHtml from "@shikijs/langs/html";
import langIni from "@shikijs/langs/ini";
import langJava from "@shikijs/langs/java";
import langJs from "@shikijs/langs/javascript";
import langJson from "@shikijs/langs/json";
import langJsonc from "@shikijs/langs/jsonc";
import langJsx from "@shikijs/langs/jsx";
import langKotlin from "@shikijs/langs/kotlin";
import langLua from "@shikijs/langs/lua";
import langMake from "@shikijs/langs/make";
import langMd from "@shikijs/langs/markdown";
import langPhp from "@shikijs/langs/php";
import langPython from "@shikijs/langs/python";
import langRuby from "@shikijs/langs/ruby";
import langRust from "@shikijs/langs/rust";
import langScss from "@shikijs/langs/scss";
import langShell from "@shikijs/langs/shellscript";
import langSql from "@shikijs/langs/sql";
import langSvelte from "@shikijs/langs/svelte";
import langSwift from "@shikijs/langs/swift";
import langToml from "@shikijs/langs/toml";
import langTsx from "@shikijs/langs/tsx";
import langTs from "@shikijs/langs/typescript";
import langXml from "@shikijs/langs/xml";
import langYaml from "@shikijs/langs/yaml";
import latte from "@shikijs/themes/catppuccin-latte";
import mocha from "@shikijs/themes/catppuccin-mocha";
import Alpine from "alpinejs";
import * as Diff2Html from "diff2html";
import MarkdownIt from "markdown-it";
import anchor from "markdown-it-anchor";
import footnote from "markdown-it-footnote";
import taskLists from "markdown-it-task-lists";
import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import langMdsvex from "./langs/mdsvex.js";
import {
  esc,
  exceedsLineLimit,
  fmtSize,
  hunkRange,
  langForPath as libLangForPath,
  resolveLang as libResolveLang,
  resolveRel,
  splitFrontmatter,
} from "./lib.js";
import { createHTMLSanitizer } from "./sanitize.js";

/**
 * @typedef {object} Hunk
 * @property {number} oldStart
 * @property {number} oldLines
 * @property {number} newStart
 * @property {number} newLines
 * @property {"added" | "modified" | "deleted"} kind
 * @property {string} patch
 */

/**
 * @typedef {object} TreeNode
 * @property {string} name
 * @property {string} path
 * @property {boolean} dir
 * @property {boolean} ignored
 * @property {TreeNode[]} children
 * @property {boolean} [dirty]
 * @property {string | null} status
 * @property {boolean} [truncated]
 */

/**
 * @typedef {object} FileBase
 * @property {string} path
 * @property {number} size
 * @property {string | null} status
 * @property {boolean} ignored
 * @property {Hunk[]} hunks
 */

/** @typedef {FileBase & {binary: false, content: string}} TextFile */
/** @typedef {FileBase & {binary: true, content: null}} BinaryFile */
/** @typedef {TextFile | BinaryFile} FileData */
/** @typedef {"unified" | "split"} DiffMode */
/** @typedef {{start: number, mode: DiffMode}} PanelState */
/** @typedef {{changed: string[], git: boolean}} ChangeEvent */
/**
 * @typedef {object} ProjectView
 * @property {string} path
 * @property {string} name
 * @property {string} routeName
 * @property {string} lastOpened
 * @property {boolean} missing
 * @property {"project" | "worktree"} kind
 * @property {string} [parent]
 * @property {string} [branch]
 * @property {{branch: string, changes: number} | null} summary
 */

const MAX_HL_SIZE = 1_000_000,
  MAX_HL_LINES = 10_000,
  MAX_SVX_HL_LINES = 3500;
const IMG_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "ico", "avif", "bmp"]);
const sanitizeHTML = createHTMLSanitizer(window);
const routeMatch = location.pathname.match(/^\/p\/([^/]+)\/?$/);
const projectName = routeMatch ? decodeURIComponent(routeMatch[1]) : null;
const projectBase = projectName ? `/p/${encodeURIComponent(projectName)}` : "";

const highlighter = await createHighlighterCore({
  themes: [latte, mocha],
  langs: [
    langC,
    langCpp,
    langCsharp,
    langCss,
    langDiff,
    langDocker,
    langGo,
    langHtml,
    langIni,
    langJava,
    langJs,
    langJson,
    langJsonc,
    langJsx,
    langKotlin,
    langLua,
    langMake,
    langMd,
    langPhp,
    langPython,
    langRuby,
    langRust,
    langScss,
    langShell,
    langSql,
    langSvelte,
    langSwift,
    langToml,
    langTsx,
    langTs,
    langXml,
    langYaml,
    langMdsvex,
  ],
  engine: createJavaScriptRegexEngine({ forgiving: true }),
});
const LOADED = new Set(highlighter.getLoadedLanguages());
/** @param {string} id */
const resolveLang = (id) => libResolveLang(id, LOADED);
/** @param {string} path */
const langForPath = (path) => libLangForPath(path, LOADED);

/** @param {string} code */
function plainPre(code) {
  const lines = code
    .replace(/\n$/, "")
    .split("\n")
    .map((l) => `<span class="line">${esc(l)}</span>`)
    .join("\n");
  return `<pre class="shiki"><code>${lines}</code></pre>`;
}

/** @param {string} code @param {string} lang */
function hlCode(code, lang) {
  try {
    return highlighter.codeToHtml(code, {
      lang,
      themes: { light: "catppuccin-latte", dark: "catppuccin-mocha" },
      defaultColor: false,
    });
  } catch {
    return plainPre(code);
  }
}

/** @param {TextFile} file */
function plainFallback(file) {
  const lineLimit = file.path.toLowerCase().endsWith(".svx") ? MAX_SVX_HL_LINES : MAX_HL_LINES;
  return file.size > MAX_HL_SIZE || exceedsLineLimit(file.content, lineLimit);
}

// --- markdown-it, with source line ranges stamped onto rendered blocks ---
const md = new MarkdownIt({ html: true, linkify: true }).use(taskLists).use(anchor).use(footnote);

md.core.ruler.push("line_map", (state) => {
  for (const t of state.tokens)
    if (t.map && (t.nesting === 1 || ["fence", "hr", "code_block"].includes(t.type)))
      t.attrSet("data-lines", `${t.map[0] + 1}-${t.map[1]}`);
});

md.renderer.rules.fence = (tokens, idx) => {
  const t = tokens[idx];
  const out = hlCode(t.content, resolveLang((t.info || "").trim().split(/\s+/)[0]));
  const dl = t.attrGet("data-lines");
  return dl ? out.replace("<pre", `<pre data-lines="${dl}"`) : out;
};

/** @param {string} path @param {Hunk} hunk @param {DiffMode} mode */
function renderDiff(path, hunk, mode) {
  const diff = `--- a/${path}\n+++ b/${path}\n${hunk.patch}\n`;
  return Diff2Html.html(diff, {
    drawFileList: false,
    matching: "lines",
    outputFormat: mode === "unified" ? "line-by-line" : "side-by-side",
  });
}

/** @param {FileData} file @param {number} i @param {DiffMode} mode */
function buildPanel(file, i, mode) {
  const h = file.hunks[i];
  const el = document.createElement("div");
  el.className = "hunk-popup";
  el.dataset.hunk = String(i);
  el.dataset.mode = mode;
  el.innerHTML = sanitizeHTML(
    `<div class="hp-bar"><span class="hp-kind hp-${h.kind}">${h.kind}</span>` +
      `<span class="hp-loc">line ${Math.max(1, h.newStart)}</span><span class="spacer"></span>` +
      `<button class="hp-view">${mode === "unified" ? "split" : "unified"}</button>` +
      `<button class="hp-close" title="Close (Esc)">✕</button></div>` +
      `<div class="hp-body">${renderDiff(file.path, h, mode)}</div>`,
  );
  return el;
}

Alpine.data("peruse", () => ({
  tree: /** @type {TreeNode[]} */ ([]),
  isRepo: false,
  root: "",
  open: /** @type {Set<string>} */ (new Set()),
  changedOnly: false,
  showIgnored: true,
  file: /** @type {FileData | null} */ (null),
  raw: false,
  wrap: false,
  wrapAvailable: false,
  theme: "latte",
  loading: false,
  loadingName: "",
  nav: 0,
  wanted: /** @type {string | null} */ (null),
  projects: /** @type {ProjectView[]} */ ([]),
  projectName,

  async init() {
    this.theme =
      localStorage.getItem("peruse-theme") ??
      (matchMedia("(prefers-color-scheme: dark)").matches ? "mocha" : "latte");
    this.applyTheme();
    this.wrap = localStorage.getItem("peruse-wrap") === "true";
    const listing = /** @type {{projects: ProjectView[]}} */ (
      await (await fetch("/api/projects")).json()
    );
    this.projects = listing.projects;
    if (!this.projectName) return;
    this.$refs.viewer.addEventListener("click", (e) => this.viewerClick(e));
    // reflow (pane resize, images loading) moves blocks → re-lay the rail
    new ResizeObserver(() => this.layoutRails()).observe(this.$refs.viewer);
    addEventListener("hashchange", () => this.onHash());
    addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.closeAllPanels();
    });
    this.$watch("raw", async () => {
      if ((this.file?.content?.length ?? 0) > 300_000) {
        this.loading = true;
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
      }
      this.render();
      this.loading = false;
    });
    await this.refreshTree();
    this.connect();
    this.onHash();
  },

  // ---- tree ----
  get rootLabel() {
    return this.root.split("/").filter(Boolean).slice(-2).join("/");
  },
  get registeredProjects() {
    return this.projects.filter((project) => project.kind === "project");
  },
  /** @param {ProjectView} project */
  worktreesFor(project) {
    return this.projects.filter(
      (candidate) => candidate.kind === "worktree" && candidate.parent === project.name,
    );
  },
  /** @param {string} routeName */
  projectHref(routeName) {
    return `/p/${encodeURIComponent(routeName)}/`;
  },
  /** @param {string} routeName */
  switchProject(routeName) {
    if (routeName && routeName !== this.projectName) location.href = this.projectHref(routeName);
  },
  /** @param {string} value */
  formatOpened(value) {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
  },
  /** @param {ProjectView} project */
  summaryLabel(project) {
    if (project.missing) return "missing";
    if (!project.summary) return "not a git repository";
    const count = project.summary.changes;
    return `${project.summary.branch} · ${count} change${count === 1 ? "" : "s"}`;
  },
  get rows() {
    /** @type {Array<TreeNode & {depth: number}>} */
    const out = [];
    /** @param {TreeNode[]} nodes @param {number} depth */
    const visit = (nodes, depth) => {
      for (const n of nodes) {
        if (this.changedOnly && !this.hasChange(n)) continue;
        if (!this.showIgnored && n.ignored) continue;
        out.push({ ...n, depth });
        if (n.dir && (this.changedOnly || this.open.has(n.path))) visit(n.children, depth + 1);
      }
    };
    visit(this.tree, 0);
    return out;
  },
  /** @param {TreeNode} n @returns {boolean} */
  hasChange(n) {
    return n.dir ? n.children.some((c) => this.hasChange(c)) : !!n.status;
  },
  async refreshTree() {
    const d = /** @type {{tree: TreeNode[], isRepo: boolean, root: string}} */ (
      await (await fetch(`${projectBase}/api/tree`)).json()
    );
    this.tree = d.tree;
    this.isRepo = d.isRepo;
    this.root = d.root;
  },
  /** @param {TreeNode} row */
  rowClick(row) {
    if (row.truncated) return;
    if (row.dir) {
      this.open.has(row.path) ? this.open.delete(row.path) : this.open.add(row.path);
    } else if (location.hash === `#/${row.path}`) this.onHash();
    else location.hash = `#/${row.path}`;
  },
  /** @param {string} path */
  expandTo(path) {
    const parts = path.split("/").slice(0, -1);
    for (let i = 1; i <= parts.length; i++) this.open.add(parts.slice(0, i).join("/"));
  },

  // ---- file selection & rendering ----
  onHash() {
    const p = decodeURIComponent(location.hash.replace(/^#\/?/, ""));
    if (p && p !== this.file?.path) this.selectFile(p);
  },
  get isMarkdown() {
    return /\.(md|markdown)$/i.test(this.file?.path ?? "");
  },
  // Only modified/deleted hunks have popups; additions are already visible.
  get reviewable() {
    return (this.file?.hunks ?? []).map((h, i) => ({ h, i })).filter(({ h }) => h.kind !== "added");
  },
  get hunkChip() {
    const n = this.reviewable.length;
    return `${n} change${n === 1 ? "" : "s"}`;
  },

  /** @param {string} path @param {{preserve?: boolean}} [options] */
  async selectFile(path, { preserve = false } = {}) {
    // Highlighting big files blocks the main thread for a while; show the
    // indicator and yield two frames so it actually PAINTS first (its spinner
    // is transform-animated, so the compositor keeps it moving during the
    // block). Silent-refresh SSE re-renders only indicate when the file is big.
    // Every await below lets another selection start mid-flight. A real
    // navigation records the path it is heading for; a newer one supersedes
    // it. An SSE silent refresh always carries the CURRENTLY loaded path, so
    // when it lands during a navigation it is refreshing a file the user has
    // already left — it must drop out rather than re-render the old file and
    // write that path back to location.hash, undoing the navigation.
    const nav = preserve ? this.nav : ++this.nav;
    if (!preserve) this.wanted = path;
    const superseded = () => nav !== this.nav || (preserve && this.wanted !== path);
    this.loadingName = path.split("/").pop() ?? "";
    if (!preserve) this.loading = true;
    const r = await fetch(`${projectBase}/api/file?path=${encodeURIComponent(path)}`);
    if (superseded()) return;
    if (!r.ok) {
      this.file = null;
      this.loading = false;
      this.$refs.viewer.innerHTML = "";
      return;
    }
    const data = /** @type {FileData} */ (await r.json());
    if (superseded()) return;
    if (preserve && (data.content?.length ?? 0) > 300_000) this.loading = true;
    if (this.loading) {
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      if (superseded()) return;
    }
    const scroll = preserve ? this.$refs.scroll.scrollTop : 0;
    const panels = preserve ? this.panelState() : [];
    this.file = data;
    if (!preserve) this.raw = false;
    this.expandTo(path);
    if (!preserve && location.hash !== `#/${path}`) location.hash = `#/${path}`;
    this.render();
    this.loading = false;
    this.$refs.scroll.scrollTop = scroll;
    this.restorePanels(panels);
  },

  render() {
    const v = this.$refs.viewer,
      f = this.file;
    v.innerHTML = "";
    this.wrapAvailable = false;
    if (!f) return;
    const ext = f.path.split(".").pop()?.toLowerCase() ?? "";
    if (f.binary && IMG_EXTS.has(ext)) {
      v.innerHTML = `<div class="image-view"><img src="${projectBase}/raw/${escAttr(f.path)}"></div>`;
    } else if (f.binary) {
      v.innerHTML =
        `<div class="file-card"><div class="fc-name">${esc(f.path)}</div>` +
        `<div class="fc-meta">binary file · ${fmtSize(f.size)}` +
        `${f.status ? ` · git: ${f.status}` : ""}</div>` +
        `<a class="chip" href="${projectBase}/raw/${escAttr(f.path)}" download>Download</a></div>`;
    } else if (this.isMarkdown && !this.raw) {
      this.renderMarkdown(v, f);
    } else {
      this.renderCode(v, f);
    }
  },

  /** @param {HTMLElement} v @param {TextFile} f */
  renderMarkdown(v, f) {
    const dir = f.path.split("/").slice(0, -1).join("/");
    // YAML frontmatter → key/value card (GitHub-style), never body text.
    // The stripped lines are replaced with blanks so markdown-it's source
    // line maps (data-lines) stay aligned with the file's real line numbers.
    let body = f.content,
      fmCard = "";
    const fm = splitFrontmatter(f.content);
    if (fm) {
      const rows = fm.rows
        .map((r) =>
          "raw" in r
            ? `<tr><td colspan="2" class="fm-raw">${esc(r.raw)}</td></tr>`
            : `<tr><th>${esc(r.key)}</th><td>${esc(r.value)}</td></tr>`,
        )
        .join("");
      fmCard = `<table class="fm-card">${rows}</table>`;
      body = fm.body;
    }
    v.innerHTML = sanitizeHTML(
      `<article class="markdown-body">${fmCard}${md.render(body)}</article>`,
    );
    this.wrapAvailable = !!v.querySelector(".markdown-body .shiki .line");
    // Wrap each h1/h2 section in a <section> so a pinned heading is sticky
    // only within its own section — the next section pushes it away instead
    // of stacking on top of it (mismatched heights would ghost through).
    const article = /** @type {HTMLElement | null} */ (v.querySelector(".markdown-body"));
    if (!article) return;
    let sec = null;
    for (const node of [...article.childNodes]) {
      if (node instanceof Element && /^H[12]$/.test(node.tagName)) {
        sec = document.createElement("section");
        article.insertBefore(sec, node);
        sec.appendChild(node);
      } else if (sec) sec.appendChild(node);
    }
    for (const element of v.querySelectorAll("img[src]")) {
      const img = /** @type {HTMLImageElement} */ (element);
      const src = img.getAttribute("src");
      if (src && !/^([a-z][a-z0-9+.-]*:|\/|#|data:)/i.test(src))
        img.src = `${projectBase}/raw/${resolveRel(dir, src)}`;
    }
    for (const element of v.querySelectorAll("a[href]")) {
      const a = /** @type {HTMLAnchorElement} */ (element);
      const href = a.getAttribute("href");
      if (href && /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) {
        a.target = "_blank";
        a.rel = "noopener";
      }
    }
    // Mark the INNERMOST changed blocks. A <ul>'s line range spans the whole
    // list, so marking the outermost intersecting block would paint every
    // item over one edited bullet; instead a block is marked only when no
    // descendant block also intersects a change — the mark lands on the
    // specific bullet/paragraph that changed.
    // Wholly-new files (U/A) get no per-block marks: everything is "added",
    // so a border on every block is pure noise — the header badge says it all.
    if (f.status === "U" || f.status === "A") return;
    /** @type {Map<HTMLElement, number>} */
    const cand = new Map();
    for (const element of v.querySelectorAll("[data-lines]")) {
      const b = /** @type {HTMLElement} */ (element);
      const range = b.dataset.lines;
      if (!range) continue;
      const [bs, be] = range.split("-").map(Number);
      const idx = f.hunks.findIndex((h) => {
        const [hs, he] = hunkRange(h);
        return hs <= be && he >= bs;
      });
      if (idx >= 0) cand.set(b, idx);
    }
    for (const [b, idx] of cand) {
      let hasDeeper = false;
      for (const d of b.querySelectorAll("[data-lines]"))
        if (cand.has(/** @type {HTMLElement} */ (d))) {
          hasDeeper = true;
          break;
        }
      if (hasDeeper) continue;
      b.classList.add("md-changed", f.hunks[idx].kind === "added" ? "md-add" : "md-mod");
      if (f.hunks[idx].kind !== "added") b.dataset.hunk = String(idx);
    }
    this.layoutRails();
  },

  // Overlay bars beside each marked block, all on one fixed gutter x.
  // offsetTop resolves against #viewer (the nearest positioned ancestor),
  // so nesting depth is irrelevant.
  layoutRails() {
    const v = this.$refs.viewer;
    for (const r of v.querySelectorAll(".rail-mark")) r.remove();
    const article = /** @type {HTMLElement | null} */ (v.querySelector(".markdown-body"));
    if (!article) return;
    const railX = article.offsetLeft + 10;
    for (const element of v.querySelectorAll(".md-changed")) {
      const b = /** @type {HTMLElement} */ (element);
      const m = document.createElement("span");
      m.className = `rail-mark${b.classList.contains("md-add") ? " rm-add" : ""}`;
      if (b.dataset.hunk !== undefined) m.dataset.hunk = b.dataset.hunk;
      m.style.left = `${railX}px`;
      m.style.top = `${b.offsetTop}px`;
      m.style.height = `${b.offsetHeight}px`;
      v.appendChild(m);
    }
  },

  /** @param {HTMLElement} v @param {TextFile} f */
  renderCode(v, f) {
    this.wrapAvailable = f.content.length > 0;
    const big = plainFallback(f);
    const lang = this.isMarkdown ? "markdown" : langForPath(f.path);
    v.innerHTML = sanitizeHTML(
      (big ? `<div class="notice">Large file — syntax highlighting disabled</div>` : "") +
        (big ? plainPre(f.content) : hlCode(f.content, lang)),
    );
    const lines = /** @type {NodeListOf<HTMLElement>} */ (v.querySelectorAll(".line"));
    if (f.status === "U" || f.status === "A") return; // wholly-new file: no gutter marks
    f.hunks.forEach((h, i) => {
      const [s, e] = hunkRange(h);
      for (let ln = s; ln <= e; ln++) {
        const el = lines[ln - 1];
        if (!el) break;
        el.classList.add(h.newLines === 0 ? "hl-del" : h.kind === "added" ? "hl-add" : "hl-mod");
        // Additions get a mark but no popup — the added content is already
        // fully visible in the file; there is nothing more to diff.
        if (h.kind !== "added" && el.dataset.hunk === undefined) el.dataset.hunk = String(i);
      }
    });
  },

  // ---- hunk diff popup (anchored popover, one at a time) ----
  /** @param {number} i @returns {HTMLElement | null} */
  anchorFor(i) {
    // topmost mark belonging to hunk i, markdown block or code line
    return /** @type {HTMLElement | null} */ (
      this.$refs.viewer.querySelector(`.md-changed[data-hunk="${i}"], .line[data-hunk="${i}"]`)
    );
  },
  /** @param {number} i @param {DiffMode} [mode] @param {HTMLElement | null} [anchorEl] */
  openPanel(i, mode = "unified", anchorEl = null) {
    this.closeAllPanels();
    const anchor = anchorEl ?? this.anchorFor(i);
    if (!anchor || !this.file) return;
    const popup = buildPanel(this.file, i, mode);
    this.$refs.viewer.appendChild(popup);
    const isLine = anchor.classList.contains("line");
    popup.style.left = `${anchor.offsetLeft + (isLine ? this.codeGutterPx(anchor) : 0)}px`;
    popup.style.top = `${anchor.offsetTop + anchor.offsetHeight + 6}px`;
  },
  /** @param {number} i @param {HTMLElement | null} [anchorEl] */
  togglePanel(i, anchorEl = null) {
    const existing = /** @type {HTMLElement | null} */ (
      this.$refs.viewer.querySelector(".hunk-popup")
    );
    if (existing && Number(existing.dataset.hunk) === i) {
      existing.remove();
      return;
    }
    this.openPanel(i, "unified", anchorEl);
  },
  /** @param {HTMLElement} panel */
  flipPanel(panel) {
    const mode = panel.dataset.mode === "unified" ? "split" : "unified";
    panel.dataset.mode = mode;
    const view = panel.querySelector(".hp-view");
    const body = panel.querySelector(".hp-body");
    if (!view || !body || !this.file) return;
    view.textContent = mode === "unified" ? "split" : "unified";
    body.innerHTML = sanitizeHTML(
      renderDiff(this.file.path, this.file.hunks[Number(panel.dataset.hunk)], mode),
    );
  },
  closeAllPanels() {
    for (const p of this.$refs.viewer.querySelectorAll(".hunk-popup")) p.remove();
  },
  /** @param {number} [dir] */
  cycleHunk(dir = 1) {
    const r = this.reviewable;
    if (!r.length) return;
    const cur = /** @type {HTMLElement | null} */ (this.$refs.viewer.querySelector(".hunk-popup"));
    const pos = cur ? r.findIndex(({ i }) => i === Number(cur.dataset.hunk)) : dir > 0 ? -1 : 0;
    const next = r[(pos + dir + r.length) % r.length].i;
    const anchor = this.anchorFor(next);
    if (!anchor) return;
    anchor.scrollIntoView({ block: "center" });
    this.openPanel(next, "unified", anchor);
  },
  /** @returns {PanelState[]} */
  panelState() {
    if (!this.file) return [];
    const file = this.file;
    return [...this.$refs.viewer.querySelectorAll(".hunk-popup")].map((element) => {
      const p = /** @type {HTMLElement} */ (element);
      return {
        start: file.hunks[Number(p.dataset.hunk)]?.newStart ?? 1,
        mode: /** @type {DiffMode} */ (p.dataset.mode === "split" ? "split" : "unified"),
      };
    });
  },
  /** @param {PanelState[]} states */
  restorePanels(states) {
    const st = states[0];
    if (!st || !this.file) return;
    let best = -1,
      dist = Infinity;
    this.file.hunks.forEach((h, i) => {
      const d = Math.abs(h.newStart - st.start);
      if (d < dist) {
        dist = d;
        best = i;
      }
    });
    if (best >= 0) this.openPanel(best, st.mode);
  },

  /** @param {MouseEvent} e */
  viewerClick(e) {
    if (!(e.target instanceof Element)) return;
    const target = e.target;
    const btn = target.closest("button");
    if (btn?.classList.contains("hp-close")) {
      btn.closest(".hunk-popup")?.remove();
      return;
    }
    if (btn?.classList.contains("hp-view")) {
      const popup = /** @type {HTMLElement | null} */ (btn.closest(".hunk-popup"));
      if (popup) this.flipPanel(popup);
      return;
    }
    if (target.closest(".hunk-popup")) return;
    const a = /** @type {HTMLAnchorElement | null} */ (target.closest("a[href]"));
    if (a && this.interceptLink(e, a)) return;
    const rail = /** @type {HTMLElement | null} */ (target.closest(".rail-mark"));
    if (rail?.dataset.hunk !== undefined) return this.togglePanel(+rail.dataset.hunk);
    const blk = /** @type {HTMLElement | null} */ (target.closest(".md-changed"));
    if (blk?.dataset.hunk !== undefined && !target.closest("a, input, button"))
      return this.togglePanel(+blk.dataset.hunk, blk);
    const line = /** @type {HTMLElement | null} */ (target.closest(".line"));
    if (
      line?.dataset.hunk !== undefined &&
      e.clientX - line.getBoundingClientRect().left <= this.codeGutterPx(line)
    )
      return this.togglePanel(+line.dataset.hunk, line);
    this.closeAllPanels(); // click anywhere else dismisses the popup
  },
  /** @param {MouseEvent} e @param {HTMLAnchorElement} a */
  interceptLink(e, a) {
    const href = a.getAttribute("href");
    if (!href || /^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href)) return false;
    e.preventDefault();
    if (!this.file) return false;
    const dir = this.file.path.split("/").slice(0, -1).join("/");
    location.hash = `#/${resolveRel(dir, decodeURIComponent(href.split("#")[0]))}`;
    return true;
  },

  // ---- live updates ----
  connect() {
    const es = new EventSource(`${projectBase}/api/events`);
    es.onmessage = (ev) => {
      const d = /** @type {ChangeEvent} */ (JSON.parse(ev.data));
      this.refreshTree();
      if (this.file && (d.changed.includes(this.file.path) || d.git))
        this.selectFile(this.file.path, { preserve: true });
    };
    es.onopen = () => {
      this.refreshTree();
      if (this.file) this.selectFile(this.file.path, { preserve: true });
    };
  },

  // ---- theme ----
  applyTheme() {
    document.documentElement.dataset.theme = this.theme;
  },
  toggleTheme() {
    this.theme = this.theme === "mocha" ? "latte" : "mocha";
    localStorage.setItem("peruse-theme", this.theme);
    this.applyTheme();
  },

  // ---- word wrap ----
  // Wrapping is pure CSS off `data-wrap` on #viewer, so no re-render — but
  // every offset below the first wrapped line moves, and both of the
  // measured-at-open-time positions have to be redone: the hunk popup is
  // dropped (it is anchored at an offsetTop that no longer holds) and the
  // markdown rail is re-laid (fenced code blocks change height).
  /** @param {HTMLElement} line */
  codeGutterPx(line) {
    const gutter = Number.parseFloat(getComputedStyle(line).getPropertyValue("--code-gutter"));
    return Number.isFinite(gutter) ? gutter : 78;
  },
  /** @param {HTMLElement} element */
  stickyOnlyAnchor(element) {
    if (getComputedStyle(element).position !== "sticky") return false;
    const scroll = this.$refs.scroll;
    // offsetTop follows a sticky heading's painted position in Chromium. Each
    // rendered h1/h2 is the first child of its flow-positioned section, so the
    // section retains the heading's undisplaced logical top.
    const flowBox = element.matches(".markdown-body section > h1, .markdown-body section > h2")
      ? element.parentElement
      : element;
    if (!flowBox) return false;
    const flowTop = flowBox.offsetTop;
    const visualTop = element.getBoundingClientRect().top - scroll.getBoundingClientRect().top;
    return Math.abs(visualTop - (flowTop - scroll.scrollTop)) > 1;
  },
  /** @returns {{edge: "start"} | {edge: "end", offset: number} | {element: HTMLElement, offset: number} | null} */
  wrapAnchor() {
    const scroll = this.$refs.scroll;
    const maxScroll = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
    // With no overflow, start and EOF are the same physical position. Prefer
    // start so a one-line file that becomes tall when wrapped stays at its
    // beginning instead of jumping to the newly created scroll maximum.
    if (maxScroll <= 1 || scroll.scrollTop <= 1) return { edge: "start" };
    const endGap = maxScroll - scroll.scrollTop;
    const viewport = scroll.getBoundingClientRect();
    const article = this.$refs.viewer.querySelector(".markdown-body");
    const selector = article ? ".fm-card, [data-lines]" : ".shiki > code > .line";
    const candidates = /** @type {HTMLElement[]} */ ([
      ...this.$refs.viewer.querySelectorAll(selector),
    ]).filter(
      (element) => element.getBoundingClientRect().height > 0 && !this.stickyOnlyAnchor(element),
    );
    const lastContent = article
      ? candidates.at(-1)
      : (candidates.findLast((element) => (element.textContent?.length ?? 0) > 0) ??
        candidates.at(-1));
    if (lastContent) {
      const box = lastContent.getBoundingClientRect();
      // Preserve the measured end gap only when the reader can actually see
      // the final logical line/block. Otherwise retain the content at the top.
      if (box.bottom > viewport.top + 1 && box.top < viewport.bottom - 1)
        return { edge: "end", offset: endGap };
    }
    const fullyVisible = candidates.find((element) => {
      const box = element.getBoundingClientRect();
      return box.top >= viewport.top - 1 && box.bottom <= viewport.bottom + 1;
    });
    const element =
      fullyVisible ??
      candidates.find((candidate) => {
        const box = candidate.getBoundingClientRect();
        return box.bottom > viewport.top + 1 && box.top < viewport.bottom - 1;
      });
    return element ? { element, offset: element.getBoundingClientRect().top - viewport.top } : null;
  },
  /** @param {{edge: "start"} | {edge: "end", offset: number} | {element: HTMLElement, offset: number} | null} anchor */
  restoreWrapAnchor(anchor) {
    if (!anchor) return;
    const scroll = this.$refs.scroll;
    if ("edge" in anchor) {
      scroll.scrollTop =
        anchor.edge === "start" ? 0 : scroll.scrollHeight - scroll.clientHeight - anchor.offset;
      return;
    }
    if (!anchor.element.isConnected) return;
    const current = anchor.element.getBoundingClientRect().top - scroll.getBoundingClientRect().top;
    scroll.scrollTop += current - anchor.offset;
  },
  toggleWrap() {
    const anchor = this.wrapAnchor();
    this.wrap = !this.wrap;
    localStorage.setItem("peruse-wrap", String(this.wrap));
    this.closeAllPanels();
    this.$nextTick(() => {
      this.layoutRails();
      this.restoreWrapAnchor(anchor);
    });
  },
}));

/** @param {string} s */
function escAttr(s) {
  return s.split("/").map(encodeURIComponent).join("/");
}

window.Alpine = Alpine;
Alpine.start();
