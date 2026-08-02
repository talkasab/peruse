// peruse client: tree + viewer + inline hunk diffs + SSE live updates.
import Alpine from "alpinejs";
import MarkdownIt from "markdown-it";
import taskLists from "markdown-it-task-lists";
import anchor from "markdown-it-anchor";
import footnote from "markdown-it-footnote";
import * as Diff2Html from "diff2html";
import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import latte from "@shikijs/themes/catppuccin-latte";
import mocha from "@shikijs/themes/catppuccin-mocha";
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
import langSwift from "@shikijs/langs/swift";
import langToml from "@shikijs/langs/toml";
import langTsx from "@shikijs/langs/tsx";
import langTs from "@shikijs/langs/typescript";
import langXml from "@shikijs/langs/xml";
import langYaml from "@shikijs/langs/yaml";

import { esc, resolveLang as libResolveLang, langForPath as libLangForPath,
  resolveRel, fmtSize, hunkRange, splitFrontmatter } from "./lib.js";
import { createHTMLSanitizer } from "./sanitize.js";

const GUTTER_PX = 64;
const MAX_HL_SIZE = 1_000_000, MAX_HL_LINES = 10_000;
const IMG_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "ico", "avif", "bmp"]);
const sanitizeHTML = createHTMLSanitizer(window);

const highlighter = await createHighlighterCore({
  themes: [latte, mocha],
  langs: [langC, langCpp, langCsharp, langCss, langDiff, langDocker, langGo,
    langHtml, langIni, langJava, langJs, langJson, langJsonc, langJsx, langKotlin,
    langLua, langMake, langMd, langPhp, langPython, langRuby, langRust, langScss,
    langShell, langSql, langSwift, langToml, langTsx, langTs, langXml, langYaml],
  engine: createJavaScriptRegexEngine({ forgiving: true }),
});
const LOADED = new Set(highlighter.getLoadedLanguages());
const resolveLang = (id) => libResolveLang(id, LOADED);
const langForPath = (path) => libLangForPath(path, LOADED);

function plainPre(code) {
  const lines = code.replace(/\n$/, "").split("\n")
    .map((l) => `<span class="line">${esc(l)}</span>`).join("\n");
  return `<pre class="shiki"><code>${lines}</code></pre>`;
}

function hlCode(code, lang) {
  try {
    return highlighter.codeToHtml(code, {
      lang, themes: { light: "catppuccin-latte", dark: "catppuccin-mocha" },
      defaultColor: false,
    });
  } catch { return plainPre(code); }
}

// --- markdown-it, with source line ranges stamped onto rendered blocks ---
const md = new MarkdownIt({ html: true, linkify: true })
  .use(taskLists).use(anchor).use(footnote);

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

function renderDiff(path, hunk, mode) {
  const diff = `--- a/${path}\n+++ b/${path}\n${hunk.patch}\n`;
  return Diff2Html.html(diff, {
    drawFileList: false, matching: "lines",
    outputFormat: mode === "unified" ? "line-by-line" : "side-by-side",
  });
}

function buildPanel(file, i, mode) {
  const h = file.hunks[i];
  const el = document.createElement("div");
  el.className = "hunk-popup";
  el.dataset.hunk = i;
  el.dataset.mode = mode;
  el.innerHTML = sanitizeHTML(
    `<div class="hp-bar"><span class="hp-kind hp-${h.kind}">${h.kind}</span>` +
    `<span class="hp-loc">line ${Math.max(1, h.newStart)}</span><span class="spacer"></span>` +
    `<button class="hp-view">${mode === "unified" ? "split" : "unified"}</button>` +
    `<button class="hp-close" title="Close (Esc)">✕</button></div>` +
    `<div class="hp-body">${renderDiff(file.path, h, mode)}</div>`);
  return el;
}

Alpine.data("peruse", () => ({
  tree: [], isRepo: false, root: "",
  open: new Set(), changedOnly: false, showIgnored: true,
  file: null, raw: false, theme: "latte", loading: false, loadingName: "",

  async init() {
    this.theme = localStorage.getItem("peruse-theme")
      ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "mocha" : "latte");
    this.applyTheme();
    this.$refs.viewer.addEventListener("click", (e) => this.viewerClick(e));
    // reflow (pane resize, images loading) moves blocks → re-lay the rail
    new ResizeObserver(() => this.layoutRails()).observe(this.$refs.viewer);
    addEventListener("hashchange", () => this.onHash());
    addEventListener("keydown", (e) => { if (e.key === "Escape") this.closeAllPanels(); });
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
  get rootLabel() { return this.root.split("/").filter(Boolean).slice(-2).join("/"); },
  get rows() {
    const out = [];
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
  hasChange(n) { return n.dir ? n.children.some((c) => this.hasChange(c)) : !!n.status; },
  async refreshTree() {
    const d = await (await fetch("/api/tree")).json();
    this.tree = d.tree; this.isRepo = d.isRepo; this.root = d.root;
  },
  rowClick(row) {
    if (row.truncated) return;
    if (row.dir) {
      this.open.has(row.path) ? this.open.delete(row.path) : this.open.add(row.path);
    } else if (location.hash === `#/${row.path}`) this.onHash();
    else location.hash = `#/${row.path}`;
  },
  expandTo(path) {
    const parts = path.split("/").slice(0, -1);
    for (let i = 1; i <= parts.length; i++) this.open.add(parts.slice(0, i).join("/"));
  },

  // ---- file selection & rendering ----
  onHash() {
    const p = decodeURIComponent(location.hash.replace(/^#\/?/, ""));
    if (p && p !== this.file?.path) this.selectFile(p);
  },
  get isMarkdown() { return /\.(md|markdown)$/i.test(this.file?.path ?? ""); },
  // Only modified/deleted hunks have popups; additions are already visible.
  get reviewable() {
    return (this.file?.hunks ?? [])
      .map((h, i) => ({ h, i })).filter(({ h }) => h.kind !== "added");
  },
  get hunkChip() {
    const n = this.reviewable.length;
    return `${n} change${n === 1 ? "" : "s"}`;
  },

  async selectFile(path, { preserve = false } = {}) {
    // Highlighting big files blocks the main thread for a while; show the
    // indicator and yield two frames so it actually PAINTS first (its spinner
    // is transform-animated, so the compositor keeps it moving during the
    // block). Silent-refresh SSE re-renders only indicate when the file is big.
    this.loadingName = path.split("/").pop();
    if (!preserve) this.loading = true;
    const r = await fetch(`/api/file?path=${encodeURIComponent(path)}`);
    if (!r.ok) { this.file = null; this.loading = false; this.$refs.viewer.innerHTML = ""; return; }
    const data = await r.json();
    if (preserve && (data.content?.length ?? 0) > 300_000) this.loading = true;
    if (this.loading) {
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
    }
    const scroll = preserve ? this.$refs.scroll.scrollTop : 0;
    const panels = preserve ? this.panelState() : [];
    this.file = data;
    if (!preserve) this.raw = false;
    this.expandTo(path);
    if (location.hash !== `#/${path}`) location.hash = `#/${path}`;
    this.render();
    this.loading = false;
    this.$refs.scroll.scrollTop = scroll;
    this.restorePanels(panels);
  },

  render() {
    const v = this.$refs.viewer, f = this.file;
    v.innerHTML = "";
    if (!f) return;
    const ext = f.path.split(".").pop().toLowerCase();
    if (f.binary && IMG_EXTS.has(ext)) {
      v.innerHTML = `<div class="image-view"><img src="/raw/${escAttr(f.path)}"></div>`;
    } else if (f.binary) {
      v.innerHTML = `<div class="file-card"><div class="fc-name">${esc(f.path)}</div>` +
        `<div class="fc-meta">binary file · ${fmtSize(f.size)}` +
        `${f.status ? ` · git: ${f.status}` : ""}</div>` +
        `<a class="chip" href="/raw/${escAttr(f.path)}" download>Download</a></div>`;
    } else if (this.isMarkdown && !this.raw) {
      this.renderMarkdown(v, f);
    } else {
      this.renderCode(v, f);
    }
  },

  renderMarkdown(v, f) {
    const dir = f.path.split("/").slice(0, -1).join("/");
    // YAML frontmatter → key/value card (GitHub-style), never body text.
    // The stripped lines are replaced with blanks so markdown-it's source
    // line maps (data-lines) stay aligned with the file's real line numbers.
    let body = f.content, fmCard = "";
    const fm = splitFrontmatter(f.content);
    if (fm) {
      const rows = fm.rows.map((r) =>
        r.raw !== undefined
          ? `<tr><td colspan="2" class="fm-raw">${esc(r.raw)}</td></tr>`
          : `<tr><th>${esc(r.key)}</th><td>${esc(r.value)}</td></tr>`).join("");
      fmCard = `<table class="fm-card">${rows}</table>`;
      body = fm.body;
    }
    v.innerHTML = sanitizeHTML(
      `<article class="markdown-body">${fmCard}${md.render(body)}</article>`);
    // Wrap each h1/h2 section in a <section> so a pinned heading is sticky
    // only within its own section — the next section pushes it away instead
    // of stacking on top of it (mismatched heights would ghost through).
    const article = v.querySelector(".markdown-body");
    let sec = null;
    for (const node of [...article.childNodes]) {
      if (node.nodeType === 1 && /^H[12]$/.test(node.tagName)) {
        sec = document.createElement("section");
        article.insertBefore(sec, node);
        sec.appendChild(node);
      } else if (sec) sec.appendChild(node);
    }
    for (const img of v.querySelectorAll("img[src]")) {
      const src = img.getAttribute("src");
      if (!/^([a-z][a-z0-9+.-]*:|\/|#|data:)/i.test(src))
        img.src = `/raw/${resolveRel(dir, src)}`;
    }
    for (const a of v.querySelectorAll("a[href]")) {
      if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(a.getAttribute("href"))) {
        a.target = "_blank"; a.rel = "noopener";
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
    const cand = new Map();
    for (const b of v.querySelectorAll("[data-lines]")) {
      const [bs, be] = b.dataset.lines.split("-").map(Number);
      const idx = f.hunks.findIndex((h) => {
        const [hs, he] = hunkRange(h);
        return hs <= be && he >= bs;
      });
      if (idx >= 0) cand.set(b, idx);
    }
    for (const [b, idx] of cand) {
      let hasDeeper = false;
      for (const d of b.querySelectorAll("[data-lines]"))
        if (cand.has(d)) { hasDeeper = true; break; }
      if (hasDeeper) continue;
      b.classList.add("md-changed", f.hunks[idx].kind === "added" ? "md-add" : "md-mod");
      if (f.hunks[idx].kind !== "added") b.dataset.hunk = idx;
    }
    this.layoutRails();
  },

  // Overlay bars beside each marked block, all on one fixed gutter x.
  // offsetTop resolves against #viewer (the nearest positioned ancestor),
  // so nesting depth is irrelevant.
  layoutRails() {
    const v = this.$refs.viewer;
    for (const r of v.querySelectorAll(".rail-mark")) r.remove();
    const article = v.querySelector(".markdown-body");
    if (!article) return;
    const railX = article.offsetLeft + 10;
    for (const b of v.querySelectorAll(".md-changed")) {
      const m = document.createElement("span");
      m.className = "rail-mark" + (b.classList.contains("md-add") ? " rm-add" : "");
      if (b.dataset.hunk !== undefined) m.dataset.hunk = b.dataset.hunk;
      m.style.left = `${railX}px`;
      m.style.top = `${b.offsetTop}px`;
      m.style.height = `${b.offsetHeight}px`;
      v.appendChild(m);
    }
  },

  renderCode(v, f) {
    const big = f.size > MAX_HL_SIZE || f.content.split("\n").length > MAX_HL_LINES;
    const lang = this.isMarkdown ? "markdown" : langForPath(f.path);
    v.innerHTML = sanitizeHTML(
      (big ? `<div class="notice">Large file — syntax highlighting disabled</div>` : "")
      + (big ? plainPre(f.content) : hlCode(f.content, lang)));
    const lines = v.querySelectorAll(".line");
    if (f.status === "U" || f.status === "A") return; // wholly-new file: no gutter marks
    f.hunks.forEach((h, i) => {
      const [s, e] = hunkRange(h);
      for (let ln = s; ln <= e; ln++) {
        const el = lines[ln - 1];
        if (!el) break;
        el.classList.add(h.newLines === 0 ? "hl-del" : h.kind === "added" ? "hl-add" : "hl-mod");
        // Additions get a mark but no popup — the added content is already
        // fully visible in the file; there is nothing more to diff.
        if (h.kind !== "added" && el.dataset.hunk === undefined) el.dataset.hunk = i;
      }
    });
  },

  // ---- hunk diff popup (anchored popover, one at a time) ----
  anchorFor(i) {
    // topmost mark belonging to hunk i, markdown block or code line
    return this.$refs.viewer.querySelector(`.md-changed[data-hunk="${i}"], .line[data-hunk="${i}"]`);
  },
  openPanel(i, mode = "unified", anchorEl = null) {
    this.closeAllPanels();
    const anchor = anchorEl ?? this.anchorFor(i);
    if (!anchor) return;
    const popup = buildPanel(this.file, i, mode);
    this.$refs.viewer.appendChild(popup);
    const isLine = anchor.classList.contains("line");
    popup.style.left = `${anchor.offsetLeft + (isLine ? 70 : 0)}px`;
    popup.style.top = `${anchor.offsetTop + anchor.offsetHeight + 6}px`;
  },
  togglePanel(i, anchorEl = null) {
    const existing = this.$refs.viewer.querySelector(".hunk-popup");
    if (existing && +existing.dataset.hunk === i) { existing.remove(); return; }
    this.openPanel(i, "unified", anchorEl);
  },
  flipPanel(panel) {
    const mode = panel.dataset.mode === "unified" ? "split" : "unified";
    panel.dataset.mode = mode;
    panel.querySelector(".hp-view").textContent = mode === "unified" ? "split" : "unified";
    panel.querySelector(".hp-body").innerHTML = sanitizeHTML(
      renderDiff(this.file.path, this.file.hunks[+panel.dataset.hunk], mode));
  },
  closeAllPanels() {
    for (const p of this.$refs.viewer.querySelectorAll(".hunk-popup")) p.remove();
  },
  cycleHunk(dir = 1) {
    const r = this.reviewable;
    if (!r.length) return;
    const cur = this.$refs.viewer.querySelector(".hunk-popup");
    const pos = cur ? r.findIndex(({ i }) => i === +cur.dataset.hunk) : (dir > 0 ? -1 : 0);
    const next = r[(pos + dir + r.length) % r.length].i;
    const anchor = this.anchorFor(next);
    if (!anchor) return;
    anchor.scrollIntoView({ block: "center" });
    this.openPanel(next, "unified", anchor);
  },
  panelState() {
    return [...this.$refs.viewer.querySelectorAll(".hunk-popup")].map((p) => ({
      start: this.file.hunks[+p.dataset.hunk]?.newStart ?? 1, mode: p.dataset.mode,
    }));
  },
  restorePanels(states) {
    const st = states[0];
    if (!st) return;
    let best = -1, dist = Infinity;
    this.file.hunks.forEach((h, i) => {
      const d = Math.abs(h.newStart - st.start);
      if (d < dist) { dist = d; best = i; }
    });
    if (best >= 0) this.openPanel(best, st.mode);
  },

  viewerClick(e) {
    const btn = e.target.closest("button");
    if (btn?.classList.contains("hp-close")) return btn.closest(".hunk-popup").remove();
    if (btn?.classList.contains("hp-view")) return this.flipPanel(btn.closest(".hunk-popup"));
    if (e.target.closest(".hunk-popup")) return;
    const a = e.target.closest("a[href]");
    if (a && this.interceptLink(e, a)) return;
    const rail = e.target.closest(".rail-mark");
    if (rail?.dataset.hunk !== undefined) return this.togglePanel(+rail.dataset.hunk);
    const blk = e.target.closest(".md-changed");
    if (blk?.dataset.hunk !== undefined && !e.target.closest("a, input, button"))
      return this.togglePanel(+blk.dataset.hunk, blk);
    const line = e.target.closest(".line");
    if (line?.dataset.hunk !== undefined &&
        e.clientX - line.getBoundingClientRect().left <= GUTTER_PX)
      return this.togglePanel(+line.dataset.hunk, line);
    this.closeAllPanels(); // click anywhere else dismisses the popup
  },
  interceptLink(e, a) {
    const href = a.getAttribute("href");
    if (!href || /^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href)) return false;
    e.preventDefault();
    const dir = this.file.path.split("/").slice(0, -1).join("/");
    location.hash = `#/${resolveRel(dir, decodeURIComponent(href.split("#")[0]))}`;
    return true;
  },

  // ---- live updates ----
  connect() {
    const es = new EventSource("/api/events");
    es.onmessage = (ev) => {
      const d = JSON.parse(ev.data);
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
  applyTheme() { document.documentElement.dataset.theme = this.theme; },
  toggleTheme() {
    this.theme = this.theme === "mocha" ? "latte" : "mocha";
    localStorage.setItem("peruse-theme", this.theme);
    this.applyTheme();
  },
}));

function escAttr(s) { return s.split("/").map(encodeURIComponent).join("/"); }

window.Alpine = Alpine;
Alpine.start();
