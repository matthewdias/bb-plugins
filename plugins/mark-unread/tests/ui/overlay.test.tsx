// The overlay against a stand-in for bb's timeline: the divider follows the
// point, a return visit scrolls there once, leaving forgets a seen point, and
// the modifier-click marks a message.
import { waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { POINT_CHANGED, type ReadPoint } from "../../lib/read-point";
import { ACTIVE_ATTR, MarkUnreadOverlay, TARGET_ATTR } from "../../src/overlay";
import type { rpcContract } from "../../server";
import { writeVisit } from "../../src/visit";

const agent = (thread: string, item: string) =>
  `${thread}:assistant:kind:assistant|turn:t1|parent:root|item:${item}`;

/** bb's shape: a scroll viewport around top-level rows. */
function timeline(thread: string, items: string[]): HTMLElement {
  const viewport = document.createElement("div");
  viewport.setAttribute("data-page-scroll-viewport", "");
  items.forEach((item, index) => viewport.append(row(agent(thread, item), index)));
  document.body.append(viewport);
  return viewport;
}

function row(id: string, index: number): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-timeline-row-id", id);
  el.setAttribute("data-index", String(index));
  const text = document.createElement("p");
  text.textContent = `text of ${id}`;
  el.append(text);
  return el;
}

const byId = (id: string) => document.querySelector(`[data-timeline-row-id="${CSS.escape(id)}"]`) as HTMLElement;

interface RenderOptions {
  thread: string | null;
  /** Stored for the thread before mounting; omit to keep what is stored. */
  point?: ReadPoint | null;
  modifier?: string;
}

/** What the fake server holds, per thread; tests change it to stand in for another window. */
const stored = new Map<string, ReadPoint | null>();

/** Mount the overlay with `thread` in view. Mounting on another thread is how a test leaves one. */
function render({ thread, point, modifier }: RenderOptions) {
  if (thread && point !== undefined) stored.set(thread, point);
  return renderSlot<object, typeof rpcContract>({ component: MarkUnreadOverlay }, {}, {
    context: { threadId: thread },
    settings: modifier === undefined ? {} : { modifier },
    rpc: {
      points_get: ({ threadId }) => ({ point: stored.get(threadId) ?? null }),
      points_set: (input) => {
        const point = { ...input, setAt: Date.now() };
        stored.set(input.threadId, point);
        return { point };
      },
      // The server's rule: only a point set before the visit began.
      points_clear: ({ threadId, setBefore }) => {
        const point = stored.get(threadId) ?? null;
        const cleared = point !== null && (setBefore === undefined || point.setAt < setBefore);
        if (cleared) stored.set(threadId, null);
        return { cleared };
      },
    },
  });
}

/** Set before the visit began, so this visit has seen it. */
const seen = (thread: string, item: string): ReadPoint => ({
  threadId: thread,
  messageId: agent(thread, item),
  role: "assistant",
  sourceSeqEnd: null,
  setAt: Date.now() - 60_000,
});

/** Set after the visit began: marked while you were in the thread. */
const fresh = (thread: string, item: string): ReadPoint => ({ ...seen(thread, item), setAt: Date.now() + 60_000 });

let scrolled: HTMLElement[];

beforeEach(() => {
  scrolled = [];
  stored.clear();
  sessionStorage.clear();
  // jsdom has no layout, so no scrollIntoView; record what would have scrolled.
  Element.prototype.scrollIntoView = function (this: HTMLElement) {
    scrolled.push(this);
  };
});

afterEach(() => {
  document.body.innerHTML = "";
  delete (Element.prototype as Partial<Element>).scrollIntoView;
});

describe("the divider", () => {
  it("goes on the marked message, with bb's own divider hidden", async () => {
    const viewport = timeline("thr_d1", ["i1", "i2", "i3"]);
    render({ thread: "thr_d1", point: fresh("thr_d1", "i2") });
    await waitFor(() => expect(byId(agent("thr_d1", "i2")).hasAttribute(TARGET_ATTR)).toBe(true));
    expect(viewport.hasAttribute(ACTIVE_ATTR)).toBe(true);
    expect(document.querySelectorAll(`[${TARGET_ATTR}]`)).toHaveLength(1);
  });

  it("brings its stylesheet, which hides bb's divider only where ours is active", () => {
    const { container } = render({ thread: "thr_d2", point: null });
    const css = container.querySelector("style")?.textContent ?? "";
    expect(css).toContain(`[${ACTIVE_ATTR}] [data-testid="thread-unread-divider"]`);
    expect(css).toContain(`[${TARGET_ATTR}]::before`);
  });

  it("follows the message when bb replaces its row", async () => {
    timeline("thr_d3", ["i1", "i2"]);
    render({ thread: "thr_d3", point: fresh("thr_d3", "i2") });
    const old = byId(agent("thr_d3", "i2"));
    await waitFor(() => expect(old.hasAttribute(TARGET_ATTR)).toBe(true));
    const replacement = row(agent("thr_d3", "i2"), 1);
    old.replaceWith(replacement);
    await waitFor(() => expect(replacement.hasAttribute(TARGET_ATTR)).toBe(true));
  });

  it("moves to a closer reply that renders later, leaving one divider", async () => {
    // A message you sent: the divider goes above the first reply. bb can
    // render a later row before the one right after yours.
    const viewport = document.createElement("div");
    viewport.setAttribute("data-page-scroll-viewport", "");
    viewport.append(row("thr_d9:user-seed:5", 0), row(agent("thr_d9", "i3"), 2));
    document.body.append(viewport);
    const point: ReadPoint = { ...fresh("thr_d9", "i0"), messageId: "thr_d9:user-seed:5", role: "user", sourceSeqEnd: 5 };
    render({ thread: "thr_d9", point });
    const later = byId(agent("thr_d9", "i3"));
    await waitFor(() => expect(later.hasAttribute(TARGET_ATTR)).toBe(true));
    const closer = row(agent("thr_d9", "i2"), 1);
    later.before(closer);
    await waitFor(() => expect(closer.hasAttribute(TARGET_ATTR)).toBe(true));
    expect(later.hasAttribute(TARGET_ATTR)).toBe(false);
  });

  it("appears once the message renders, after scrolling brings it in", async () => {
    const viewport = timeline("thr_d4", ["i1"]);
    render({ thread: "thr_d4", point: fresh("thr_d4", "i9") });
    await waitFor(() => expect(viewport.hasAttribute(ACTIVE_ATTR)).toBe(true));
    const late = row(agent("thr_d4", "i9"), 1);
    viewport.append(late);
    await waitFor(() => expect(late.hasAttribute(TARGET_ATTR)).toBe(true));
  });

  it("goes away when the point is cleared elsewhere", async () => {
    const viewport = timeline("thr_d5", ["i1"]);
    const view = render({ thread: "thr_d5", point: fresh("thr_d5", "i1") });
    const target = byId(agent("thr_d5", "i1"));
    await waitFor(() => expect(target.hasAttribute(TARGET_ATTR)).toBe(true));
    stored.set("thr_d5", null);
    await view.behavior.emitRealtime(POINT_CHANGED, { threadId: "thr_d5" });
    await waitFor(() => expect(target.hasAttribute(TARGET_ATTR)).toBe(false));
    expect(viewport.hasAttribute(ACTIVE_ATTR)).toBe(false);
  });

  it("ignores a change to another thread's point", async () => {
    timeline("thr_d7", ["i1"]);
    const view = render({ thread: "thr_d7", point: fresh("thr_d7", "i1") });
    const gets = () => view.inspection.rpcCalls.filter((call) => call.method === "points_get");
    await waitFor(() => expect(gets()).toHaveLength(1));
    await view.behavior.emitRealtime(POINT_CHANGED, { threadId: "thr_elsewhere" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(gets()).toHaveLength(1);
  });

  it("is taken down on unmount", async () => {
    const viewport = timeline("thr_d8", ["i1"]);
    const view = render({ thread: "thr_d8", point: fresh("thr_d8", "i1") });
    const target = byId(agent("thr_d8", "i1"));
    await waitFor(() => expect(target.hasAttribute(TARGET_ATTR)).toBe(true));
    view.unmount();
    expect(target.hasAttribute(TARGET_ATTR)).toBe(false);
    expect(viewport.hasAttribute(ACTIVE_ATTR)).toBe(false);
  });

  it("leaves another thread's rows alone", async () => {
    timeline("thr_other", ["i1"]);
    timeline("thr_d6", ["i1"]);
    render({ thread: "thr_d6", point: fresh("thr_d6", "i1") });
    await waitFor(() => expect(byId(agent("thr_d6", "i1")).hasAttribute(TARGET_ATTR)).toBe(true));
    expect(byId(agent("thr_other", "i1")).hasAttribute(TARGET_ATTR)).toBe(false);
  });
});

describe("coming back", () => {
  it("scrolls to the divider when you return to a marked thread", async () => {
    timeline("thr_r1", ["i1", "i2", "i3"]);
    render({ thread: "thr_r1", point: seen("thr_r1", "i2") });
    await waitFor(() => expect(scrolled).toContain(byId(agent("thr_r1", "i2"))), { timeout: 3000 });
  });

  it("does not scroll when you marked the thread during this visit", async () => {
    timeline("thr_r2", ["i1", "i2"]);
    render({ thread: "thr_r2", point: fresh("thr_r2", "i2") });
    await waitFor(() => expect(byId(agent("thr_r2", "i2")).hasAttribute(TARGET_ATTR)).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(scrolled).toEqual([]);
  });

  it("scrolls once, not again when the same point is fetched again", async () => {
    timeline("thr_r3", ["i1", "i2"]);
    const view = render({ thread: "thr_r3", point: seen("thr_r3", "i2") });
    await waitFor(() => expect(scrolled).toHaveLength(1), { timeout: 3000 });
    await view.behavior.emitRealtime(POINT_CHANGED, { threadId: "thr_r3" });
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(scrolled).toHaveLength(1);
  });
});

describe("leaving", () => {
  const clears = (view: ReturnType<typeof render>) =>
    view.inspection.rpcCalls.filter((call) => call.method === "points_clear");
  const targeted = (thread: string, item: string) =>
    waitFor(() => expect(byId(agent(thread, item)).hasAttribute(TARGET_ATTR)).toBe(true));

  it("forgets a point you have now seen", async () => {
    timeline("thr_l1", ["i1"]);
    const point = seen("thr_l1", "i1");
    const first = render({ thread: "thr_l1", point });
    await targeted("thr_l1", "i1");
    first.unmount();
    const next = render({ thread: "thr_l1b", point: null });
    await waitFor(() =>
      expect(clears(next)).toEqual([
        { method: "points_clear", input: { threadId: "thr_l1", setBefore: expect.any(Number) } },
      ]),
    );
    expect((clears(next)[0]!.input as { setBefore: number }).setBefore).toBeGreaterThan(point.setAt);
    expect(stored.get("thr_l1")).toBeNull();
  });

  it("keeps a point you set during this visit", async () => {
    timeline("thr_l2", ["i1"]);
    const point = fresh("thr_l2", "i1");
    const first = render({ thread: "thr_l2", point });
    await targeted("thr_l2", "i1");
    first.unmount();
    const next = render({ thread: "thr_l2b", point: null });
    await waitFor(() => expect(clears(next)).toHaveLength(1));
    expect(stored.get("thr_l2")).toEqual(point);
  });

  it("keeps a point you mark by clicking, when you then leave", async () => {
    timeline("thr_l7", ["i1"]);
    const first = render({ thread: "thr_l7", point: null });
    await waitFor(() => expect(first.inspection.rpcCalls.some((call) => call.method === "points_get")).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 5));
    byId(agent("thr_l7", "i1")).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, altKey: true }));
    await waitFor(() => expect(stored.get("thr_l7")).not.toBeNull());
    await new Promise((resolve) => setTimeout(resolve, 5));
    first.unmount();
    const next = render({ thread: "thr_l7b", point: null });
    await waitFor(() => expect(clears(next)).toHaveLength(1));
    expect(stored.get("thr_l7")).not.toBeNull();
  });

  it("counts going to a page with no thread as leaving", async () => {
    timeline("thr_l3", ["i1"]);
    const first = render({ thread: "thr_l3", point: seen("thr_l3", "i1") });
    await targeted("thr_l3", "i1");
    first.unmount();
    const next = render({ thread: null });
    await waitFor(() => expect(clears(next)).toHaveLength(1));
    expect(stored.get("thr_l3")).toBeNull();
  });

  it("does not take an unmount for leaving: a plugin reload keeps the point and the visit", async () => {
    timeline("thr_l4", ["i1", "i2"]);
    const point = seen("thr_l4", "i2");
    const first = render({ thread: "thr_l4", point });
    await waitFor(() => expect(scrolled).toHaveLength(1), { timeout: 3000 });
    first.unmount();
    expect(clears(first)).toEqual([]);
    // The overlay comes back on the same thread: same visit, so no second scroll.
    const again = render({ thread: "thr_l4" });
    await targeted("thr_l4", "i2");
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(scrolled).toHaveLength(1);
    expect(clears(again)).toEqual([]);
    expect(stored.get("thr_l4")).toEqual(point);
  });

  it("still forgets the point when you leave after a reload", async () => {
    timeline("thr_l5", ["i1"]);
    const first = render({ thread: "thr_l5", point: seen("thr_l5", "i1") });
    await targeted("thr_l5", "i1");
    first.unmount();
    render({ thread: "thr_l5" }).unmount();
    const next = render({ thread: "thr_l5b", point: null });
    await waitFor(() => expect(clears(next)).toHaveLength(1));
    expect(stored.get("thr_l5")).toBeNull();
  });

  it("forgets the point of a thread whose point this window has not loaded", async () => {
    // A fresh bundle after a reload knows only the stored visit, not the point.
    writeVisit(sessionStorage, { threadId: "thr_l8", startedAt: Date.now(), revealedSetAt: null });
    stored.set("thr_l8", seen("thr_l8", "i1"));
    const next = render({ thread: "thr_l8b", point: null });
    await waitFor(() => expect(clears(next)).toHaveLength(1));
    expect(stored.get("thr_l8")).toBeNull();
  });

  it("asks nothing on leaving a thread known to have no point", async () => {
    timeline("thr_l6", ["i1"]);
    const first = render({ thread: "thr_l6", point: null });
    await waitFor(() => expect(first.inspection.rpcCalls.some((call) => call.method === "points_get")).toBe(true));
    first.unmount();
    const next = render({ thread: "thr_l6b", point: null });
    await waitFor(() => expect(next.inspection.rpcCalls.some((call) => call.method === "points_get")).toBe(true));
    expect(clears(next)).toEqual([]);
  });
});

describe("the modifier-click", () => {
  const click = (target: Element, init: MouseEventInit) => {
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
    target.dispatchEvent(event);
    return event;
  };
  const sets = (view: ReturnType<typeof render>) =>
    view.inspection.rpcCalls.filter((call) => call.method === "points_set");

  it("marks the message with Option held, by default", async () => {
    timeline("thr_c1", ["i1"]);
    const view = render({ thread: "thr_c1", point: null });
    const event = click(byId(agent("thr_c1", "i1")).querySelector("p")!, { altKey: true });
    expect(event.defaultPrevented).toBe(true);
    await waitFor(() =>
      expect(sets(view)).toEqual([
        expect.objectContaining({
          input: { threadId: "thr_c1", messageId: agent("thr_c1", "i1"), role: "assistant", sourceSeqEnd: null },
        }),
      ]),
    );
  });

  it("follows the setting", async () => {
    timeline("thr_c2", ["i1"]);
    const view = render({ thread: "thr_c2", point: null, modifier: "Shift" });
    const text = byId(agent("thr_c2", "i1")).querySelector("p")!;
    expect(click(text, { altKey: true }).defaultPrevented).toBe(false);
    click(text, { shiftKey: true });
    await waitFor(() => expect(sets(view)).toHaveLength(1));
  });

  it("does nothing when switched off", async () => {
    timeline("thr_c3", ["i1"]);
    const view = render({ thread: "thr_c3", point: null, modifier: "Off" });
    const event = click(byId(agent("thr_c3", "i1")), { altKey: true });
    expect(event.defaultPrevented).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sets(view)).toEqual([]);
  });

  it("does nothing on a plain click", async () => {
    timeline("thr_c4", ["i1"]);
    const view = render({ thread: "thr_c4", point: null });
    expect(click(byId(agent("thr_c4", "i1")), {}).defaultPrevented).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sets(view)).toEqual([]);
  });

  it("stops listening once unmounted", async () => {
    timeline("thr_c5", ["i1"]);
    const view = render({ thread: "thr_c5", point: null });
    view.unmount();
    expect(click(byId(agent("thr_c5", "i1")), { altKey: true }).defaultPrevented).toBe(false);
    expect(sets(view)).toEqual([]);
  });
});
