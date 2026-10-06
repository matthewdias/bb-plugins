import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type GestureEnv, type GestureSettings, type ThreadFacts, TIMING, startGestures } from "../lib/controller.ts";
import { BACK_FORWARD, type HistoryDirection } from "../lib/history.ts";
import { ROW, fullPx, revealWidth } from "../lib/row.ts";
import { WHEEL } from "../lib/wheel.ts";
import { bbRow } from "./helpers.ts";

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
  facts: Map<string, ThreadFacts>,
  compact: boolean,
  canGo: boolean,
) {
  return {
    doc: document,
    settings: { rowSwipes: true, rowLeftSwipe: true, fullSwipeArchive: true, backForward: true, ...settings },
    compact: () => compact,
    reducedMotion: () => false,
    thread: (id: string) => facts.get(id) ?? null,
    setRead: vi.fn(),
    setPinned: vi.fn(),
    archive: vi.fn(),
    canGo: vi.fn((_direction: HistoryDirection) => canGo),
    go: vi.fn(),
    haptic: vi.fn(),
  } satisfies GestureEnv;
}

interface Harness {
  env: ReturnType<typeof makeEnv>;
  row: HTMLElement;
  anchor: HTMLAnchorElement;
  main: HTMLElement;
  paragraph: HTMLElement;
  facts: Map<string, ThreadFacts>;
}

function start(
  settings: Partial<GestureSettings> = {},
  { compact = false, canGo = true }: { compact?: boolean; canGo?: boolean } = {},
): Harness {
  const { row, anchor } = bbRow("t1");
  sized(row);
  const main = document.createElement("main");
  main.setAttribute("data-sidebar", "inset");
  const paragraph = document.createElement("p");
  main.append(paragraph);
  document.body.append(row, main);
  const facts = new Map<string, ThreadFacts>([["t1", { isUnread: true, isPinned: false, isArchived: false }]]);
  const env = makeEnv(settings, facts, compact, canGo);
  stop = startGestures(env);
  return { env, row, anchor, main, paragraph, facts };
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
    const events = swipe(anchor, revealWidth(LAYOUT));
    expect(events.at(-1)?.defaultPrevented).toBe(true);
    expect(row.style.translate).toBe("-150px 0");
    endGesture();
    vi.advanceTimersByTime(TIMING.settleMs);
    expect(row.style.translate).toBe(`${-revealWidth(LAYOUT)}px 0`);
    const pin = document.querySelector<HTMLButtonElement>('.bbsc-action[data-action="pin"]');
    expect(pin?.textContent).toBe("Pin");
    pin?.click();
    expect(env.setPinned).toHaveBeenCalledWith("t1", true);
    vi.advanceTimersByTime(TIMING.settleMs);
    expect(row.style.translate).toBe("");
    expect(document.querySelector(".bbsc-row")).toBe(null);
  });

  it("archives on a full swipe, with a tick on arming and a thump on release", () => {
    const { env, anchor } = start();
    swipe(anchor, fullPx(LAYOUT) + 10);
    expect(env.haptic).toHaveBeenCalledWith("selection");
    endGesture();
    expect(env.haptic).toHaveBeenLastCalledWith("impact-medium");
    vi.advanceTimersByTime(TIMING.slideOutMs);
    expect(env.archive).toHaveBeenCalledWith("t1");
  });

  it("does not archive a full swipe when that setting is off", () => {
    const { env, anchor } = start({ fullSwipeArchive: false });
    swipe(anchor, fullPx(LAYOUT) + 50);
    endGesture();
    vi.advanceTimersByTime(TIMING.slideOutMs + TIMING.settleMs);
    expect(env.archive).not.toHaveBeenCalled();
    expect(document.querySelector(".bbsc-row")?.hasAttribute("data-open")).toBe(true);
  });

  it("marks read on a swipe right", () => {
    const { env, anchor } = start();
    swipe(anchor, -(ROW.leadingArmPx + 10), -10);
    endGesture();
    expect(env.setRead).toHaveBeenCalledWith("t1", true);
  });

  it("marks unread a thread that is read", () => {
    const { env, anchor, facts } = start();
    facts.set("t1", { isUnread: false, isPinned: false, isArchived: false });
    swipe(anchor, -(ROW.leadingArmPx + 10), -10);
    endGesture();
    expect(env.setRead).toHaveBeenCalledWith("t1", false);
  });

  it("leaves rows alone when row swipes are off", () => {
    const { env, row, anchor } = start({ rowSwipes: false });
    swipe(anchor, -(ROW.leadingArmPx + 10), -10);
    endGesture();
    expect(env.setRead).not.toHaveBeenCalled();
    expect(row.style.translate).toBe("");
  });

  it("doesn't swipe an archived thread", () => {
    const { env, anchor, facts } = start();
    facts.set("t1", { isUnread: true, isPinned: false, isArchived: true });
    swipe(anchor, -(ROW.leadingArmPx + 10), -10);
    endGesture();
    expect(env.setRead).not.toHaveBeenCalled();
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
    expect(env.setRead).toHaveBeenCalledWith("t1", true);
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
    expect(env.setRead).not.toHaveBeenCalled();
  });

  it("yields to bb's long-press reorder", () => {
    const { env, row, anchor } = start();
    row.setAttribute("data-sidebar-touch-armed", "true");
    drag(anchor, ROW.leadingArmPx + 20);
    expect(env.setRead).not.toHaveBeenCalled();
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
