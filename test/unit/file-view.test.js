import { expect, test } from "bun:test";
import * as fileHelpers from "../../web/lib.js";

test("SVG is an image with a source toggle", () => {
  const fileView = fileHelpers.fileView;
  expect(fileView?.("art/logo.svg", false)).toEqual({ kind: "image", sourceToggle: true });
  expect(fileView("art/logo.SVG", false)).toEqual({ kind: "image", sourceToggle: true });
  expect(fileView("art/plain-text.svg", false)).toEqual({ kind: "image", sourceToggle: true });
  expect(fileView("art/binary.svg", true)).toEqual({ kind: "binary", sourceToggle: false });
  expect(fileView("art/logo.png", true)).toEqual({ kind: "image", sourceToggle: false });
  expect(fileView("docs/readme.md", false)).toEqual({ kind: "markdown", sourceToggle: true });
  expect(fileView("docs/page.html", false)).toEqual({ kind: "code", sourceToggle: false });
});
