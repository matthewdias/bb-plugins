// The overlay against the SDK: it reads the thread list's row actions, has bb
// evaluate them for the thread being swiped, and draws bb's icons in the row.
import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginSidebarThread, PluginThreadActionEntry } from "@get-bb/plugin-sdk/app";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { Gestures } from "../../components/Gestures.tsx";
import { TIMING } from "../../lib/controller.ts";
import { ROW } from "../../lib/row.ts";
import { WHEEL } from "../../lib/wheel.ts";
import { type FakeThread, bbRow, evaluate } from "../helpers.ts";

const ROW_WIDTH = 300;
/** Every key the fake bb has an action for. */
const REGISTERED = [
  "bb--core/split",
  "bb--core/copyLink",
  "bb--core/read",
  "bb--core/pin",
  "bb--core/rename",
  "bb--core/archive",
  "bb--core/delete",
  "thread-list/move",
  "acme/deploy",
];

let now = 1000;
/** What the thread list answers; null when it can't be asked. */
let preference: unknown[] | null;
let ran: ReturnType<typeof vi.fn<(key: string, threadId: string) => void>>;

function thread(id: string, state: Partial<FakeThread> = {}): PluginSidebarThread {
  const { isUnread = true, isPinned = false, isArchived = false } = state;
  return {
    id,
    projectId: "p1",
    parentThreadId: null,
    sectionId: null,
    status: "idle",
    isUnread,
    isPinned,
    pinnedAt: isPinned ? 1 : null,
    isArchived,
    archivedAt: isArchived ? 1 : null,
    href: `/projects/p1/threads/${id}`,
    environment: null,
  } as PluginSidebarThread;
}

function mount(
  threads: PluginSidebarThread[] = [thread("t1")],
  settings: Record<string, string | boolean> = {},
) {
  const rows = threads.map(({ id }) => {
    const { row, anchor } = bbRow(id);
    row.getBoundingClientRect = () =>
      ({ top: 0, left: 0, width: ROW_WIDTH, height: 44, right: ROW_WIDTH, bottom: 44, x: 0, y: 0, toJSON() {} }) as DOMRect;
    document.body.append(row);
    return anchor;
  });
  const slot = renderSlot({ component: Gestures }, {}, {
    settings,
    sidebarThreads: { threads },
    threadActions: (target) =>
      evaluate(
        REGISTERED,
        { isUnread: target.isUnread, isPinned: target.pinnedAt !== null, isArchived: target.archivedAt !== null },
        (key) => ran(key, target.id),
      ).map(
        (entry): PluginThreadActionEntry => ({
          key: entry.key,
          pluginId: entry.key.split("/")[0]!,
          group: "1_open",
          action: { ...entry.action, run: async () => void entry.action.run() } as PluginThreadActionEntry["action"],
        }),
      ),
    sdk: {
      plugins: {
        callRpc: (async (args: { outputSchema: { parse(value: unknown): unknown } }) => {
          if (preference === null) throw new Error("plugin not running");
          return args.outputSchema.parse({ preferences: { rowActions: preference } });
        }) as never,
      },
    },
  });
  return { slot, anchors: rows };
}

/** Let the preference's read land. */
const settle = () => act(async () => {});

function wheel(target: Element, deltaX: number) {
  now += 16;
  const event = new WheelEvent("wheel", { deltaX, bubbles: true, cancelable: true });
  Object.defineProperty(event, "timeStamp", { value: now });
  target.dispatchEvent(event);
}

/** A two-finger swipe of `total` px, the pause that ends it, and the row settling. */
function swipe(target: Element, total: number) {
  act(() => {
    const step = total > 0 ? 10 : -10;
    for (let moved = 0; Math.abs(moved) < Math.abs(total); moved += step) wheel(target, step);
    vi.advanceTimersByTime(WHEEL.gestureGapMs + 50);
    now += WHEEL.gestureGapMs + 50;
    vi.advanceTimersByTime(TIMING.settleMs);
  });
}

const buttons = () =>
  [...document.querySelectorAll<HTMLButtonElement>("button.bbsc-action")].map((button) => button.dataset.action);
const button = (key: string) => document.querySelector<HTMLButtonElement>(`button.bbsc-action[data-action="${key}"]`);
const reads = (slot: ReturnType<typeof mount>["slot"]) =>
  slot.inspection.sdkCalls.filter((call) => call.method === "plugins.callRpc");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  now = 1000;
  preference = ["bb--core/read", "bb--core/pin", "bb--core/archive"];
  ran = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("the overlay", () => {
  it("asks the thread list for its row actions", async () => {
    const { slot } = mount();
    await settle();
    expect(reads(slot)).toHaveLength(1);
    expect(reads(slot)[0]?.args[0]).toMatchObject({ pluginId: "thread-list", method: "listPreferences", input: null });
  });

  it("uncovers them as bb evaluates them for the swiped thread, with bb's icons", async () => {
    preference = ["bb--core/pin", "bb--core/rename", "acme/deploy"];
    const { anchors } = mount([thread("t1", { isPinned: true })]);
    await settle();
    swipe(anchors[0]!, 3 * ROW.actionWidthPx);
    expect(buttons()).toEqual(["bb--core/pin", "bb--core/rename", "acme/deploy"]);
    expect(button("bb--core/pin")?.textContent).toBe("Unpin");
    expect(button("bb--core/pin")?.querySelector(".bbsc-icon")?.childElementCount).toBe(1);
    act(() => button("bb--core/rename")?.click());
    expect(ran.mock.calls).toEqual([["bb--core/rename", "t1"]]);
  });

  it("evaluates them for whichever thread is swiped", async () => {
    const { anchors } = mount([thread("t1"), thread("t2", { isUnread: false })]);
    await settle();
    swipe(anchors[0]!, -(ROW.leadingArmPx + 10));
    swipe(anchors[1]!, -(ROW.leadingArmPx + 10));
    expect(ran.mock.calls).toEqual([
      ["bb--core/read", "t1"],
      ["bb--core/read", "t2"],
    ]);
  });

  it("offers read, Pin and Archive when the thread list can't be asked", async () => {
    preference = null;
    const { anchors } = mount();
    await settle();
    swipe(anchors[0]!, 2 * ROW.actionWidthPx);
    expect(buttons()).toEqual(["bb--core/pin", "bb--core/archive"]);
  });

  it("takes the names bb stored before 0.46", async () => {
    preference = ["archive", "pin"];
    const { anchors } = mount();
    await settle();
    swipe(anchors[0]!, 2 * ROW.actionWidthPx);
    expect(buttons()).toEqual(["bb--core/archive", "bb--core/pin"]);
  });

  it("doesn't swipe an archived thread", async () => {
    const { anchors } = mount([thread("t1", { isArchived: true })]);
    await settle();
    swipe(anchors[0]!, 2 * ROW.actionWidthPx);
    expect(document.querySelector(".bbsc-row")).toBe(null);
  });

  it("reads the row actions again when a swipe starts, so a change applies to the next one", async () => {
    const { anchors } = mount();
    await settle();
    preference = ["bb--core/split"];
    vi.advanceTimersByTime(5000);
    swipe(anchors[0]!, 2 * ROW.actionWidthPx);
    expect(buttons()).toEqual(["bb--core/pin", "bb--core/archive"]);
    await settle();
    act(() => {
      document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      vi.advanceTimersByTime(TIMING.settleMs + 1000);
      now += 1000;
    });
    swipe(anchors[0]!, ROW.actionWidthPx);
    expect(buttons()).toEqual(["bb--core/split"]);
  });

  it("reads them at most once a second, however many swipes start", async () => {
    const { slot, anchors } = mount();
    await settle();
    vi.advanceTimersByTime(5000);
    // Two swipes inside one second: one read between them.
    swipe(anchors[0]!, -(ROW.leadingArmPx + 10));
    await settle();
    swipe(anchors[0]!, -(ROW.leadingArmPx + 10));
    await settle();
    expect(reads(slot)).toHaveLength(2);
    vi.advanceTimersByTime(1000);
    swipe(anchors[0]!, -(ROW.leadingArmPx + 10));
    await settle();
    expect(reads(slot)).toHaveLength(3);
  });

  it("runs the settings' whole swipes, whatever the row actions are", async () => {
    preference = ["bb--core/copyLink"];
    const { anchors } = mount([thread("t1")], { swipeRight: "Pin", swipeLeftFull: "Delete" });
    await settle();
    swipe(anchors[0]!, -(ROW.leadingArmPx + 10));
    swipe(anchors[0]!, ROW_WIDTH);
    expect(ran.mock.calls).toEqual([
      ["bb--core/pin", "t1"],
      ["bb--core/delete", "t1"],
    ]);
  });

  it("archives on a full swipe by default, without Archive as a row action", async () => {
    preference = ["bb--core/pin"];
    const { anchors } = mount();
    await settle();
    act(() => {
      for (let moved = 0; moved < ROW_WIDTH; moved += 10) wheel(anchors[0]!, 10);
    });
    expect(buttons()).toEqual(["bb--core/pin"]);
    expect(document.querySelector<HTMLElement>(".bbsc-full-only")?.dataset.action).toBe("bb--core/archive");
    act(() => vi.advanceTimersByTime(WHEEL.gestureGapMs + 50 + TIMING.slideOutMs));
    expect(ran.mock.calls).toEqual([["bb--core/archive", "t1"]]);
  });

  it("has no swipe right for Nothing, and runs whichever action the setting names", async () => {
    const { slot, anchors } = mount([thread("t1")], { swipeRight: "Nothing" });
    await settle();
    swipe(anchors[0]!, -(ROW.leadingArmPx + 10));
    expect(ran).not.toHaveBeenCalled();
    slot.unmount();
    const again = mount([thread("t2")], { swipeRight: "Rename" });
    await settle();
    swipe(again.anchors[0]!, -(ROW.leadingArmPx + 10));
    expect(ran.mock.calls).toEqual([["bb--core/rename", "t2"]]);
  });
});

describe("bb's own row buttons", () => {
  const hidden = () => document.documentElement.hasAttribute("data-bbsc-hide-row-actions");

  it("are hidden while the overlay runs, and shown again when it goes", () => {
    const { slot } = mount();
    expect(hidden()).toBe(true);
    slot.unmount();
    expect(hidden()).toBe(false);
  });

  it("stay when the setting is off, or when threads don't swipe", () => {
    const off = mount([thread("t1")], { hideRowActions: false });
    expect(hidden()).toBe(false);
    off.slot.unmount();
    mount([thread("t2")], { rowSwipes: false });
    expect(hidden()).toBe(false);
  });
});
