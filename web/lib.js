// Pure helpers shared by app.js and the unit tests — no DOM, no Alpine,
// no Shiki, so tests can import this module without the heavy client boot.
import { isAlias, isMap, isScalar, isSeq, parseDocument } from "yaml";

/** @param {string} s */
export const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// extension / fence-info → grammar id (grammar aliases also resolve via the
// loaded-set the caller passes in)
/** @type {Record<string, string>} */
export const LANG = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  py: "python",
  rb: "ruby",
  sh: "shellscript",
  bash: "shellscript",
  zsh: "shellscript",
  shell: "shellscript",
  yml: "yaml",
  md: "markdown",
  markdown: "markdown",
  // mdsvex source stays a code view — see web/langs/mdsvex.js
  svx: "mdsvex",
  htm: "html",
  rs: "rust",
  kt: "kotlin",
  h: "c",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hh: "cpp",
  cs: "csharp",
  mk: "make",
  makefile: "make",
  dockerfile: "docker",
  patch: "diff",
  svg: "xml",
  conf: "ini",
  cfg: "ini",
  gitignore: "ini",
  gitattributes: "ini",
  env: "ini",
};

/** @param {string} id @param {Set<string>} loaded */
export function resolveLang(id, loaded) {
  id = (id || "").toLowerCase();
  return LANG[id] ?? (loaded.has(id) ? id : "text");
}

/** @param {string} path @param {Set<string>} loaded */
export function langForPath(path, loaded) {
  const name = path.split("/").pop()?.toLowerCase() ?? "";
  if (LANG[name.replace(/^\./, "")]) return LANG[name.replace(/^\./, "")];
  return resolveLang(name.split(".").pop() ?? "", loaded);
}

/** @param {string} dir @param {string} rel */
export function resolveRel(dir, rel) {
  const parts = dir ? dir.split("/") : [];
  for (const p of rel.split("/")) {
    if (p === "" || p === ".") continue;
    if (p === "..") parts.pop();
    else parts.push(p);
  }
  return parts.join("/");
}

/** @param {string} href */
export function splitLocalHref(href) {
  const suffixAt = href.search(/[?#]/);
  const path = suffixAt < 0 ? href : href.slice(0, suffixAt);
  const suffix = suffixAt < 0 ? "" : href.slice(suffixAt);
  const hashAt = suffix.indexOf("#");
  return { path, suffix, fragment: hashAt < 0 ? "" : suffix.slice(hashAt + 1) };
}

/**
 * @typedef {{name: string, path: string, dir: boolean, children?: LinkTreeNode[]}} LinkTreeNode
 */

/** @param {LinkTreeNode[]} tree @param {string} path */
function treeNode(tree, path) {
  let nodes = tree;
  let found;
  for (const part of path.split("/")) {
    found = nodes.find((node) => node.name === part);
    if (!found) return null;
    nodes = found.children ?? [];
  }
  return found ?? null;
}

/**
 * Resolve a Markdown link or image against the loaded project tree.
 * Root-absolute paths prefer the project root, then the current file's
 * ancestors nearest first. Missing paths retain the former relative result.
 * @param {LinkTreeNode[]} tree
 * @param {string} currentPath
 * @param {string} href
 * @returns {{path: string | null, directory: string | null, fragment: string, found: boolean}}
 */
export function resolveLink(tree, currentPath, href) {
  const { path: rawPath, fragment } = splitLocalHref(href);
  let linkPath;
  try {
    linkPath = decodeURIComponent(rawPath);
  } catch {
    linkPath = rawPath;
  }
  const currentDir = currentPath.split("/").slice(0, -1).join("/");
  const roots = linkPath.startsWith("/") ? [""] : [currentDir];
  if (linkPath.startsWith("/")) {
    for (let ancestor = currentDir; ancestor; ancestor = ancestor.split("/").slice(0, -1).join("/"))
      roots.push(ancestor);
  }
  const trailingSlash = linkPath.endsWith("/");
  const normalized = linkPath.replace(/\/+$/, "");
  if (linkPath === "/") {
    for (const root of ["", ...roots.slice(1).reverse()]) {
      const children = root ? treeNode(tree, root)?.children : tree;
      const index = ["index.md", "README.md"]
        .map((name) => children?.find((child) => !child.dir && child.name === name))
        .find(Boolean);
      if (index) return { path: index.path, directory: root, fragment, found: true };
    }
    return { path: null, directory: "", fragment, found: true };
  }
  const candidates = roots.map((root) => resolveRel(root, normalized));
  for (const path of candidates) {
    if (!path) {
      const index = ["index.md", "README.md"]
        .map((name) => tree.find((child) => !child.dir && child.name === name))
        .find(Boolean);
      return { path: index?.path ?? null, directory: "", fragment, found: true };
    }
    const node = treeNode(tree, path);
    if (node && !node.dir) return { path, directory: null, fragment, found: true };
    if (!trailingSlash && !/\.[^/]+$/.test(path)) {
      const markdown = `${path}.md`;
      if (treeNode(tree, markdown)?.dir === false)
        return { path: markdown, directory: null, fragment, found: true };
    }
    if (!node) continue;
    if (node.dir) {
      const index = ["index.md", "README.md"]
        .map((name) => node.children?.find((child) => !child.dir && child.name === name))
        .find(Boolean);
      return { path: index?.path ?? null, directory: path, fragment, found: true };
    }
  }
  return { path: resolveRel(currentDir, linkPath), directory: null, fragment, found: false };
}

/** @param {number} n */
export function fmtSize(n) {
  if (n < 1024) return `${n} B`;
  for (const u of ["KB", "MB", "GB"]) {
    n /= 1024;
    if (n < 1024) return `${n.toFixed(1)} ${u}`;
  }
  return `${n.toFixed(1)} TB`;
}

/**
 * A final LF or CRLF terminates the last source line; it does not add an empty one.
 * @param {string} content
 * @param {number} limit
 */
export function exceedsLineLimit(content, limit) {
  return content.split("\n").length - Number(content.endsWith("\n")) > limit;
}

// New-file line range a hunk occupies (deletions anchor to the line above the cut)
/** @param {{newLines: number, newStart: number}} h @returns {[number, number]} */
export function hunkRange(h) {
  const s = h.newLines === 0 ? Math.max(1, h.newStart) : h.newStart;
  return [s, h.newLines === 0 ? s : h.newStart + h.newLines - 1];
}

/**
 * Split leading YAML frontmatter off markdown content.
 * Returns null when there is none; otherwise { source, rows, body, lines } where rows are
 * {key, value} or {raw} entries and body has the frontmatter lines replaced
 * by blanks so markdown-it's source line maps stay aligned with the file, and
 * lines is the inclusive source extent of the frontmatter card.
 * @param {string} content
 * @returns {{source: string, rows: Array<{key: string, value: string} | {raw: string}>, body: string, lines: number} | null}
 */
export function splitFrontmatter(content) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  if (!fm) return null;
  const rows = fm[1].split(/\r?\n/).map((line) => {
    const kv = /^([A-Za-z0-9_-]+):\s?(.*)$/.exec(line);
    return kv ? { key: kv[1], value: kv[2] } : { raw: line };
  });
  const body = "\n".repeat(fm[0].split("\n").length - 1) + content.slice(fm[0].length);
  const lines = fm[0].split("\n").length - Number(fm[0].endsWith("\n"));
  return { source: fm[1], rows, body, lines };
}

/**
 * Parse one YAML mapping. Invalid, multi-document, and non-map input returns
 * null so the caller can retain splitFrontmatter's line fallback.
 * @param {string} source
 * @returns {{data: Record<string, unknown>, blockPaths: Set<string>, keyRanges: Map<string, {full: string, key: string}>} | null}
 */
export function parseFrontmatter(source) {
  try {
    const doc = parseDocument(source, { stringKeys: true, logLevel: "error" });
    if (doc.errors.length || !isMap(doc.contents)) return null;
    const data = /** @type {Record<string, unknown>} */ (doc.toJS({ maxAliasCount: 50 }));
    const blockPaths = new Set();
    const keyRanges = new Map();
    /** @param {number} offset */
    const sourceLine = (offset) => 2 + (source.slice(0, offset).match(/\n/g)?.length ?? 0);
    for (const pair of doc.contents.items) {
      if (!isScalar(pair.key) || !pair.key.range) continue;
      const start = pair.key.range[0];
      const keyEnd = Math.max(start, pair.key.range[1] - 1);
      const valueEnd = Math.max(start, (pair.value?.range?.[1] ?? pair.key.range[1]) - 1);
      keyRanges.set(String(pair.key.value), {
        full: `${sourceLine(start)}-${sourceLine(valueEnd)}`,
        key: `${sourceLine(start)}-${sourceLine(keyEnd)}`,
      });
    }
    const activeNodes = new WeakSet();
    /** @param {unknown} node @param {(string | number)[]} path */
    const visit = (node, path) => {
      if (!node || typeof node !== "object" || activeNodes.has(node)) return;
      activeNodes.add(node);
      if (isAlias(node)) {
        visit(node.resolve(doc), path);
      } else if (isScalar(node)) {
        if (node.type === "BLOCK_FOLDED" || node.type === "BLOCK_LITERAL")
          blockPaths.add(JSON.stringify(path));
      } else if (isMap(node)) {
        for (const pair of node.items) {
          if (isScalar(pair.key)) visit(pair.value, [...path, String(pair.key.value)]);
        }
      } else if (isSeq(node)) {
        for (const [index, item] of node.items.entries()) visit(item, [...path, index]);
      }
      activeNodes.delete(node);
    };
    visit(doc.contents, []);
    return { data, blockPaths, keyRanges };
  } catch {
    return null;
  }
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** @param {unknown} value */
function renderScalar(value) {
  const display = String(value);
  const urlParts = /^(https?:\/\/\S+?)([.,;:)\]]*)$/i.exec(display);
  if (urlParts) {
    try {
      const [, link, punctuation] = urlParts;
      const url = new URL(link);
      if (url.protocol === "http:" || url.protocol === "https:")
        return `<a href="${esc(link).replaceAll('"', "&quot;")}" target="_blank" rel="noopener">${esc(link)}</a>${esc(punctuation)}`;
    } catch {
      // Keep malformed URLs as readable text.
    }
  }
  return esc(display);
}

/**
 * @param {unknown} value
 * @param {(string | number)[]} path
 * @param {Set<string>} blockPaths
 * @param {WeakSet<object>} ancestors
 * @returns {string}
 */
function renderValue(value, path, blockPaths, ancestors) {
  if (value === null) return '<span class="fm-null" title="null">—</span>';
  if (!isRecord(value) && !Array.isArray(value)) {
    const content = renderScalar(value);
    return blockPaths.has(JSON.stringify(path))
      ? `<p class="fm-paragraph">${content}</p>`
      : content;
  }
  if (
    (Array.isArray(value) && value.length === 0) ||
    (isRecord(value) && Object.keys(value).length === 0)
  )
    return "";
  if (ancestors.has(value)) return `<span class="fm-raw">[circular reference]</span>`;
  ancestors.add(value);
  let content;
  if (Array.isArray(value)) {
    if (value.length && value.every(isRecord)) {
      const keys = [...new Set(value.flatMap((item) => Object.keys(item)))];
      content = `<div class="fm-table-scroll"><table class="fm-nested-table"><thead><tr>${keys.map((key) => `<th>${esc(key)}</th>`).join("")}</tr></thead><tbody>${value
        .map(
          (item, index) =>
            `<tr>${keys.map((key) => `<td>${Object.hasOwn(item, key) ? renderValue(item[key], [...path, index, key], blockPaths, ancestors) : ""}</td>`).join("")}</tr>`,
        )
        .join("")}</tbody></table></div>`;
    } else if (
      value.length &&
      value.every((item) => typeof item === "string" && item.length <= 80 && !item.includes("\n"))
    ) {
      content = `<div class="fm-chips">${value.map((item) => `<span class="fm-chip">${renderScalar(item)}</span>`).join("")}</div>`;
    } else {
      content = `<ul class="fm-list">${value.map((item, index) => `<li>${renderValue(item, [...path, index], blockPaths, ancestors)}</li>`).join("")}</ul>`;
    }
  } else {
    content = `<table class="fm-subcard"><tbody>${Object.entries(value)
      .map(
        ([key, item]) =>
          `<tr><th>${esc(key)}</th><td>${renderValue(item, [...path, key], blockPaths, ancestors)}</td></tr>`,
      )
      .join("")}</tbody></table>`;
  }
  ancestors.delete(value);
  return content;
}

/**
 * Render parsed frontmatter, or preserve the original per-line card on errors.
 * Parsed rows own their source ranges; list-of-map values also get footers.
 * Invalid YAML keeps the original card-wide line range.
 * @param {NonNullable<ReturnType<typeof splitFrontmatter>>} fm
 * @returns {{card: string, footers: string}}
 */
export function renderFrontmatter(fm) {
  const parsed = parseFrontmatter(fm.source);
  if (!parsed) {
    const rows = fm.rows
      .map((row) =>
        "raw" in row
          ? `<tr><td colspan="2" class="fm-raw">${esc(row.raw)}</td></tr>`
          : `<tr><th>${esc(row.key)}</th><td>${esc(row.value)}</td></tr>`,
      )
      .join("");
    return {
      card: `<table class="fm-card" data-lines="1-${fm.lines}"><tbody>${rows}</tbody></table>`,
      footers: "",
    };
  }
  /** @type {string[]} */
  const footers = [];
  /** @type {WeakMap<object, string>} */
  const footerIds = new WeakMap();
  const rows = Object.entries(parsed.data)
    .map(([key, value]) => {
      const isFooter = Array.isArray(value) && value.length > 0 && value.every(isRecord);
      const range = parsed.keyRanges.get(key);
      const existingId = isFooter ? footerIds.get(value) : undefined;
      const id = existingId ?? `fm-${encodeURIComponent(key)}`;
      if (isFooter && !existingId) {
        footerIds.set(value, id);
        footers.push(
          `<section class="fm-footer" id="${id}" data-lines="${range?.full ?? `1-${fm.lines}`}">` +
            `<h3 class="fm-footer-title">${esc(key)}</h3>` +
            `${renderValue(value, [key], parsed.blockPaths, new WeakSet())}</section>`,
        );
      }
      const label =
        isFooter && value.length === 1 && /^.{3,}[^sui]s$/.test(key) ? key.slice(0, -1) : key;
      const content = isFooter
        ? `<a class="fm-jump" href="#${id}">${value.length} ${esc(label)} ↓</a>`
        : renderValue(value, [key], parsed.blockPaths, new WeakSet());
      return `<tr data-lines="${isFooter && !existingId ? (range?.key ?? `1-${fm.lines}`) : (range?.full ?? `1-${fm.lines}`)}"><th>${esc(key)}</th><td>${content}</td></tr>`;
    })
    .join("");
  return {
    card: `<table class="fm-card"><tbody>${rows}</tbody></table>`,
    footers: footers.join(""),
  };
}
