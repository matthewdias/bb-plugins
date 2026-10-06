import { afterEach, describe, expect, it, vi } from "vitest";
import { modifierMatches, type ReadPoint } from "../lib/read-point";
import {
  type ClickLike,
  findMessageRow,
  findTargetRow,
  findViewport,
  resolveClick,
  revealRow,
  searchDirection,
} from "../lib/timeline";

const T = "thr_a";
const user = (seq: number) => `${T}:user-seed:${seq}`;
const agent = (turn: string, item: string) => `${T}:assistant:kind:assistant|turn:${turn}|parent:root|item:${item}`;

interface RowSpec {
  id: string;
  index?: number;
  html?: string;
  children?: RowSpec[];
}

function row(spec: RowSpec): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-timeline-row-id", spec.id);
  if (spec.index !== undefined) el.setAttribute("data-index", String(spec.index));
  el.innerHTML = spec.html ?? `<p>text of ${spec.id}</p>`;
  for (const child of spec.children ?? []) el.append(row(child));
  return el;
}

/** bb's shape: a scroll viewport around the list of top-level rows. */
function timeline(rows: RowSpec[]): HTMLElement {
  const viewport = document.createElement("div");
  viewport.setAttribute("data-page-scroll-viewport", "");
  const items = document.createElement("div");
  items.setAttribute("data-timeline-items", "");
  rows.forEach((spec, index) => items.append(row({ index, ...spec })));
  viewport.append(items);
  document.body.append(viewport);
  return viewport;
}

const byId = (id: string) => document.querySelector(`[data-timeline-row-id="${CSS.escape(id)}"]`)!;

function point(overrides: Partial<ReadPoint>): ReadPoint {
  return { threadId: T, messageId: user(1), role: "user", sourceSeqEnd: 1, setAt: 1, ...overrides };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("resolveClick", () => {
  const click = (target: Element, mods: Partial<ClickLike> = {}): ClickLike => ({
    button: 0,
    altKey: true,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    target,
    ...mods,
  });
  const resolve = (event: ClickLike, selection: Selection | null = null) =>
    resolveClick(event, "Option", modifierMatches, selection);

  it("marks a message you sent from a click on its text", () => {
    timeline([{ id: user(12) }]);
    expect(resolve(click(byId(user(12)).querySelector("p")!))).toEqual({
      threadId: T,
      messageId: user(12),
      role: "user",
      sourceSeqEnd: 12,
    });
  });

  it("marks an agent message, with no sequence number to give", () => {
    timeline([{ id: agent("t1", "i1") }]);
    expect(resolve(click(byId(agent("t1", "i1"))))).toEqual({
      threadId: T,
      messageId: agent("t1", "i1"),
      role: "assistant",
      sourceSeqEnd: null,
    });
  });

  it("ignores a click without the modifier", () => {
    timeline([{ id: user(12) }]);
    expect(resolve(click(byId(user(12)), { altKey: false }))).toBeNull();
  });

  it("ignores any button but the main one", () => {
    timeline([{ id: user(12) }]);
    expect(resolve(click(byId(user(12)), { button: 1 }))).toBeNull();
  });

  it.each(["a", "button", "input", "textarea", "summary"])("leaves a click on a %s to it", (tag) => {
    timeline([{ id: user(12), html: `<p>before <${tag} id="control">x</${tag}></p>` }]);
    expect(resolve(click(document.getElementById("control")!))).toBeNull();
  });

  it("leaves a click on a role=button to it", () => {
    timeline([{ id: user(12), html: `<div role="button"><span id="inner">x</span></div>` }]);
    expect(resolve(click(document.getElementById("inner")!))).toBeNull();
  });

  it("ignores a click on a row that is not a message", () => {
    timeline([{ id: `${T}:t1:turn` }, { id: `${T}:command:i5` }]);
    expect(resolve(click(byId(`${T}:t1:turn`)))).toBeNull();
    expect(resolve(click(byId(`${T}:command:i5`)))).toBeNull();
  });

  it("ignores a click outside the timeline", () => {
    const outside = document.createElement("p");
    document.body.append(outside);
    expect(resolve(click(outside))).toBeNull();
  });

  it("takes the nearest message when rows nest", () => {
    timeline([{ id: `${T}:t4:work-summary`, children: [{ id: agent("t4", "i9") }, { id: `${T}:command:i10` }] }]);
    expect(resolve(click(byId(agent("t4", "i9"))))?.messageId).toBe(agent("t4", "i9"));
    expect(resolve(click(byId(`${T}:command:i10`)))).toBeNull();
  });

  it("leaves a click inside a text selection in the message alone", () => {
    timeline([{ id: user(12) }]);
    const text = byId(user(12)).querySelector("p")!;
    const selection = { isCollapsed: false, anchorNode: text.firstChild } as unknown as Selection;
    expect(resolve(click(text), selection)).toBeNull();
  });

  it("is not stopped by a selection somewhere else", () => {
    timeline([{ id: user(12) }]);
    const elsewhere = document.createElement("p");
    elsewhere.textContent = "selected";
    document.body.append(elsewhere);
    const selection = { isCollapsed: false, anchorNode: elsewhere.firstChild } as unknown as Selection;
    expect(resolve(click(byId(user(12))), selection)).not.toBeNull();
  });
});

describe("findTargetRow", () => {
  it("puts the divider on the marked agent message", () => {
    timeline([{ id: user(1) }, { id: agent("t1", "i1") }]);
    const p = point({ messageId: agent("t1", "i1"), role: "assistant", sourceSeqEnd: 5 });
    expect(findTargetRow(document, p)).toBe(byId(agent("t1", "i1")));
  });

  it("falls back to the turn's summary once the turn has folded the message away", () => {
    timeline([{ id: user(1) }, { id: `${T}:t1:turn` }, { id: `${T}:t10:turn` }]);
    const p = point({ messageId: agent("t1", "i1"), role: "assistant" });
    expect(findMessageRow(document, p)).toBe(byId(`${T}:t1:turn`));
    expect(findTargetRow(document, p)).toBe(byId(`${T}:t1:turn`));
  });

  it("falls back only to a top-level row, never one nested inside another", () => {
    timeline([
      { id: `${T}:t0:work-summary`, children: [{ id: `${T}:t1:step` }] },
      { id: `${T}:t1:turn` },
    ]);
    const p = point({ messageId: agent("t1", "i1"), role: "assistant" });
    expect(findTargetRow(document, p)).toBe(byId(`${T}:t1:turn`));
  });

  it("puts the divider after a message you sent, above the reply", () => {
    timeline([{ id: user(1) }, { id: `${T}:t1:turn` }, { id: agent("t1", "i1") }]);
    expect(findTargetRow(document, point({ messageId: user(1) }))).toBe(byId(`${T}:t1:turn`));
  });

  it("skips further messages you sent to reach the reply", () => {
    timeline([{ id: user(1) }, { id: user(2) }, { id: agent("t1", "i1") }]);
    expect(findTargetRow(document, point({ messageId: user(1) }))).toBe(byId(agent("t1", "i1")));
  });

  it("goes by bb's row order, not document order", () => {
    timeline([
      { id: agent("t1", "i1"), index: 7 },
      { id: user(1), index: 5 },
      { id: `${T}:t1:turn`, index: 6 },
    ]);
    expect(findTargetRow(document, point({ messageId: user(1) }))).toBe(byId(`${T}:t1:turn`));
  });

  it("has nowhere to go until something answers a message you sent", () => {
    timeline([{ id: agent("t0", "i0") }, { id: user(1) }]);
    expect(findTargetRow(document, point({ messageId: user(1) }))).toBeNull();
  });

  it("finds nothing when the message is not rendered", () => {
    timeline([{ id: user(9) }]);
    expect(findTargetRow(document, point({ messageId: user(1) }))).toBeNull();
  });

  it("ignores another thread's rows, even with the same message id shape", () => {
    timeline([{ id: "thr_b:user-seed:1" }, { id: "thr_b:t1:turn" }]);
    expect(findTargetRow(document, point({ messageId: user(1) }))).toBeNull();
  });
});

describe("findViewport", () => {
  it("finds the scroller around this thread's rows and not another's", () => {
    const other = timeline([{ id: "thr_b:user-seed:1" }]);
    const mine = timeline([{ id: user(1) }]);
    expect(findViewport(document, T)).toBe(mine);
    expect(findViewport(document, "thr_b")).toBe(other);
    expect(findViewport(document, "thr_c")).toBeNull();
  });
});

describe("searchDirection", () => {
  it("looks up when everything on screen came later", () => {
    timeline([{ id: user(50) }, { id: user(60) }]);
    expect(searchDirection(document, point({ sourceSeqEnd: 10 }))).toBe("up");
  });

  it("looks down when everything on screen came earlier", () => {
    timeline([{ id: user(5) }]);
    expect(searchDirection(document, point({ sourceSeqEnd: 10 }))).toBe("down");
  });

  it("looks both ways when it cannot tell", () => {
    timeline([{ id: user(5) }, { id: user(50) }]);
    expect(searchDirection(document, point({ sourceSeqEnd: 10 }))).toBe("both");
    expect(searchDirection(document, point({ sourceSeqEnd: null }))).toBe("both");
    document.body.innerHTML = "";
    timeline([{ id: agent("t1", "i1") }]);
    expect(searchDirection(document, point({ sourceSeqEnd: 10 }))).toBe("both");
  });
});

describe("revealRow", () => {
  /**
   * A viewport 1000px high over 5000px of thread, starting at the bottom. The
   * target row appears once the view is within 500px of `targetAt`.
   */
  function fakeScroller(options: { targetAt: number; start?: number; pinned?: boolean }) {
    const viewport = timeline([]);
    let top = options.start ?? 4000;
    let unpinned = !options.pinned;
    const log: string[] = [];
    Object.defineProperty(viewport, "scrollTop", { get: () => top, configurable: true });
    Object.defineProperty(viewport, "clientHeight", { get: () => 1000, configurable: true });
    viewport.addEventListener("wheel", () => {
      log.push("wheel");
      unpinned = true;
    });
    viewport.scrollBy = ((opts: ScrollToOptions) => {
      log.push("scroll");
      // bb snaps an unprompted scroll back to the bottom.
      if (unpinned) top = Math.min(4000, Math.max(0, top + (opts.top ?? 0)));
    }) as typeof viewport.scrollBy;
    const target = document.createElement("div");
    target.scrollIntoView = vi.fn();
    const find = () => (Math.abs(top - options.targetAt) <= 500 ? target : null);
    return { viewport, target, find, log };
  }

  const noWait = () => Promise.resolve();
  const signal = () => new AbortController().signal;

  it("scrolls up until the row renders, then brings it to the top", async () => {
    const { viewport, target, find } = fakeScroller({ targetAt: 1000 });
    const found = await revealRow(viewport, { find, direction: "up", signal: signal(), wait: noWait });
    expect(found).toBe(target);
    expect(target.scrollIntoView).toHaveBeenCalledWith({ block: "start" });
  });

  it("sends a wheel before every scroll, which is what unpins bb", async () => {
    const { viewport, find, log } = fakeScroller({ targetAt: 1000, pinned: true });
    expect(await revealRow(viewport, { find, direction: "up", signal: signal(), wait: noWait })).not.toBeNull();
    const scrolls = log.map((entry, i) => (entry === "scroll" ? log[i - 1] : null)).filter(Boolean);
    expect(scrolls.length).toBeGreaterThan(0);
    expect(scrolls.every((before) => before === "wheel")).toBe(true);
  });

  it("does not scroll when the row is already there", async () => {
    const { viewport, target, find, log } = fakeScroller({ targetAt: 4000 });
    expect(await revealRow(viewport, { find, direction: "up", signal: signal(), wait: noWait })).toBe(target);
    expect(log.filter((entry) => entry === "scroll")).toEqual([]);
  });

  it("turns round at the top when it could be either way", async () => {
    const { viewport, target, find } = fakeScroller({ targetAt: 3000, start: 0 });
    expect(await revealRow(viewport, { find, direction: "both", signal: signal(), wait: noWait })).toBe(target);
  });

  it("waits at the top for bb to load older rows, then keeps going", async () => {
    // 2000px loaded, the target in an older page bb loads ~1.2s after the
    // view reaches the top. bb keeps the view anchored, so the new height
    // lands above it.
    const viewport = timeline([]);
    let top = 1000;
    let height = 2000;
    let waitsAtTop = 0;
    Object.defineProperty(viewport, "scrollTop", { get: () => top, configurable: true });
    Object.defineProperty(viewport, "scrollHeight", { get: () => height, configurable: true });
    Object.defineProperty(viewport, "clientHeight", { get: () => 1000, configurable: true });
    viewport.scrollBy = ((opts: ScrollToOptions) => {
      top = Math.min(height - 1000, Math.max(0, top + (opts.top ?? 0)));
    }) as typeof viewport.scrollBy;
    const wait = async () => {
      if (top !== 0) return;
      waitsAtTop += 1;
      if (waitsAtTop === 10 && height === 2000) {
        height += 3000;
        top += 3000;
      }
    };
    const target = document.createElement("div");
    target.scrollIntoView = vi.fn();
    // The target is 500px into the older page.
    const find = () => (height > 2000 && Math.abs(top - 500) <= 500 ? target : null);
    expect(await revealRow(viewport, { find, direction: "up", signal: signal(), wait })).toBe(target);
  });

  it("counts older rows landing as progress even when the view does not move", async () => {
    // Pinned at the top, two slow pages arrive without anchoring: the height
    // grows but scrollTop stays 0. The target is in the second page.
    const viewport = timeline([]);
    let height = 2000;
    let waits = 0;
    Object.defineProperty(viewport, "scrollTop", { get: () => 0, configurable: true });
    Object.defineProperty(viewport, "scrollHeight", { get: () => height, configurable: true });
    Object.defineProperty(viewport, "clientHeight", { get: () => 1000, configurable: true });
    viewport.scrollBy = (() => {}) as typeof viewport.scrollBy;
    const wait = async () => {
      waits += 1;
      if (waits === 15 || waits === 35) height += 3000;
    };
    const target = document.createElement("div");
    target.scrollIntoView = vi.fn();
    const find = () => (height >= 8000 ? target : null);
    expect(await revealRow(viewport, { find, direction: "up", signal: signal(), wait })).toBe(target);
  });

  it("gives up at the end of the thread", async () => {
    const { viewport, find } = fakeScroller({ targetAt: 99_999 });
    expect(await revealRow(viewport, { find, direction: "up", signal: signal(), wait: noWait })).toBeNull();
  });

  it("gives up after its step limit", async () => {
    const { viewport, find, log } = fakeScroller({ targetAt: 0 });
    expect(await revealRow(viewport, { find, direction: "up", signal: signal(), wait: noWait, maxSteps: 2 })).toBeNull();
    expect(log.filter((entry) => entry === "scroll")).toHaveLength(2);
  });

  it("stops when aborted", async () => {
    const { viewport, find, log } = fakeScroller({ targetAt: 0 });
    const controller = new AbortController();
    controller.abort();
    expect(await revealRow(viewport, { find, direction: "up", signal: controller.signal, wait: noWait })).toBeNull();
    expect(log).toEqual([]);
  });
});
