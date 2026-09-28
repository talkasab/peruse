import { readFile } from "node:fs/promises";
import { join } from "node:path";

const warnedSources = new Map();

/** @typedef {{glob: Bun.Glob, directoryOnly: boolean, literalDirs: string[]}} Rule */

/** @param {string} source @param {(message: string) => void} [warn] */
export function parsePeruseShow(source, warn = console.error) {
  /** @type {Rule[]} */
  const rules = [];
  let warnings = 0;
  /** @param {number} line */
  const report = (line) => {
    if (++warnings <= 3) warn(`peruse: .peruseshow: invalid pattern on line ${line}`);
    else if (warnings === 4) warn("peruse: further .peruseshow warnings suppressed");
  };
  for (const [index, raw] of source.split(/\r?\n/).entries()) {
    const line = (index === 0 ? raw.replace(/^\uFEFF/, "") : raw).trimEnd();
    if (!line.trim() || line.startsWith("#")) continue;
    const directoryOnly = line.endsWith("/");
    const pattern = line.replace(/^\//, "").replace(/\/$/, "");
    const anchored = line.startsWith("/") || pattern.includes("/");
    if (
      line.startsWith("!") ||
      !pattern ||
      pattern.split("/").includes("..") ||
      (pattern.includes("[") && !pattern.includes("]")) ||
      (pattern.includes("{") && !pattern.includes("}"))
    ) {
      report(index + 1);
      continue;
    }
    try {
      const glob = new Bun.Glob(anchored ? pattern : `**/${pattern}`);
      const prefix = pattern.split(/[*?[{]/, 1)[0];
      const segments = prefix.split("/").filter(Boolean);
      const literalDirs = directoryOnly || prefix.endsWith("/") ? segments : segments.slice(0, -1);
      rules.push({ glob, directoryOnly, literalDirs });
    } catch {
      report(index + 1);
    }
  }

  /** @param {string} path @param {boolean} directory */
  const matches = (path, directory) =>
    rules.some((rule) => (!rule.directoryOnly || directory) && rule.glob.match(path));

  return {
    /** A matched directory allows its whole subtree. @param {string} path @param {boolean} directory */
    allows(path, directory) {
      const parts = path.split("/");
      for (let i = 1; i < parts.length; i++)
        if (matches(parts.slice(0, i).join("/"), true)) return true;
      return matches(path, directory);
    },
    /** An ignored ancestor may need walking to reach a matching descendant. @param {string} path */
    mayContain(path) {
      const parts = path.split("/");
      return rules.some(
        (rule) =>
          parts.length <= rule.literalDirs.length &&
          parts.every((part, index) => part === rule.literalDirs[index]),
      );
    },
  };
}

/** @param {string} root */
export async function readPeruseShow(root) {
  try {
    const source = await readFile(join(root, ".peruseshow"), "utf8");
    const warn = warnedSources.get(root) === source ? () => {} : console.error;
    warnedSources.set(root, source);
    return parsePeruseShow(source, warn);
  } catch {
    warnedSources.delete(root);
    return parsePeruseShow("");
  }
}
