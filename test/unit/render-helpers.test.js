import { describe, test, expect } from "bun:test";
import { splitFrontmatter, resolveLang, langForPath, fmtSize, esc } from "../../web/lib.js";

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
