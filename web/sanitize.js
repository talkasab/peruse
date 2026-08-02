import createDOMPurify from "dompurify";

// Alpine observes newly inserted DOM. Its directives are executable content,
// even though generic HTML sanitizers reasonably treat many of their attribute
// names as inert custom data.
const ALPINE_DIRECTIVE = /^(?:x-|@|:)/i;

export function createHTMLSanitizer(browserWindow) {
  const purifier = createDOMPurify(browserWindow);
  purifier.addHook("uponSanitizeAttribute", (_node, data) => {
    if (ALPINE_DIRECTIVE.test(data.attrName)) data.keepAttr = false;
  });
  return (html) => purifier.sanitize(html);
}
