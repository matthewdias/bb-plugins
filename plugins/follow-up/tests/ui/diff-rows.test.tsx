import { describe, expect, it } from "vitest";
import { clearRows, findDiff, OWNED, placeRows, readRows, removeRows, rowAtGutter } from "../../src/page/diff-rows.ts";
import { buildDiff, QUEUE_LINES, stacks } from "./diff-fixture.ts";

// What Follow Up adds to bb's diff: comment rows under the lines they are
// about, in both of its stacks, without disturbing how the stacks line up.

function wrapper(): HTMLElement {
  const element = document.createElement("div");
  document.body.append(element);
  return element;
}

const spanOf = (stack: HTMLElement) => Number(/span\s+(\d+)/.exec(stack.getAttribute("style") ?? "")?.[1]);
/** What each stack holds, in order: a line number, or "+" for a row Follow Up added. */
const shape = (stack: HTMLElement) =>
  Array.from(stack.children).map((child) => (child.hasAttribute(OWNED) ? "+" : (child.getAttribute("data-line") ?? child.getAttribute("data-column-number") ?? "-")));

describe("finding bb's diff", () => {
  it("finds a unified diff's stacks and reads its lines, a removed line on the old side", () => {
    const box = wrapper();
    buildDiff(box);
    const parts = findDiff(box);
    expect(parts).not.toBeNull();
    expect(readRows(parts!)).toEqual([
      { side: "new", line: 12, text: "  const max = 5;" },
      { side: "old", line: 13, text: "  retry(job);" },
      { side: "new", line: 13, text: "  retry(job, { backoff: true });" },
      { side: "new", line: 14, text: "  log(job);" },
      { side: "new", line: 15, text: "  return job;" },
    ]);
  });

  it("finds nothing where the markup is not as expected, so the caller can fall back", () => {
    const empty = wrapper();
    expect(findDiff(empty)).toBeNull();
    // bb's own stand-in for a diff it could not draw richly.
    const plain = wrapper();
    plain.innerHTML = "<pre data-testid='bb-diff'>+a</pre>";
    expect(findDiff(plain)).toBeNull();
    const closed = wrapper();
    closed.append(document.createElement("diffs-container"));
    expect(findDiff(closed)).toBeNull();
    const split = wrapper();
    buildDiff(split, QUEUE_LINES, { view: "split" });
    expect(findDiff(split)).toBeNull();
    const lopsided = wrapper();
    const host = buildDiff(lopsided);
    stacks(host).gutter.lastElementChild?.remove();
    expect(findDiff(lopsided)).toBeNull();
    const bare = wrapper();
    const noStacks = buildDiff(bare);
    stacks(noStacks).content.remove();
    expect(findDiff(bare)).toBeNull();
    const noLines = wrapper();
    buildDiff(noLines, []);
    expect(findDiff(noLines)).toBeNull();
  });
});

describe("placing comment rows", () => {
  it("puts a row under its line in both stacks, at the same place, and grows both spans", () => {
    const box = wrapper();
    const host = buildDiff(box);
    const parts = findDiff(box)!;
    const holders = placeRows(parts, [{ key: "c1", side: "new", line: 13 }]);
    const { gutter, content } = stacks(host);
    expect(shape(content)).toEqual(["12", "13", "13", "+", "14", "15"]);
    expect(shape(gutter)).toEqual(["12", "13", "13", "+", "14", "15"]);
    expect([spanOf(gutter), spanOf(content)]).toEqual([6, 6]);
    // The row is a named slot, filled from under the host, in the page's own document.
    const row = content.children[3] as HTMLElement;
    expect(row.getAttribute("data-line-annotation")).toBe("follow-up");
    expect(row.querySelector("slot")?.getAttribute("name")).toBe("follow-up-c1");
    expect((gutter.children[3] as HTMLElement).getAttribute("data-gutter-buffer")).toBe("annotation");
    const holder = holders.get("c1")!;
    expect(holder.parentElement).toBe(host);
    expect(holder.getAttribute("slot")).toBe("follow-up-c1");
    expect(host.shadowRoot!.contains(holder)).toBe(false);
  });

  it("tells a removed line from the line that replaced it", () => {
    const box = wrapper();
    const host = buildDiff(box);
    placeRows(findDiff(box)!, [{ key: "old", side: "old", line: 13 }]);
    expect(shape(stacks(host).content)).toEqual(["12", "13", "+", "13", "14", "15"]);
  });

  it("places several, two on one line in the order given, and skips a line the diff does not show", () => {
    const box = wrapper();
    const host = buildDiff(box);
    const holders = placeRows(findDiff(box)!, [
      { key: "a", side: "new", line: 12 },
      { key: "b", side: "new", line: 15 },
      { key: "c", side: "new", line: 15 },
      { key: "gone", side: "new", line: 99 },
    ]);
    const { gutter, content } = stacks(host);
    expect(shape(content)).toEqual(["12", "+", "13", "13", "14", "15", "+", "+"]);
    expect(shape(gutter)).toEqual(shape(content));
    expect(spanOf(content)).toBe(8);
    expect([...holders.keys()].sort()).toEqual(["a", "b", "c"]);
    const slots = Array.from(content.querySelectorAll("slot")).map((slot) => slot.getAttribute("name"));
    expect(slots).toEqual(["follow-up-a", "follow-up-b", "follow-up-c"]);
  });

  it("places a comment only under a line that still reads as it did", () => {
    const box = wrapper();
    const host = buildDiff(box);
    const holders = placeRows(findDiff(box)!, [
      { key: "same", side: "new", line: 14, text: "log(job);  " },
      { key: "moved", side: "new", line: 15, text: "  return other;" },
    ]);
    expect(shape(stacks(host).content)).toEqual(["12", "13", "13", "14", "+", "15"]);
    expect([...holders.keys()]).toEqual(["same"]);
  });

  it("keeps the stacks in step past a row that is not a line of code", () => {
    const box = wrapper();
    const host = buildDiff(box, QUEUE_LINES, { separatorAt: 3 });
    placeRows(findDiff(box)!, [{ key: "c", side: "new", line: 14 }]);
    const { gutter, content } = stacks(host);
    expect(shape(content)).toEqual(["12", "13", "13", "-", "14", "+", "15"]);
    expect(shape(gutter)).toEqual(["12", "13", "13", "-", "14", "+", "15"]);
  });

  it("can be run again: rows are replaced, not piled up, and a holder that stays is the same element", () => {
    const box = wrapper();
    const host = buildDiff(box);
    const parts = findDiff(box)!;
    const first = placeRows(parts, [{ key: "a", side: "new", line: 12 }, { key: "b", side: "new", line: 14 }]);
    const again = placeRows(findDiff(box)!, [{ key: "a", side: "new", line: 12 }]);
    const { gutter, content } = stacks(host);
    expect(shape(content)).toEqual(["12", "+", "13", "13", "14", "15"]);
    expect([spanOf(gutter), spanOf(content)]).toEqual([6, 6]);
    expect(again.get("a")).toBe(first.get("a"));
    expect(Array.from(host.children).map((child) => child.getAttribute("slot"))).toEqual(["follow-up-a"]);
    expect(host.shadowRoot!.querySelectorAll(`style[${OWNED}]`).length).toBe(1);
  });

  it("leaves the diff as it found it when the rows are taken out", () => {
    const box = wrapper();
    const host = buildDiff(box);
    const before = host.shadowRoot!.innerHTML;
    const parts = findDiff(box)!;
    placeRows(parts, [{ key: "a", side: "new", line: 12 }, { key: "b", side: "old", line: 13 }]);
    clearRows(parts);
    expect(host.shadowRoot!.innerHTML).toBe(before);
    expect(host.children.length).toBe(2);
    removeRows(parts);
    expect(host.children.length).toBe(0);
    // And it is still a diff Follow Up can read.
    expect(readRows(findDiff(box)!).length).toBe(5);
  });
});

describe("picking a line", () => {
  /** Press `target`, and read the pick while the event is still travelling, as the page does. */
  const pick = (parts: NonNullable<ReturnType<typeof findDiff>>, target: Element) => {
    let picked: ReturnType<typeof rowAtGutter> | undefined;
    parts.root.addEventListener("click", (event) => (picked = rowAtGutter(parts, event)), { once: true });
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    return picked;
  };

  it("a press on a line's number picks that line, on its side", () => {
    const box = wrapper();
    const host = buildDiff(box);
    const parts = findDiff(box)!;
    const { gutter } = stacks(host);
    expect(pick(parts, gutter.children[2]!)).toEqual({ side: "new", line: 13, text: "  retry(job, { backoff: true });" });
    expect(pick(parts, gutter.children[1]!)).toEqual({ side: "old", line: 13, text: "  retry(job);" });
  });

  it("a press on the code, or on a row Follow Up added, picks nothing", () => {
    const box = wrapper();
    const host = buildDiff(box);
    const parts = findDiff(box)!;
    placeRows(parts, [{ key: "a", side: "new", line: 12 }]);
    const { gutter, content } = stacks(host);
    expect(pick(parts, content.children[0]!.firstElementChild!)).toBeNull();
    expect(pick(parts, gutter.children[1]!)).toBeNull();
    // With a row added above it, the next line's number still picks that line.
    expect(pick(parts, gutter.children[2]!)?.line).toBe(13);
  });
});
