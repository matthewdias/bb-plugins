import { describe, expect, it } from "vitest";
import { readDetail, readOpen, safeFile, safeHref } from "../lib/validate";

describe("safeHref", () => {
  it("accepts http and https URLs and app paths with one leading slash", () => {
    expect(safeHref("https://github.com/matthewdias/bb-plugins/pull/41")).toBe(
      "https://github.com/matthewdias/bb-plugins/pull/41",
    );
    expect(safeHref("http://localhost:3000/x")).toBe("http://localhost:3000/x");
    expect(safeHref("/projects/p/threads/t")).toBe("/projects/p/threads/t");
  });

  it.each([
    ["a protocol-relative URL", "//evil.example/x"],
    ["a tab that a browser strips to make //x", "/\t/x"],
    ["a newline that a browser strips", "/\n/x"],
    ["a backslash a browser reads as a slash", "/\\evil.example"],
    ["a space", "/a b"],
    ["a leading space", " https://example.com"],
    ["a control character", "/a\u0001b"],
    ["a C1 control", "/a\u0085b"],
    ["a non-breaking space", "/a\u00a0b"],
    ["javascript:", "javascript:alert(1)"],
    ["data:", "data:text/html,hi"],
    ["a relative path", "projects/p"],
    ["a bare word", "about"],
    ["the empty string", ""],
  ])("refuses %s", (_name, href) => {
    expect(safeHref(href)).toBeNull();
  });

  it("refuses what is not a string, and anything over its length cap", () => {
    expect(safeHref(42)).toBeNull();
    expect(safeHref(null)).toBeNull();
    expect(safeHref({ href: "/x" })).toBeNull();
    expect(safeHref(`/${"a".repeat(2048)}`)).toBeNull();
  });
});

describe("safeFile", () => {
  it("accepts a path relative to the workspace", () => {
    expect(safeFile("plugins/thread-summary/app.tsx")).toBe("plugins/thread-summary/app.tsx");
    expect(safeFile("README.md")).toBe("README.md");
    expect(safeFile("a/./b.ts")).toBe("a/./b.ts");
    expect(safeFile("a..b/c")).toBe("a..b/c");
    expect(safeFile("docs/my notes.md")).toBe("docs/my notes.md");
    expect(safeFile("a/b:c.txt")).toBe("a/b:c.txt");
  });

  it.each([
    ["an absolute path", "/etc/passwd"],
    ["a backslash-absolute path", "\\Windows\\x"],
    ["a drive letter", "C:\\Windows"],
    ["a drive letter with a slash", "c:/x"],
    ["a leading ..", "../secret"],
    ["a .. in the middle", "a/../../b"],
    ["a trailing ..", "a/.."],
    ["a .. behind a backslash", "a\\..\\b"],
    ["a control character", "a\u0000b"],
    ["a newline", "a\nb"],
    ["the empty string", ""],
    ["a leading space", " /etc/passwd"],
    ["a segment with a trailing space, which Windows strips to ..", "a/.. /x"],
    ["a segment with a leading space", "a/ ../x"],
    ["a trailing space", "a/b.ts "],
    ["a segment of only a tab", "a/\t/b"],
    ["a non-breaking space at a segment's edge", "a/\u00a0b"],
    ["a file: URL", "file:///etc/passwd"],
    ["any other scheme", "vscode://file/x"],
    ["a colon before the first slash", "c:x/y"],
    ["a colon in a bare name", "notes:txt"],
  ])("refuses %s", (_name, file) => {
    expect(safeFile(file)).toBeNull();
  });

  it("refuses what is not a string", () => {
    expect(safeFile(undefined)).toBeNull();
    expect(safeFile(["a"])).toBeNull();
  });
});

describe("readDetail", () => {
  it("keeps well-formed rows and their links", () => {
    expect(
      readDetail({
        detail: {
          title: "#41 Thread Summary",
          rows: [
            { label: "Checks", value: "passing", tone: "success", icon: "Check" },
            { label: "PR", href: "https://github.com/x/y/pull/1" },
            { label: "app.tsx", value: "+1 −2", file: "app.tsx" },
          ],
        },
      }),
    ).toEqual({
      title: "#41 Thread Summary",
      rows: [
        { label: "Checks", value: "passing", tone: "success", icon: "Check" },
        { label: "PR", href: "https://github.com/x/y/pull/1" },
        { label: "app.tsx", value: "+1 −2", file: "app.tsx" },
      ],
    });
  });

  it("drops a bad link but keeps its row", () => {
    expect(
      readDetail({
        detail: {
          rows: [
            { label: "evil", href: "//evil.example" },
            { label: "secret", file: "../../etc/passwd" },
          ],
        },
      }),
    ).toEqual({ rows: [{ label: "evil" }, { label: "secret" }] });
  });

  it("drops a row whose label is only whitespace, and blank fields", () => {
    expect(
      readDetail({ detail: { title: "   ", rows: [{ label: " \t " }, { label: "ok", value: "  ", tone: " " }] } }),
    ).toEqual({ rows: [{ label: "ok" }] });
  });

  it("drops rows without a label, and fields of the wrong type", () => {
    expect(
      readDetail({
        detail: { rows: [{ value: "x" }, "row", null, { label: "ok", value: 3, tone: {} }] },
      }),
    ).toEqual({ rows: [{ label: "ok" }] });
  });

  it("is null when there is nothing to draw", () => {
    expect(readDetail({})).toBeNull();
    expect(readDetail({ detail: "text" })).toBeNull();
    expect(readDetail({ detail: { rows: [] } })).toBeNull();
    expect(readDetail({ detail: { rows: "x" } })).toBeNull();
    expect(readDetail(null)).toBeNull();
  });

  it("keeps a title with no rows", () => {
    expect(readDetail({ detail: { title: "Only a title" } })).toEqual({ title: "Only a title", rows: [] });
  });
});

describe("readOpen", () => {
  it("passes a safe href through", () => {
    expect(readOpen({ open: { href: "https://github.com/x" } })).toEqual({ href: "https://github.com/x" });
  });

  it("refuses an unsafe href, a missing one, and an open that is not an object", () => {
    expect(readOpen({ open: { href: "javascript:alert(1)" } })).toBeNull();
    expect(readOpen({ open: { href: "/\t/x" } })).toBeNull();
    expect(readOpen({ open: {} })).toBeNull();
    expect(readOpen({ open: "https://github.com/x" })).toBeNull();
    expect(readOpen({})).toBeNull();
  });
});
