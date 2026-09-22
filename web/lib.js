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
 * @returns {{data: Record<string, unknown>, blockPaths: Set<string>} | null}
 */
export function parseFrontmatter(source) {
  try {
    const doc = parseDocument(source, { stringKeys: true, logLevel: "error" });
    if (doc.errors.length || !isMap(doc.contents)) return null;
    const data = /** @type {Record<string, unknown>} */ (doc.toJS({ maxAliasCount: 50 }));
    const blockPaths = new Set();
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
    return { data, blockPaths };
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
 * The outer card alone owns the source range for Markdown change marks.
 * @param {NonNullable<ReturnType<typeof splitFrontmatter>>} fm
 */
export function renderFrontmatter(fm) {
  const parsed = parseFrontmatter(fm.source);
  const rows = parsed
    ? Object.entries(parsed.data)
        .map(
          ([key, value]) =>
            `<tr><th>${esc(key)}</th><td>${renderValue(value, [key], parsed.blockPaths, new WeakSet())}</td></tr>`,
        )
        .join("")
    : fm.rows
        .map((row) =>
          "raw" in row
            ? `<tr><td colspan="2" class="fm-raw">${esc(row.raw)}</td></tr>`
            : `<tr><th>${esc(row.key)}</th><td>${esc(row.value)}</td></tr>`,
        )
        .join("");
  return `<table class="fm-card" data-lines="1-${fm.lines}"><tbody>${rows}</tbody></table>`;
}
