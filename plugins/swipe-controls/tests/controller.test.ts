import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type GestureEnv, type GestureSettings, TIMING, startGestures } from "../lib/controller.ts";
import { BACK_FORWARD, type HistoryDirection } from "../lib/history.ts";
import { FALLBACK_ROW_ACTIONS, type RowActionKeys, keysOf, rowContent } from "../lib/row-actions.ts";
import { ROW, WHEEL_ROW, fullPx, revealWidth } from "../lib/row.ts";
import { WHEEL } from "../lib/wheel.ts";
import { type FakeThread, WHEEL_TO_ARM_RIGHT, bbRow, evaluate, wheelToFull } from "./helpers.ts";

const ROW_WIDTH = 300;
const LAYOUT = { width: ROW_WIDTH, trailingActions: 2, leading: true, trailing: true, full: true };

let now = 1000;
let stop: (() => void) | null = null;

function stamp<T extends Event>(event: T, t = now): T {
  Object.defineProperty(event, "timeStamp", { value: t });
  return event;
}

function wheel(target: Element, deltaX: number, deltaY = 0): WheelEvent {
  now += 16;
  const event = stamp(new WheelEvent("wheel", { deltaX, deltaY, bubbles: true, cancelable: true }));
  target.dispatchEvent(event);
  return event;
}

/** A two-finger swipe in steps of `step`, then the pause that ends it. */
function swipe(target: Element, total: number, step = 10): WheelEvent[] {
  const events: WheelEvent[] = [];
  for (let moved = 0; Math.abs(moved) < Math.abs(total); moved += step) events.push(wheel(target, step));
  return events;
}

function endGesture() {
  vi.advanceTimersByTime(WHEEL.gestureGapMs + 50);
  now += WHEEL.gestureGapMs + 50;
}

/** Fingers off the trackpad long enough that the next swipe is a new one. */
function lift() {
  vi.advanceTimersByTime(BACK_FORWARD.releaseQuietMs);
  now += BACK_FORWARD.releaseQuietMs;
}

function touchList(points: { identifier: number; clientX: number; clientY: number }[]) {
  return { length: points.length, item: (index: number) => points[index] ?? null };
}

function touch(type: string, target: EventTarget, x: number, y = 100, active = type !== "touchend"): Event {
  now += 16;
  const point = { identifier: 1, clientX: x, clientY: y };
  const event = stamp(new Event(type, { bubbles: true, cancelable: true }));
  Object.defineProperty(event, "touches", { value: touchList(active ? [point] : []) });
  Object.defineProperty(event, "changedTouches", { value: touchList([point]) });
  target.dispatchEvent(event);
  return event;
}

/** A one-finger drag from x=150 by `dx`, slow enough not to fling. */
function drag(target: Element, dx: number, { lift = true, y = 100 } = {}) {
  touch("touchstart", target, 150, y);
  const steps = 10;
  const moves: Event[] = [];
  for (let index = 1; index <= steps; index += 1) {
    now += 40;
    moves.push(touch("touchmove", target, 150 + (dx * index) / steps, y));
  }
  if (lift) {
    now += 200;
    touch("touchend", target, 150 + dx, y);
  }
  return moves;
}

function click(target: Element): MouseEvent {
  const event = stamp(new MouseEvent("click", { bubbles: true, cancelable: true }), now + 10);
  target.dispatchEvent(event);
  return event;
}

function sized(element: HTMLElement) {
  element.getBoundingClientRect = () =>
    ({ top: 0, left: 0, width: ROW_WIDTH, height: 44, right: ROW_WIDTH, bottom: 44, x: 0, y: 0, toJSON() {} }) as DOMRect;
}

function makeEnv(
  settings: Partial<GestureSettings>,
  facts: Map<string, FakeThread>,
  compact: boolean,
  canGo: boolean,
  keys: { current: RowActionKeys },
) {
  /** What running a row's action did, by its key. */
  const ran = vi.fn((_key: string) => {});
  const env = {
    doc: document,
    settings: { rowSwipes: true, rowLeftSwipe: true, backForward: true, ...settings },
    compact: () => compact,
    reducedMotion: () => false,
    row: (id: string) => {
      const thread = facts.get(id);
      if (thread === undefined || thread.isArchived) return null;
      return rowContent(evaluate(keysOf(keys.current), thread, ran), thread, keys.current);
    },
    refreshRowActions: vi.fn(),
    // The overlay draws bb's icon here. The name stands in for it.
    drawIcon: (slot: HTMLElement, name: string) => {
      slot.dataset.icon = name;
      return () => slot.removeAttribute("data-icon");
    },
    canGo: vi.fn((_direction: HistoryDirection) => canGo),
    go: vi.fn(),
    haptic: vi.fn(),
  } satisfies GestureEnv;
  return { ...env, ran };
}

interface Harness {
  env: ReturnType<typeof makeEnv>;
  row: HTMLElement;
  anchor: HTMLAnchorElement;
  main: HTMLElement;
  paragraph: HTMLElement;
  facts: Map<string, FakeThread>;
  /** The user's row actions and the two whole swipes, as the next swipe will find them. */
  keys: { current: RowActionKeys };
}

function start(
  settings: Partial<GestureSettings> = {},
  {
    compact = false,
    canGo = true,
    rowActions = FALLBACK_ROW_ACTIONS,
    right = "bb--core/read",
    fullLeft = "bb--core/archive",
  }: { compact?: boolean; canGo?: boolean } & Partial<RowActionKeys> = {},
): Harness {
  const { row, anchor } = bbRow("t1");
  sized(row);
  const main = document.createElement("main");
  main.setAttribute("data-sidebar", "inset");
  const paragraph = document.createElement("p");
  main.append(paragraph);
  document.body.append(row, main);
  const facts = new Map<string, FakeThread>([["t1", { isUnread: true, isPinned: false, isArchived: false }]]);
  const keys = { current: { rowActions, right, fullLeft } };
  const env = makeEnv(settings, facts, compact, canGo, keys);
  stop = startGestures(env);
  return { env, row, anchor, main, paragraph, facts, keys };
}

beforeEach(() => {
  vi.useFakeTimers();
  now = 1000;
});

afterEach(() => {
  stop?.();
  stop = null;
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("back and forward", () => {
  it("goes back once for a swipe right, momentum and all", () => {
    const { env, paragraph } = start();
    const events = swipe(paragraph, -(BACK_FORWARD.commitPx + 200), -10);
    expect(env.go).toHaveBeenCalledTimes(1);
    expect(env.go).toHaveBeenCalledWith("back");
    // The first 10px are below intent, before the axis is known.
    expect(events[0]?.defaultPrevented).toBe(false);
    expect(events.slice(1).every((event) => event.defaultPrevented)).toBe(true);
  });

  it("goes forward for a swipe left", () => {
    const { env, paragraph } = start();
    swipe(paragraph, BACK_FORWARD.commitPx);
    expect(env.go).toHaveBeenCalledWith("forward");
  });

  it("does nothing short of the commit distance", () => {
    const { env, paragraph } = start();
    swipe(paragraph, BACK_FORWARD.commitPx - 20);
    endGesture();
    expect(env.go).not.toHaveBeenCalled();
  });

  it("goes again for a second swipe once the fingers have lifted", () => {
    const { env, paragraph } = start();
    swipe(paragraph, -BACK_FORWARD.commitPx, -10);
    lift();
    swipe(paragraph, -BACK_FORWARD.commitPx, -10);
    expect(env.go).toHaveBeenCalledTimes(2);
  });

  it("goes once for a held swipe that pauses and keeps going", () => {
    const { env, paragraph } = start();
    swipe(paragraph, -BACK_FORWARD.commitPx, -10);
    for (let pause = 0; pause < 4; pause += 1) {
      endGesture();
      const events = swipe(paragraph, -BACK_FORWARD.commitPx, -10);
      expect(events.at(-1)?.defaultPrevented).toBe(true);
    }
    expect(env.go).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".bbsc-arrow")?.hasAttribute("data-leaving")).toBe(true);
  });

  it("lets vertical scrolling run out the hold", () => {
    const { env, paragraph } = start();
    swipe(paragraph, -BACK_FORWARD.commitPx, -10);
    endGesture();
    for (let index = 0; index < 40; index += 1) wheel(paragraph, 0, 10);
    endGesture();
    swipe(paragraph, -BACK_FORWARD.commitPx, -10);
    expect(env.go).toHaveBeenCalledTimes(2);
  });

  it("draws the arrow on the side it will go, filled when it fires", () => {
    const { paragraph } = start();
    swipe(paragraph, -60, -10);
    const arrow = document.querySelector<HTMLElement>(".bbsc-arrow");
    expect(arrow?.hidden).toBe(false);
    expect(arrow?.hasAttribute("data-ready")).toBe(false);
    swipe(paragraph, -BACK_FORWARD.commitPx, -10);
    expect(arrow?.hasAttribute("data-ready")).toBe(true);
  });

  it("goes nowhere and draws no arrow when history has nowhere to go", () => {
    const { env, paragraph } = start({}, { canGo: false });
    swipe(paragraph, -(BACK_FORWARD.commitPx * 2), -10);
    expect(env.go).not.toHaveBeenCalled();
    expect(document.querySelector<HTMLElement>(".bbsc-arrow")?.hidden).toBe(true);
  });

  it("hides the arrow when a swipe turns towards where there's nothing", () => {
    const { env, paragraph } = start();
    env.canGo.mockImplementation((direction) => direction === "back");
    swipe(paragraph, -60, -10);
    const arrow = document.querySelector<HTMLElement>(".bbsc-arrow");
    expect(arrow?.hidden).toBe(false);
    swipe(paragraph, 120);
    expect(arrow?.hidden).toBe(true);
    expect(env.go).not.toHaveBeenCalled();
  });

  it("leaves vertical scrolling alone", () => {
    const { env, paragraph } = start();
    const event = wheel(paragraph, 2, 40);
    for (let index = 0; index < 20; index += 1) wheel(paragraph, 20, 0);
    expect(event.defaultPrevented).toBe(false);
    expect(env.go).not.toHaveBeenCalled();
  });

  it("lets a code block with room to scroll keep the swipe", () => {
    const { env, main } = start();
    const pre = document.createElement("pre");
    pre.style.overflowX = "auto";
    Object.defineProperty(pre, "scrollWidth", { value: 800 });
    Object.defineProperty(pre, "clientWidth", { value: 200 });
    main.append(pre);
    const events = swipe(pre, BACK_FORWARD.commitPx * 2);
    expect(env.go).not.toHaveBeenCalled();
    expect(events.some((event) => event.defaultPrevented)).toBe(false);
  });

  it("is off when the setting is off, and on a phone", () => {
    for (const harness of [() => start({ backForward: false }), () => start({}, { compact: true })]) {
      const { env, paragraph } = harness();
      swipe(paragraph, BACK_FORWARD.commitPx * 2);
      expect(env.go).not.toHaveBeenCalled();
      stop?.();
      document.body.replaceChildren();
    }
  });

  it("ignores pinch", () => {
    const { env, paragraph } = start();
    for (let index = 0; index < 30; index += 1) {
      paragraph.dispatchEvent(stamp(new WheelEvent("wheel", { deltaX: 10, ctrlKey: true, bubbles: true }), (now += 16)));
    }
    expect(env.go).not.toHaveBeenCalled();
  });
});

describe("row swipes on a trackpad", () => {
  it("opens a row on its buttons, and Pin pins it", () => {
    const { env, row, anchor } = start();
    const events = swipe(anchor, revealWidth(LAYOUT) + 6);
    expect(events.at(-1)?.defaultPrevented).toBe(true);
    // Just past the buttons, a trackpad meets the detent: the row holds there.
    expect(row.style.translate).toBe(`${-revealWidth(LAYOUT)}px 0`);
    endGesture();
    vi.advanceTimersByTime(TIMING.settleMs);
    expect(row.style.translate).toBe(`${-revealWidth(LAYOUT)}px 0`);
    const pin = document.querySelector<HTMLButtonElement>('.bbsc-action[data-action="bb--core/pin"]');
    expect(pin?.textContent).toBe("Pin");
    pin?.click();
    expect(env.ran).toHaveBeenCalledWith("bb--core/pin");
    vi.advanceTimersByTime(TIMING.settleMs);
    expect(row.style.translate).toBe("");
    expect(document.querySelector(".bbsc-row")).toBe(null);
  });

  it("archives on a full swipe, with a tick on arming and a thump on release", () => {
    const { env, anchor } = start();
    swipe(anchor, wheelToFull(LAYOUT) + 10);
    expect(env.haptic).toHaveBeenCalledWith("selection");
    endGesture();
    expect(env.haptic).toHaveBeenLastCalledWith("impact-medium");
    vi.advanceTimersByTime(TIMING.slideOutMs);
    expect(env.ran).toHaveBeenCalledWith("bb--core/archive");
  });

  it("does nothing on a full swipe set to Nothing, and stays open on the buttons", () => {
    const { env, anchor } = start({}, { fullLeft: null });
    swipe(anchor, wheelToFull(LAYOUT) + 50);
    endGesture();
    vi.advanceTimersByTime(TIMING.slideOutMs + TIMING.settleMs);
    expect(env.ran).not.toHaveBeenCalled();
    expect(document.querySelector(".bbsc-row")?.hasAttribute("data-open")).toBe(true);
  });

  it("marks read on a swipe right", () => {
    const { env, anchor } = start();
    swipe(anchor, -(WHEEL_TO_ARM_RIGHT + 10), -10);
    endGesture();
    expect(env.ran).toHaveBeenCalledWith("bb--core/read");
  });

  it("marks unread a thread that is read", () => {
    const { env, anchor, facts } = start();
    facts.set("t1", { isUnread: false, isPinned: false, isArchived: false });
    swipe(anchor, -(WHEEL_TO_ARM_RIGHT + 10), -10);
    endGesture();
    expect(env.ran).toHaveBeenCalledWith("bb--core/read");
    expect(document.querySelector(".bbsc-lead-action")?.textContent).toBe("Unread");
  });

  it("leaves rows alone when row swipes are off", () => {
    const { env, row, anchor } = start({ rowSwipes: false });
    swipe(anchor, -(WHEEL_TO_ARM_RIGHT + 10), -10);
    endGesture();
    expect(env.ran).not.toHaveBeenCalled();
    expect(row.style.translate).toBe("");
  });

  it("doesn't swipe an archived thread", () => {
    const { env, anchor, facts } = start();
    facts.set("t1", { isUnread: true, isPinned: false, isArchived: true });
    swipe(anchor, -(WHEEL_TO_ARM_RIGHT + 10), -10);
    endGesture();
    expect(env.ran).not.toHaveBeenCalled();
  });

  it("closes an open row on a vertical scroll", () => {
    const { anchor, paragraph } = start();
    swipe(anchor, revealWidth(LAYOUT));
    endGesture();
    vi.advanceTimersByTime(TIMING.settleMs);
    wheel(paragraph, 0, 40);
    vi.advanceTimersByTime(TIMING.settleMs);
    expect(document.querySelector(".bbsc-row")).toBe(null);
  });
});

describe("row swipes by touch", () => {
  it("marks read on a drag right, ticking as it arms", () => {
    const { env, anchor } = start();
    const moves = drag(anchor, ROW.leadingArmPx + 20);
    expect(moves.at(-1)?.defaultPrevented).toBe(true);
    expect(env.haptic).toHaveBeenCalledWith("selection");
    expect(env.ran).toHaveBeenCalledWith("bb--core/read");
  });

  it("swallows the click that ends a drag", () => {
    const { anchor } = start();
    drag(anchor, ROW.leadingArmPx + 20);
    expect(click(anchor).defaultPrevented).toBe(true);
  });

  it("opens on a drag left and a tap on the row closes it without opening the thread", () => {
    const { row, anchor } = start();
    drag(anchor, -revealWidth(LAYOUT));
    vi.advanceTimersByTime(TIMING.settleMs);
    expect(document.querySelector(".bbsc-row")?.hasAttribute("data-open")).toBe(true);
    now += 1000;
    touch("touchstart", anchor, 150);
    touch("touchend", anchor, 150);
    expect(click(anchor).defaultPrevented).toBe(true);
    vi.advanceTimersByTime(TIMING.settleMs);
    expect(row.style.translate).toBe("");
  });

  it("leaves a leftward drag to bb's drawer when rows don't take it", () => {
    const { row, anchor } = start({ rowLeftSwipe: false }, { compact: true });
    const moves = drag(anchor, -revealWidth(LAYOUT), { lift: false });
    expect(moves.some((event) => event.defaultPrevented)).toBe(false);
    expect(row.style.translate).toBe("");
    expect(row.hasAttribute("data-no-sidebar-swipe")).toBe(false);
  });

  it("marks rows for bb's drawer when rows take leftward drags", () => {
    const { row } = start();
    expect(row.hasAttribute("data-no-sidebar-swipe")).toBe(true);
  });

  it("takes a leftward drag on a desktop touchscreen whatever the phone setting", () => {
    const { row, anchor } = start({ rowLeftSwipe: false }, { compact: false });
    drag(anchor, -60, { lift: false });
    expect(row.style.translate).toBe("-60px 0");
  });

  it("leaves a vertical drag to the list", () => {
    const { env, row, anchor } = start();
    touch("touchstart", anchor, 150, 100);
    const move = touch("touchmove", anchor, 152, 140);
    touch("touchmove", anchor, 220, 140);
    touch("touchend", anchor, 220, 140);
    expect(move.defaultPrevented).toBe(false);
    expect(row.style.translate).toBe("");
    expect(env.ran).not.toHaveBeenCalled();
  });

  it("yields to bb's long-press reorder", () => {
    const { env, row, anchor } = start();
    row.setAttribute("data-sidebar-touch-armed", "true");
    drag(anchor, ROW.leadingArmPx + 20);
    expect(env.ran).not.toHaveBeenCalled();
  });
});

describe("row actions", () => {
  const buttons = () =>
    [...document.querySelectorAll<HTMLButtonElement>("button.bbsc-action")].map((button) => button.dataset.action);
  const button = (key: string) => document.querySelector<HTMLButtonElement>(`button.bbsc-action[data-action="${key}"]`);

  /** Swipe left far enough to stay open, and let it settle. */
  function openRow(anchor: Element, width: number) {
    swipe(anchor, width);
    endGesture();
    vi.advanceTimersByTime(TIMING.settleMs);
  }

  /** Click away from the open row, and let it close. */
  function closeRow() {
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    vi.advanceTimersByTime(TIMING.settleMs);
  }

  it("uncovers the user's row actions, in their order", () => {
    const { anchor } = start({}, { rowActions: ["bb--core/split", "bb--core/copyLink", "bb--core/pin"] });
    openRow(anchor, 3 * ROW.actionWidthPx);
    expect(buttons()).toEqual(["bb--core/split", "bb--core/copyLink", "bb--core/pin"]);
    expect(document.querySelector(".bbsc-row")?.hasAttribute("data-open")).toBe(true);
  });

  it("opens only as wide as its buttons", () => {
    const { row, anchor } = start({}, { rowActions: ["bb--core/archive"], fullLeft: null });
    openRow(anchor, 2 * ROW.actionWidthPx);
    expect(row.style.translate).toBe(`${-ROW.actionWidthPx}px 0`);
  });

  it("names and draws each button as bb does, shortening what won't fit", () => {
    const { anchor } = start({}, { rowActions: ["bb--core/copyLink", "bb--core/rename"] });
    openRow(anchor, 2 * ROW.actionWidthPx);
    const copy = button("bb--core/copyLink");
    expect(copy?.textContent).toBe("Copy link");
    expect(copy?.getAttribute("aria-label")).toBe("Copy thread link");
    expect(copy?.querySelector<HTMLElement>(".bbsc-icon")?.dataset.icon).toBe("Copy");
    expect(button("bb--core/rename")?.textContent).toBe("Rename");
  });

  it("takes its icons back when the row closes", () => {
    const { anchor } = start({}, { rowActions: ["bb--core/pin"] });
    openRow(anchor, ROW.actionWidthPx);
    const glyph = button("bb--core/pin")?.querySelector<HTMLElement>(".bbsc-icon");
    expect(glyph?.dataset.icon).toBe("Pin");
    closeRow();
    expect(glyph?.dataset.icon).toBeUndefined();
  });

  it("runs bb's action from its button, and closes", () => {
    const { env, anchor } = start({}, { rowActions: ["bb--core/rename"] });
    openRow(anchor, ROW.actionWidthPx);
    button("bb--core/rename")?.click();
    expect(env.ran).toHaveBeenCalledWith("bb--core/rename");
    vi.advanceTimersByTime(TIMING.settleMs);
    expect(document.querySelector(".bbsc-row")).toBe(null);
  });

  it("offers another plugin's action, marked when it is destructive", () => {
    const { env, anchor } = start({}, { rowActions: ["acme/deploy", "bb--core/pin"] });
    openRow(anchor, 2 * ROW.actionWidthPx);
    expect(button("acme/deploy")?.textContent).toBe("Deploy");
    expect(button("acme/deploy")?.hasAttribute("data-destructive")).toBe(true);
    expect(button("bb--core/pin")?.hasAttribute("data-destructive")).toBe(false);
    button("acme/deploy")?.click();
    expect(env.ran).toHaveBeenCalledWith("acme/deploy");
  });

  it("shows an action bb has disabled, and doesn't run it", () => {
    const { env, anchor } = start({}, { rowActions: ["acme/locked"] });
    openRow(anchor, ROW.actionWidthPx);
    expect(button("acme/locked")?.disabled).toBe(true);
    button("acme/locked")?.click();
    expect(env.ran).not.toHaveBeenCalled();
  });

  it("makes read the rightward swipe, not a button", () => {
    const { env, anchor } = start({}, { rowActions: ["bb--core/read", "bb--core/pin"] });
    openRow(anchor, ROW.actionWidthPx);
    expect(buttons()).toEqual(["bb--core/pin"]);
    closeRow();
    swipe(anchor, -(WHEEL_TO_ARM_RIGHT + 10), -10);
    endGesture();
    expect(env.ran).toHaveBeenCalledWith("bb--core/read");
  });

  it("shows read as a button when a swipe right runs something else", () => {
    const { env, anchor } = start({}, { rowActions: ["bb--core/read", "bb--core/pin"], right: "bb--core/pin" });
    openRow(anchor, ROW.actionWidthPx);
    expect(buttons()).toEqual(["bb--core/read"]);
    closeRow();
    swipe(anchor, -(WHEEL_TO_ARM_RIGHT + 10), -10);
    expect(document.querySelector<HTMLElement>(".bbsc-lead")?.dataset.action).toBe("bb--core/pin");
    endGesture();
    expect(env.ran.mock.calls).toEqual([["bb--core/pin"]]);
  });

  it("doesn't swipe right when that swipe is set to Nothing", () => {
    const { env, row, anchor } = start({}, { right: null });
    const events = swipe(anchor, -(WHEEL_TO_ARM_RIGHT + 10), -10);
    endGesture();
    expect(env.ran).not.toHaveBeenCalled();
    expect(events.some((event) => event.defaultPrevented)).toBe(false);
    expect(row.style.translate).toBe("");
  });

  it("leaves out an action that asks a further question, and one nobody registered", () => {
    const { anchor } = start({}, { rowActions: ["thread-list/move", "bb--core/pin", "gone/away"] });
    openRow(anchor, ROW.actionWidthPx);
    expect(buttons()).toEqual(["bb--core/pin"]);
  });

  it("doesn't swipe left with no button to uncover and no full swipe", () => {
    const { row, anchor } = start({}, { rowActions: ["bb--core/read", "thread-list/move"], fullLeft: null });
    const events = swipe(anchor, 120);
    expect(events.some((event) => event.defaultPrevented)).toBe(false);
    expect(row.style.translate).toBe("");
  });

  it("archives on a full swipe when Archive isn't one of the buttons, taking over the strip", () => {
    const { env, anchor } = start({}, { rowActions: ["bb--core/pin", "bb--core/copyLink"] });
    expect(buttons()).toEqual([]);
    swipe(anchor, wheelToFull(LAYOUT) + 50);
    const full = document.querySelector<HTMLElement>(".bbsc-full-only");
    expect(full?.dataset.action).toBe("bb--core/archive");
    expect(full?.tagName).toBe("DIV");
    expect(document.querySelector(".bbsc-trail")?.hasAttribute("data-full")).toBe(true);
    endGesture();
    vi.advanceTimersByTime(TIMING.slideOutMs);
    expect(env.ran.mock.calls).toEqual([["bb--core/archive"]]);
  });

  it("marks the button a full swipe runs, and adds nothing beside it", () => {
    const { anchor } = start({}, { rowActions: ["bb--core/pin", "bb--core/archive"] });
    openRow(anchor, 2 * ROW.actionWidthPx);
    expect(button("bb--core/archive")?.hasAttribute("data-full-swipe")).toBe(true);
    expect(button("bb--core/pin")?.hasAttribute("data-full-swipe")).toBe(false);
    expect(document.querySelector(".bbsc-full-only")).toBe(null);
  });

  it("runs any action on a full swipe, and lets the row ease back when it isn't Archive", () => {
    const { env, row, anchor } = start({}, { rowActions: ["bb--core/archive"], fullLeft: "bb--core/rename" });
    swipe(anchor, wheelToFull({ ...LAYOUT, trailingActions: 1 }) + 50);
    endGesture();
    expect(env.haptic).toHaveBeenLastCalledWith("impact-medium");
    expect(env.ran.mock.calls).toEqual([["bb--core/rename"]]);
    vi.advanceTimersByTime(TIMING.settleMs);
    expect(row.style.translate).toBe("");
    expect(document.querySelector(".bbsc-row")).toBe(null);
  });

  it("swipes all the way left with no buttons, and springs back short of it", () => {
    const { env, row, anchor } = start({}, { rowActions: [] });
    swipe(anchor, 100);
    expect(row.style.translate).toBe(`${-100 * WHEEL_ROW.resistance}px 0`);
    endGesture();
    vi.advanceTimersByTime(TIMING.settleMs);
    expect(document.querySelector(".bbsc-row")).toBe(null);
    expect(env.ran).not.toHaveBeenCalled();
    lift();
    swipe(anchor, wheelToFull({ ...LAYOUT, trailingActions: 0 }) + 20);
    endGesture();
    vi.advanceTimersByTime(TIMING.slideOutMs);
    expect(env.ran.mock.calls).toEqual([["bb--core/archive"]]);
  });

  it("takes more on a trackpad than a flick to the full swipe's old mark", () => {
    const { env, anchor } = start();
    swipe(anchor, fullPx(LAYOUT) + 10);
    endGesture();
    vi.advanceTimersByTime(TIMING.slideOutMs + TIMING.settleMs);
    expect(env.ran).not.toHaveBeenCalled();
    expect(document.querySelector(".bbsc-row")?.hasAttribute("data-open")).toBe(true);
  });

  it("takes more on a trackpad than a finger to swipe right", () => {
    const { env, anchor } = start();
    swipe(anchor, -(ROW.leadingArmPx + 10), -10);
    endGesture();
    expect(env.ran).not.toHaveBeenCalled();
    drag(anchor, ROW.leadingArmPx + 10);
    expect(env.ran.mock.calls).toEqual([["bb--core/read"]]);
  });

  it("leaves a finger's full swipe as it was", () => {
    const { env, anchor } = start();
    drag(anchor, -(fullPx(LAYOUT) + 10));
    vi.advanceTimersByTime(TIMING.slideOutMs);
    expect(env.ran.mock.calls).toEqual([["bb--core/archive"]]);
  });

  it("puts the row back as found when a swipe starts while the last one is still easing closed", () => {
    const { row, anchor } = start();
    row.style.borderRadius = "6px";
    swipe(anchor, 40);
    endGesture();
    // Released and easing closed: its view is still there.
    expect(document.querySelectorAll(".bbsc-row")).toHaveLength(1);
    swipe(anchor, -(WHEEL_TO_ARM_RIGHT + 10), -10);
    expect(document.querySelectorAll(".bbsc-row")).toHaveLength(1);
    endGesture();
    vi.advanceTimersByTime(TIMING.settleMs * 2);
    expect(document.querySelector(".bbsc-row")).toBe(null);
    expect(row.style.borderRadius).toBe("6px");
    expect(row.style.translate).toBe("");
    expect(row.style.clipPath).toBe("");
    expect(row.style.transition).toBe("");
    expect(row.style.willChange).toBe("");
  });

  it("squares the row's corners while it is swiped, and puts them back", () => {
    const { row, anchor } = start();
    row.style.borderRadius = "6px";
    openRow(anchor, 2 * ROW.actionWidthPx);
    expect(row.style.borderRadius).toBe("0px");
    closeRow();
    expect(row.style.borderRadius).toBe("6px");
  });

  it("archives from the Archive button as a full swipe does, sliding out first", () => {
    const { env, row, anchor } = start({}, { rowActions: ["bb--core/archive"] });
    openRow(anchor, ROW.actionWidthPx);
    button("bb--core/archive")?.click();
    expect(env.ran).not.toHaveBeenCalled();
    expect(row.style.translate).toBe(`${-ROW_WIDTH}px 0`);
    vi.advanceTimersByTime(TIMING.slideOutMs);
    expect(env.ran).toHaveBeenCalledWith("bb--core/archive");
  });

  it("asks what the row offers when the swipe begins, so a change applies to the next swipe", () => {
    const { anchor, keys } = start({}, { rowActions: ["bb--core/pin"] });
    openRow(anchor, ROW.actionWidthPx);
    expect(buttons()).toEqual(["bb--core/pin"]);
    closeRow();
    keys.current = { ...keys.current, rowActions: ["bb--core/split", "bb--core/archive"] };
    lift();
    openRow(anchor, 2 * ROW.actionWidthPx);
    expect(buttons()).toEqual(["bb--core/split", "bb--core/archive"]);
  });

  it("has the row actions read again when a swipe or touch starts on a row, and not elsewhere", () => {
    const { env, anchor, paragraph } = start();
    wheel(paragraph, 10);
    endGesture();
    touch("touchstart", paragraph, 150);
    touch("touchend", paragraph, 150);
    expect(env.refreshRowActions).not.toHaveBeenCalled();
    wheel(anchor, 10);
    expect(env.refreshRowActions).toHaveBeenCalledTimes(1);
    endGesture();
    touch("touchstart", anchor, 150);
    expect(env.refreshRowActions).toHaveBeenCalledTimes(2);
  });
});

describe("stopping", () => {
  it("puts the row back, removes the views and unmarks the rows", () => {
    const { row, anchor } = start();
    row.style.translate = "1px 0";
    drag(anchor, -80, { lift: false });
    expect(row.style.translate).toBe("-80px 0");
    expect(row.style.clipPath).toBe("inset(0 0 0 80px)");
    stop?.();
    stop = null;
    expect(row.style.translate).toBe("1px 0");
    expect(row.style.clipPath).toBe("");
    expect(document.querySelector(".bbsc-row, .bbsc-arrow")).toBe(null);
    expect(row.hasAttribute("data-no-sidebar-swipe")).toBe(false);
  });
});
