// Pure helpers shared by app.js and the unit tests — no DOM, no Alpine,
// no Shiki, so tests can import this module without the heavy client boot.

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
 * Returns null when there is none; otherwise { rows, body, lines } where rows are
 * {key, value} or {raw} entries and body has the frontmatter lines replaced
 * by blanks so markdown-it's source line maps stay aligned with the file, and
 * lines is the inclusive source extent of the frontmatter card.
 * @param {string} content
 * @returns {{rows: Array<{key: string, value: string} | {raw: string}>, body: string, lines: number} | null}
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
  return { rows, body, lines };
}
