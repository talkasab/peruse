import { describe, expect, test } from "bun:test";
import { resolveLink } from "../../web/lib.js";

const file = (path) => ({ name: path.split("/").at(-1), path, dir: false });
const folder = (path, children) => ({
  name: path.split("/").at(-1),
  path,
  dir: true,
  children,
});

const tree = [
  folder("glossary", [file("glossary/root.md")]),
  folder("knowledge", [
    file("knowledge/index.md"),
    folder("knowledge/glossary", [
      file("knowledge/glossary/a.md"),
      file("knowledge/glossary/b.md"),
      file("knowledge/glossary/c.md"),
    ]),
    folder("knowledge/roadmap", [file("knowledge/roadmap/index.md")]),
    folder("knowledge/guides", [file("knowledge/guides/README.md")]),
    folder("knowledge/empty", []),
    folder("knowledge/deep", [
      folder("knowledge/deep/topic", [file("knowledge/deep/topic/page.md")]),
    ]),
    folder("knowledge/assets", [file("knowledge/assets/diagram.svg")]),
  ]),
];

describe("Markdown link resolution", () => {
  test("root-absolute links try project root before nearer content ancestors", () => {
    expect(resolveLink(tree, "knowledge/deep/topic/page.md", "/glossary/root.md")).toEqual({
      path: "glossary/root.md",
      directory: null,
      fragment: "",
      found: true,
    });
    expect(resolveLink(tree, "README.md", "/glossary/root.md").path).toBe("glossary/root.md");
  });

  test("root-absolute links find a content root two ancestors above the file", () => {
    expect(resolveLink(tree, "knowledge/deep/topic/page.md", "/glossary/b.md")).toEqual({
      path: "knowledge/glossary/b.md",
      directory: null,
      fragment: "",
      found: true,
    });
    expect(resolveLink(tree, "knowledge/index.md", "/glossary/b.md").path).toBe(
      "knowledge/glossary/b.md",
    );
    expect(resolveLink(tree, "knowledge/glossary/a.md", "/assets/diagram.svg").path).toBe(
      "knowledge/assets/diagram.svg",
    );
  });

  test("relative links keep their directory and resolve parent segments", () => {
    expect(resolveLink(tree, "knowledge/glossary/a.md", "./c.md").path).toBe(
      "knowledge/glossary/c.md",
    );
    expect(resolveLink(tree, "knowledge/glossary/a.md", "../roadmap/index.md").path).toBe(
      "knowledge/roadmap/index.md",
    );
  });

  test("directory links choose index.md, then README.md, and retain the directory", () => {
    expect(resolveLink(tree, "knowledge/glossary/a.md", "/roadmap/")).toEqual({
      path: "knowledge/roadmap/index.md",
      directory: "knowledge/roadmap",
      fragment: "",
      found: true,
    });
    expect(resolveLink(tree, "knowledge/glossary/a.md", "/roadmap").path).toBe(
      "knowledge/roadmap/index.md",
    );
    expect(resolveLink(tree, "knowledge/glossary/a.md", "../guides/")).toEqual({
      path: "knowledge/guides/README.md",
      directory: "knowledge/guides",
      fragment: "",
      found: true,
    });
    expect(resolveLink(tree, "knowledge/index.md", "./empty/")).toEqual({
      path: null,
      directory: "knowledge/empty",
      fragment: "",
      found: true,
    });
  });

  test("a missing extension retries .md; an unresolved target keeps the old path", () => {
    expect(resolveLink(tree, "knowledge/glossary/a.md", "/glossary/b").path).toBe(
      "knowledge/glossary/b.md",
    );
    expect(resolveLink(tree, "knowledge/glossary/a.md", "/glossary/missing.md")).toEqual({
      path: "knowledge/glossary/glossary/missing.md",
      directory: null,
      fragment: "",
      found: false,
    });
  });

  test("cross-file fragments travel with the resolved file path", () => {
    expect(resolveLink(tree, "knowledge/glossary/a.md", "./c.md#section-two")).toEqual({
      path: "knowledge/glossary/c.md",
      directory: null,
      fragment: "section-two",
      found: true,
    });
  });

  test("query strings are excluded from lookup and fragments still reach the target", () => {
    expect(resolveLink(tree, "knowledge/glossary/a.md", "/glossary/b.md?v=1#section-two")).toEqual({
      path: "knowledge/glossary/b.md",
      directory: null,
      fragment: "section-two",
      found: true,
    });
  });

  test("each root-absolute candidate tries its file before a later directory", () => {
    const withShadow = [
      file("foo.md"),
      folder("knowledge", [
        file("knowledge/page.md"),
        folder("knowledge/foo", [file("knowledge/foo/index.md")]),
      ]),
    ];
    expect(resolveLink(withShadow, "knowledge/page.md", "/foo").path).toBe("foo.md");
  });

  test("a root link opens the project or content-root index, or the tree root", () => {
    expect(resolveLink([file("index.md"), ...tree], "knowledge/glossary/a.md", "/")).toEqual({
      path: "index.md",
      directory: "",
      fragment: "",
      found: true,
    });
    expect(resolveLink(tree, "knowledge/glossary/a.md", "/")).toEqual({
      path: "knowledge/index.md",
      directory: "knowledge",
      fragment: "",
      found: true,
    });
    expect(
      resolveLink([folder("knowledge", [file("knowledge/page.md")])], "knowledge/page.md", "/"),
    ).toEqual({
      path: null,
      directory: "",
      fragment: "",
      found: true,
    });
  });

  test("a trailing slash on a file resolves to the file", () => {
    expect(resolveLink(tree, "knowledge/glossary/a.md", "/glossary/b.md/")).toEqual({
      path: "knowledge/glossary/b.md",
      directory: null,
      fragment: "",
      found: true,
    });
  });
});
