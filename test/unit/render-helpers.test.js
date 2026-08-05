import { describe, expect, test } from "bun:test";
import {
  esc,
  exceedsLineLimit,
  fmtSize,
  langForPath,
  resolveLang,
  splitFrontmatter,
} from "../../web/lib.js";

describe("splitFrontmatter", () => {
  test("parses rows and pads the body to preserve line numbers", () => {
    const src = "---\nCreated: 2026-07-20\nStatus: Active\n---\n\n# Title\n";
    const fm = splitFrontmatter(src);
    expect(fm.rows).toEqual([
      { key: "Created", value: "2026-07-20" },
      { key: "Status", value: "Active" },
    ]);
    // incident a113c4f: stripped lines must be replaced by blanks so
    // data-lines (and therefore change marks) stay true to file lines
    expect(fm.body.split("\n").length).toBe(src.split("\n").length);
    expect(fm.body).toContain("# Title");
    expect(fm.body).not.toContain("Created:");
  });

  test("non-key lines come through raw; CRLF accepted", () => {
    const fm = splitFrontmatter("---\r\ntags: [a, b]\r\n  nested: deep\r\n---\r\nbody\n");
    expect(fm.rows[0]).toEqual({ key: "tags", value: "[a, b]" });
    expect(fm.rows[1]).toEqual({ raw: "  nested: deep" });
  });

  test("no frontmatter → null (--- mid-file is not frontmatter)", () => {
    expect(splitFrontmatter("# Title\n\n---\n")).toBeNull();
    expect(splitFrontmatter("")).toBeNull();
  });
});

describe("language resolution", () => {
  const loaded = new Set(["python", "javascript", "go", "markdown", "make", "docker", "ini"]);
  test("maps extensions and aliases", () => {
    expect(langForPath("src/a.py", loaded)).toBe("python");
    expect(langForPath("a/b/c.mjs", loaded)).toBe("javascript");
    expect(resolveLang("sh", loaded)).toBe("shellscript"); // alias even if not in loaded
    // .svx is a code view in the composite mdsvex grammar, never markdown —
    // routing it to "markdown" would also hand it the Rendered/Raw toggle
    expect(langForPath("docs/post.svx", loaded)).toBe("mdsvex");
  });
  test("special filenames", () => {
    expect(langForPath("Dockerfile", loaded)).toBe("docker");
    expect(langForPath("Makefile", loaded)).toBe("make");
    expect(langForPath(".gitignore", loaded)).toBe("ini");
  });
  test("unknown falls back to text", () => {
    expect(langForPath("weird.xyz", loaded)).toBe("text");
    expect(resolveLang("", loaded)).toBe("text");
    // a grammar id with no LANG alias and absent from `loaded` — the
    // `loaded` set argument is otherwise never exercised by these tests
    expect(resolveLang("rust", loaded)).toBe("text");
    expect(resolveLang("go", loaded)).toBe("go"); // true branch: loaded contents matter
  });
});

describe("fmtSize / esc", () => {
  test("size boundaries", () => {
    expect(fmtSize(1023)).toBe("1023 B");
    expect(fmtSize(1024)).toBe("1.0 KB");
    expect(fmtSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });
  test("esc handles markup characters", () => {
    expect(esc("<a & b>")).toBe("&lt;a &amp; b&gt;");
  });
});

describe("exceedsLineLimit", () => {
  const terminated = (lines, newline = "\n") => `line${newline}`.repeat(lines);
  const unterminated = (lines) => Array.from({ length: lines }, () => "line").join("\n");

  for (const limit of [3500, 10_000]) {
    test(`${limit.toLocaleString()}-line boundary ignores one terminal newline`, () => {
      expect(exceedsLineLimit(terminated(limit), limit)).toBe(false);
      expect(exceedsLineLimit(unterminated(limit), limit)).toBe(false);
      expect(exceedsLineLimit(terminated(limit, "\r\n"), limit)).toBe(false);
      expect(exceedsLineLimit(terminated(limit + 1), limit)).toBe(true);
      expect(exceedsLineLimit(unterminated(limit + 1), limit)).toBe(true);
      expect(exceedsLineLimit(terminated(limit + 1, "\r\n"), limit)).toBe(true);
    });
  }
});
