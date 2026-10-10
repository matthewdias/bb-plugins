// Putting comment rows into the diff bb drew.
//
// Every assumption this plugin makes about bb's diff markup is in this file,
// and nowhere else. bb draws a file's diff with its diff renderer into a
// `<diffs-container>` element whose shadow root is open. In unified view the
// shadow root holds, per block of the file:
//
//   <code data-code data-unified>
//     <div data-gutter  style="grid-row: span N"> …N cells…  </div>
//     <div data-content style="grid-row: span N"> …N rows…   </div>
//   </code>
//
// The two stacks share a grid, so gutter cell i sits beside content row i by
// position alone. A content row for a line of code carries `data-line`, its
// number, and `data-line-type`; a removed line's number is the old file's,
// any other line's the new file's.
//
// A comment row therefore goes into both stacks at the same index, and both
// `grid-row` spans grow by one. What the row shows is not built in here: the
// row holds a named `<slot>`, and the comment is an ordinary element under
// the `<diffs-container>` host that fills it. Slotted content stays in the
// page's own document, so it keeps the page's styles, which a shadow root
// would otherwise shut out.
//
// None of this is a contract bb offers. If the markup is not as described,
// `findDiff` returns null and the review falls back to a comment box under
// the file (review.tsx), losing the inline rows and nothing else.
import type { Side } from "../../lib/review.ts";

/** Marks every node this file created, so all of it can be found and removed. */
export const OWNED = "data-follow-up-row";
const OLD_TYPES = new Set(["deletion", "change-deletion"]);

export interface DiffBlock {
  gutter: HTMLElement;
  content: HTMLElement;
}

export interface DiffParts {
  /** The `<diffs-container>` element; slotted comment content hangs off it. */
  host: HTMLElement;
  root: ShadowRoot;
  blocks: DiffBlock[];
}

export interface DiffRow {
  side: Side;
  line: number;
  /** The line's code, without the marker column. */
  text: string;
}

function childWith(parent: Element, attribute: string): HTMLElement | null {
  for (const child of Array.from(parent.children)) {
    if (child instanceof HTMLElement && child.hasAttribute(attribute)) return child;
  }
  return null;
}

/** A stack's rows, leaving out the ones this file put there. */
function ownRowsOut(stack: Element): Element[] {
  return Array.from(stack.children).filter((child) => !child.hasAttribute(OWNED));
}

/**
 * bb's diff under `wrapper`, or null when it is not there yet or not shaped
 * as this file expects: no host, a closed shadow root, a split view, or
 * stacks that do not line up.
 */
export function findDiff(wrapper: Element): DiffParts | null {
  const host = wrapper.querySelector("diffs-container");
  if (!(host instanceof HTMLElement) || host.shadowRoot === null) return null;
  const root = host.shadowRoot;
  const codes = Array.from(root.querySelectorAll("code[data-code]"));
  if (codes.length === 0 || codes.some((code) => !code.hasAttribute("data-unified"))) return null;
  const blocks: DiffBlock[] = [];
  for (const code of codes) {
    const gutter = childWith(code, "data-gutter");
    const content = childWith(code, "data-content");
    if (gutter === null || content === null) return null;
    if (ownRowsOut(gutter).length !== ownRowsOut(content).length) return null;
    blocks.push({ gutter, content });
  }
  return blocks.some((block) => rowsOf(block).length > 0) ? { host, root, blocks } : null;
}

function rowOf(element: Element): DiffRow | null {
  if (element.hasAttribute(OWNED)) return null;
  const raw = element.getAttribute("data-line");
  if (raw === null || raw === "") return null;
  const line = Number(raw);
  if (!Number.isInteger(line) || line < 1) return null;
  const type = element.getAttribute("data-line-type") ?? "";
  return { side: OLD_TYPES.has(type) ? "old" : "new", line, text: element.textContent ?? "" };
}

function rowsOf(block: DiffBlock): Array<{ row: DiffRow; element: Element }> {
  return Array.from(block.content.children).flatMap((element) => {
    const row = rowOf(element);
    return row === null ? [] : [{ row, element }];
  });
}

/** Every line of code the diff shows, in order. */
export function readRows(parts: DiffParts): DiffRow[] {
  return parts.blocks.flatMap((block) => rowsOf(block).map((entry) => entry.row));
}

/**
 * The line a click landed on, when it landed in the gutter: its line-number
 * column. A click on the code itself is left alone, so text can be selected.
 */
export function rowAtGutter(parts: DiffParts, event: Event): DiffRow | null {
  const path = event.composedPath();
  for (const block of parts.blocks) {
    const cell = path.find((node): node is Element => node instanceof Element && node.parentElement === block.gutter);
    if (cell === undefined) continue;
    // Beside a row this file added sits another it added, which is no line.
    const index = Array.from(block.gutter.children).indexOf(cell);
    const beside = block.content.children[index];
    return beside === undefined ? null : rowOf(beside);
  }
  return null;
}

function bumpSpan(stack: HTMLElement, by: number): void {
  const style = stack.getAttribute("style") ?? "";
  const match = /grid-row:\s*span\s+(\d+)/.exec(style);
  if (match === null) return;
  stack.setAttribute("style", style.replace(match[0], `grid-row: span ${Math.max(0, Number(match[1]) + by)}`));
}

/** Take out every row this file added, and give the stacks their spans back. */
export function clearRows(parts: DiffParts): void {
  for (const block of parts.blocks) {
    for (const stack of [block.gutter, block.content]) {
      const mine = Array.from(stack.children).filter((child) => child.hasAttribute(OWNED));
      for (const node of mine) node.remove();
      bumpSpan(stack, -mine.length);
    }
  }
  for (const node of Array.from(parts.root.children)) if (node.hasAttribute(OWNED)) node.remove();
}

const slotName = (key: string) => `follow-up-${key}`;

/** What marks the gutter as pressable, since a shadow root shuts the page's styles out. */
const GUTTER_STYLE = `[data-gutter] > :not([${OWNED}]) { cursor: pointer; }
[data-gutter] > :not([${OWNED}]):hover { text-decoration: underline; }`;

export interface Anchor {
  /** Unique among the anchors, and usable in a slot name: letters, digits, dashes. */
  key: string;
  side: Side;
  line: number;
}

/**
 * Make room under each anchored line, and return for each the element to
 * draw into. Rows from an earlier call are replaced, so this can be run again
 * whenever the anchors change or bb redraws. An anchor whose line the diff
 * does not show gets no element, and the caller shows that comment elsewhere.
 */
export function placeRows(parts: DiffParts, anchors: readonly Anchor[]): Map<string, HTMLElement> {
  clearRows(parts);
  const style = document.createElement("style");
  style.setAttribute(OWNED, "");
  style.textContent = GUTTER_STYLE;
  parts.root.append(style);

  const placed = new Set<string>();
  for (const block of parts.blocks) {
    // Bottom up, so an insertion never moves a row still to be found.
    const rows = rowsOf(block).reverse();
    for (const { row, element } of rows) {
      const here = anchors.filter((anchor) => !placed.has(anchor.key) && anchor.side === row.side && anchor.line === row.line);
      if (here.length === 0) continue;
      const index = Array.from(block.content.children).indexOf(element);
      const cell = block.gutter.children[index];
      // In order under the line, so the last inserted directly after it comes first.
      for (const anchor of [...here].reverse()) {
        const annotation = document.createElement("div");
        annotation.setAttribute(OWNED, "");
        annotation.setAttribute("data-line-annotation", "follow-up");
        const inner = document.createElement("div");
        inner.setAttribute("data-annotation-content", "");
        const slot = document.createElement("slot");
        slot.setAttribute("name", slotName(anchor.key));
        inner.append(slot);
        annotation.append(inner);
        element.after(annotation);

        const gap = document.createElement("div");
        gap.setAttribute(OWNED, "");
        gap.setAttribute("data-gutter-buffer", "annotation");
        gap.setAttribute("data-line-type", element.getAttribute("data-line-type") ?? "context");
        if (cell !== undefined) cell.after(gap);
        else block.gutter.append(gap);

        bumpSpan(block.content, 1);
        bumpSpan(block.gutter, 1);
        placed.add(anchor.key);
      }
    }
  }

  // The elements that fill the slots: under the host, in the page's own document.
  const holders = new Map<string, HTMLElement>();
  const wanted = new Set([...placed].map(slotName));
  for (const child of Array.from(parts.host.children)) {
    if (!(child instanceof HTMLElement) || !child.hasAttribute(OWNED)) continue;
    const name = child.getAttribute("slot") ?? "";
    if (!wanted.has(name)) child.remove();
  }
  for (const key of placed) {
    const name = slotName(key);
    let holder = Array.from(parts.host.children).find(
      (child): child is HTMLElement => child instanceof HTMLElement && child.getAttribute("slot") === name,
    );
    if (holder === undefined) {
      holder = document.createElement("div");
      holder.setAttribute("slot", name);
      holder.setAttribute(OWNED, "");
      parts.host.append(holder);
    }
    holders.set(key, holder);
  }
  return holders;
}

/** Remove everything this file added to a diff, slotted content included. */
export function removeRows(parts: DiffParts): void {
  clearRows(parts);
  for (const child of Array.from(parts.host.children)) if (child.hasAttribute(OWNED)) child.remove();
}
