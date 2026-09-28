import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePeruseShow, readPeruseShow } from "../../server/peruseshow.js";

describe(".peruseshow patterns", () => {
  test("directory patterns work with or without a trailing slash", () => {
    const show = parsePeruseShow("notes/\ncache\n");
    expect(show.allows("notes", true)).toBe(true);
    expect(show.allows("deep/notes", true)).toBe(true);
    expect(show.allows("notes/todo.md", false)).toBe(true);
    expect(show.allows("cache", true)).toBe(true);
    expect(show.allows("cache/out.txt", false)).toBe(true);
    expect(show.allows("notes", false)).toBe(false);
  });

  test("leading slash anchors at the project root; globs and basenames work below it", () => {
    const show = parsePeruseShow("/docs/generated/\n**/scratch/*.md\n*.local.md\n");
    expect(show.allows("docs/generated", true)).toBe(true);
    expect(show.allows("deep/docs/generated", true)).toBe(false);
    expect(show.allows("scratch/a.md", false)).toBe(true);
    expect(show.allows("deep/scratch/a.md", false)).toBe(true);
    expect(show.allows("deep/note.local.md", false)).toBe(true);
    expect(show.allows("deep/note.txt", false)).toBe(false);
  });

  test("an internal slash anchors a pattern at the root", () => {
    const show = parsePeruseShow("docs/generated/\nbuild/reports/*.html\n");
    expect(show.allows("docs/generated", true)).toBe(true);
    expect(show.allows("x/docs/generated", true)).toBe(false);
    expect(show.allows("build/reports/out.html", false)).toBe(true);
    expect(show.allows("x/build/reports/out.html", false)).toBe(false);
  });

  test("only complete literal directory segments can open an ignored ancestor", () => {
    expect(parsePeruseShow("*.local.md\n").mayContain("node_modules")).toBe(false);
    expect(parsePeruseShow("n\n").mayContain("node_modules")).toBe(false);
    expect(parsePeruseShow("notes/\n").mayContain("notesx")).toBe(false);
    const show = parsePeruseShow("build/reports/*.html\n");
    expect(show.mayContain("build")).toBe(true);
    expect(show.mayContain("build/reports")).toBe(true);
    expect(show.mayContain("build/reports-old")).toBe(false);
  });

  test("comments and blanks do not match; a file pattern opens its ignored ancestors", () => {
    const show = parsePeruseShow("# notes\n  \n/notes/todo.md\n");
    expect(show.allows("notes/todo.md", false)).toBe(true);
    expect(show.allows("notes/other.md", false)).toBe(false);
    expect(show.mayContain("notes")).toBe(true);
    expect(show.mayContain("build")).toBe(false);
  });

  test("negation and malformed patterns are skipped", () => {
    const show = parsePeruseShow("!notes/\n[broken\nvalid/\n");
    expect(show.allows("notes", true)).toBe(false);
    expect(show.allows("valid", true)).toBe(true);
  });

  test("leading whitespace belongs to the pattern", () => {
    const show = parsePeruseShow(" notes/\n");
    expect(show.allows("notes", true)).toBe(false);
    expect(show.allows(" notes", true)).toBe(true);
  });

  test("warnings are limited per project and reset when its file changes", async () => {
    const first = mkdtempSync(join(tmpdir(), "peruse-show-warn-a-"));
    const second = mkdtempSync(join(tmpdir(), "peruse-show-warn-b-"));
    const messages = [];
    const original = console.error;
    console.error = (message) => messages.push(message);
    try {
      writeFileSync(join(first, ".peruseshow"), "[broken\n");
      writeFileSync(join(second, ".peruseshow"), "[broken\n");
      await readPeruseShow(first);
      await readPeruseShow(first);
      await readPeruseShow(second);
      expect(messages.filter((message) => message.includes("line 1"))).toHaveLength(2);
      writeFileSync(join(first, ".peruseshow"), "!bad\n");
      await readPeruseShow(first);
      expect(messages.filter((message) => message.includes("line 1"))).toHaveLength(3);
    } finally {
      console.error = original;
      rmSync(first, { recursive: true, force: true });
      rmSync(second, { recursive: true, force: true });
    }
  });
});
