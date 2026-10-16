// What a form's text is read into. The security property is by construction:
// these are the only shapes there are, and none of them is an image or HTML.
import assert from "node:assert/strict";
import test from "node:test";
import { readFormText, readInline, type Block, type Inline } from "../lib/form-text.ts";

const text = (value: string): Inline => ({ kind: "text", text: value });

/** Every kind of span or block anywhere in a reading. */
function kinds(blocks: readonly Block[]): Set<string> {
  const seen = new Set<string>();
  const walk = (inline: readonly Inline[]) => {
    for (const span of inline) {
      seen.add(span.kind);
      if ("children" in span) walk(span.children);
    }
  };
  for (const block of blocks) {
    seen.add(block.kind);
    if (block.kind === "list") block.items.forEach(walk);
    else if (block.kind !== "code") walk(block.inline);
  }
  return seen;
}

test("readInline: code, strong, emphasis and web links; everything else is text", () => {
  assert.deepEqual(readInline("Run `npm test` **now**, *please*, or _later_."), [
    text("Run "),
    { kind: "code", text: "npm test" },
    text(" "),
    { kind: "strong", children: [text("now")] },
    text(", "),
    { kind: "em", children: [text("please")] },
    text(", or "),
    { kind: "em", children: [text("later")] },
    text("."),
  ]);
  assert.deepEqual(readInline("See [the **issue**](https://x.test/1)."), [
    text("See "),
    { kind: "link", url: "https://x.test/1", children: [text("the "), { kind: "strong", children: [text("issue")] }] },
    text("."),
  ]);
});

test("readInline: a marker with no partner, and a name with underscores, stay as they are", () => {
  assert.deepEqual(readInline("5 * 3 and a_b_c and snake_case_name"), [text("5 * 3 and a_b_c and snake_case_name")]);
  assert.deepEqual(readInline("an unclosed `tick and **star"), [text("an unclosed `tick and **star")]);
  assert.deepEqual(readInline("* not emphasis *"), [text("* not emphasis *")]);
  assert.deepEqual(readInline("[just brackets] (apart)"), [text("[just brackets] (apart)")]);
});

test("readInline: a link goes to the web or it is not a link", () => {
  for (const url of ["javascript:alert(1)", "file:///etc/passwd", "/api/v1/threads", "data:text/html,x", "https://x.test/a b", ""]) {
    assert.deepEqual(readInline(`[click](${url})`), [text(`[click](${url})`)], url);
  }
  assert.equal(readInline("[ok](http://x.test)")[0]?.kind, "link");
});

test("readFormText: paragraphs, headings, lists, quotes and fenced code", () => {
  assert.deepEqual(
    readFormText("# Plan\n\nTwo lines\nof one paragraph.\n\n- one\n- **two**\n\n1. first\n2) second\n\n> quoted\n> again\n\n```ts\nconst a = *b*;\n<img src=x>\n```\nafter"),
    [
      { kind: "heading", inline: [text("Plan")] },
      { kind: "paragraph", inline: [text("Two lines of one paragraph.")] },
      { kind: "list", ordered: false, items: [[text("one")], [{ kind: "strong", children: [text("two")] }]] },
      { kind: "list", ordered: true, items: [[text("first")], [text("second")]] },
      { kind: "quote", inline: [text("quoted again")] },
      { kind: "code", text: "const a = *b*;\n<img src=x>" },
      { kind: "paragraph", inline: [text("after")] },
    ],
  );
  assert.deepEqual(readFormText("a\r\nb"), [{ kind: "paragraph", inline: [text("a b")] }], "Windows line ends are line ends");
  assert.deepEqual(readFormText("```\nstill code\n**not bold**"), [{ kind: "code", text: "still code\n**not bold**" }], "an open fence runs to the end");
  assert.deepEqual(readFormText("  \n\n"), []);
});

test("readFormText: no way to write an image or HTML, whatever Markdown would make of it", () => {
  const attempts = [
    "![shot](https://x.test/a.png)",
    "![a [b] c](https://x.test/a.png)",
    "![shot][ref]\n\n[ref]: https://x.test/a.png",
    "![ref]\n\n[ref]: https://x.test/a.png",
    "!\n[shot](https://x.test/a.png)",
    '<img src="https://x.test/a.png">',
    '<IMG SRC=/api/v1/x onerror="alert(1)">',
    '<picture><source srcset="https://x.test/a.png"></picture>',
    '<svg><image href="https://x.test/a.png"/></svg>',
    '<video poster="https://x.test/a.png"></video>',
    '<iframe src="https://x.test"></iframe>',
    '<div style="background:url(https://x.test/a.png)">x</div>',
    "<script>fetch('https://x.test')</script>",
    "[![badge](https://x.test/a.png)](https://x.test)",
    "&#33;[shot](https://x.test/a.png)",
  ];
  const allowed = new Set(["paragraph", "heading", "code", "list", "quote", "text", "strong", "em", "link"]);
  for (const attempt of attempts) {
    const read = readFormText(attempt);
    for (const kind of kinds(read)) assert.ok(allowed.has(kind), `${kind} from ${attempt}`);
    // What is left of an image is, at most, a link nobody has pressed.
    const flat = JSON.stringify(read);
    assert.equal(/"kind":"(image|html|img)"/.test(flat), false, attempt);
  }
  assert.deepEqual(readFormText('<img src="https://x.test/a.png">'), [{ kind: "paragraph", inline: [text('<img src="https://x.test/a.png">')] }]);
  assert.deepEqual(readFormText("![shot](https://x.test/a.png)"), [
    { kind: "paragraph", inline: [text("!"), { kind: "link", url: "https://x.test/a.png", children: [text("shot")] }] },
  ]);
});
