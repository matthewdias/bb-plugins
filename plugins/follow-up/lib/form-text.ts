// The text of a form, read into the few shapes a form draws.
//
// A form's text is written by an agent and shown to a person who is about to
// answer under their own name, so it is not handed to a general Markdown
// renderer. That would draw whatever Markdown can express: an image, which
// loads the moment it is shown and tells a server so, or raw HTML. Checking
// the text for those first is no answer, because the check and the renderer
// would have to agree on every corner of Markdown, and they would not.
//
// So this reads only what is listed here, and everything else is plain text.
// There is no image and no HTML because nothing below produces one, whatever
// the text holds: `![x](y)` is an exclamation mark and a link nobody has
// pressed, and `<img>` is five characters.
//
// Pure, so the reading is tested without a browser. src/form-text.tsx draws it.

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "strong"; children: Inline[] }
  | { kind: "em"; children: Inline[] }
  /** Always http or https; anything else stays text. */
  | { kind: "link"; url: string; children: Inline[] };

export type Block =
  | { kind: "paragraph"; inline: Inline[] }
  | { kind: "heading"; inline: Inline[] }
  | { kind: "code"; text: string }
  | { kind: "list"; ordered: boolean; items: Inline[][] }
  | { kind: "quote"; inline: Inline[] };

function isWebUrl(url: string): boolean {
  if (/\s/.test(url)) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

/** A word character either side means an underscore is part of a name, not emphasis. */
const WORD = /[\p{L}\p{N}]/u;

function pushText(out: Inline[], text: string): void {
  if (text === "") return;
  const last = out[out.length - 1];
  if (last?.kind === "text") last.text += text;
  else out.push({ kind: "text", text });
}

/**
 * One line's worth of text as spans: `code`, **strong**, *emphasis* or
 * _emphasis_, and [text](https://…). A marker with no partner, or a link that
 * does not go to the web, is left as the characters it is.
 */
export function readInline(text: string): Inline[] {
  const out: Inline[] = [];
  let at = 0;
  while (at < text.length) {
    const char = text[at]!;
    if (char === "`") {
      const end = text.indexOf("`", at + 1);
      if (end > at + 1) {
        out.push({ kind: "code", text: text.slice(at + 1, end) });
        at = end + 1;
        continue;
      }
    } else if (text.startsWith("**", at)) {
      const end = text.indexOf("**", at + 2);
      if (end > at + 2) {
        out.push({ kind: "strong", children: readInline(text.slice(at + 2, end)) });
        at = end + 2;
        continue;
      }
    } else if (char === "*" || char === "_") {
      const end = text.indexOf(char, at + 1);
      const inner = end === -1 ? "" : text.slice(at + 1, end);
      const named =
        char === "_" && (WORD.test(text[at - 1] ?? "") || WORD.test(text[end + 1] ?? ""));
      if (end > at + 1 && inner.trim() === inner && !named) {
        out.push({ kind: "em", children: readInline(inner) });
        at = end + 1;
        continue;
      }
    } else if (char === "[") {
      const close = text.indexOf("]", at + 1);
      if (close > at + 1 && text[close + 1] === "(") {
        const end = text.indexOf(")", close + 2);
        const url = end === -1 ? "" : text.slice(close + 2, end);
        if (end !== -1 && isWebUrl(url)) {
          out.push({ kind: "link", url, children: readInline(text.slice(at + 1, close)) });
          at = end + 1;
          continue;
        }
      }
    }
    pushText(out, char);
    at += 1;
  }
  return out;
}

const FENCE = /^\s*```/;
const HEADING = /^#{1,6}\s+(.*)$/;
const BULLET = /^\s*[-*]\s+(.*)$/;
const NUMBER = /^\s*\d{1,3}[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;

/**
 * Text as blocks: paragraphs, headings, fenced code, bulleted and numbered
 * lists, and quotes. A fence left open runs to the end, as code: text that
 * was meant as code is never read as anything else.
 */
export function readFormText(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  // Lines that run on, joined before they are read so a span may cross them.
  let paragraph: string[] = [];
  let quote: string[] = [];
  const flush = () => {
    if (paragraph.length > 0) blocks.push({ kind: "paragraph", inline: readInline(paragraph.join(" ")) });
    if (quote.length > 0) blocks.push({ kind: "quote", inline: readInline(quote.join(" ")) });
    paragraph = [];
    quote = [];
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (FENCE.test(line)) {
      flush();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !FENCE.test(lines[index]!)) {
        code.push(lines[index]!);
        index += 1;
      }
      blocks.push({ kind: "code", text: code.join("\n") });
      continue;
    }
    if (line.trim() === "") {
      flush();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading !== null) {
      flush();
      blocks.push({ kind: "heading", inline: readInline(heading[1]!.trim()) });
      continue;
    }
    const bullet = BULLET.exec(line);
    const number = bullet === null ? NUMBER.exec(line) : null;
    const item = bullet ?? number;
    if (item !== null) {
      flush();
      const ordered = bullet === null;
      const last = blocks[blocks.length - 1];
      const inline = readInline(item[1]!.trim());
      if (last?.kind === "list" && last.ordered === ordered) last.items.push(inline);
      else blocks.push({ kind: "list", ordered, items: [inline] });
      continue;
    }
    const quoted = QUOTE.exec(line);
    if (quoted !== null) {
      if (paragraph.length > 0) flush();
      quote.push(quoted[1]!.trim());
      continue;
    }
    if (quote.length > 0) flush();
    paragraph.push(line.trim());
  }
  flush();
  return blocks;
}
