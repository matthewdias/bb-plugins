import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ARRIVAL_MS, SETTLE_MS, openChanges, pointPanelAtDiff, showPanelOnArrival } from "../../src/page/open-changes.ts";

// Going to a pull request's changes: bb's stored panel entry is pointed at the
// diff before the thread opens, and on a narrow screen, where the panel is a
// drawer that starts shut, bb's own control for it is pressed on arrival.

const KEY = "bb.thread.fixedPanelTabsState-thr_pr-1";
const THREAD = "/projects/prj_1/threads/thr_pr";
const stored = () => JSON.parse(window.localStorage.getItem(KEY) as string);

function screen(narrow: boolean) {
  window.matchMedia = ((query: string) => ({ matches: narrow && query === "(max-width: 767px)" })) as never;
}

/** bb's panel control, as its thread view draws it. */
function control(label: string) {
  const button = document.createElement("button");
  button.setAttribute("aria-label", label);
  const pressed = vi.fn();
  button.addEventListener("click", pressed);
  document.body.append(button);
  return { button, pressed };
}

/** Let the observer see what was just drawn, then let `ms` pass. */
const pass = (ms: number) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  window.history.pushState({}, "", "/plugins/follow-up/page");
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  document.body.replaceChildren();
  Reflect.deleteProperty(window, "matchMedia");
});

describe("pointing the panel at the diff", () => {
  it("writes an entry for a thread this browser never opened", () => {
    pointPanelAtDiff("thr_pr");
    expect(stored().secondary).toEqual({
      tabs: [
        { id: "thread-info:thread-info:none", kind: "thread-info" },
        { id: "git-diff:git-diff:none", kind: "git-diff" },
      ],
      activeTabId: "git-diff:git-diff:none",
      isOpen: true,
    });
    expect(stored().lastUsedAt).toBe(Date.now());
  });

  it("changes the entry bb left, and no other thread's", () => {
    const left = { version: 1, secondary: { tabs: [], activeTabId: null, isOpen: false }, lastUsedAt: 5 };
    window.localStorage.setItem(KEY, JSON.stringify(left));
    window.localStorage.setItem("bb.thread.fixedPanelTabsState-thr_other-1", JSON.stringify(left));
    pointPanelAtDiff("thr_pr");
    expect(stored().secondary).toMatchObject({ activeTabId: "git-diff:git-diff:none", isOpen: true });
    expect(window.localStorage.getItem("bb.thread.fixedPanelTabsState-thr_other-1")).toBe(JSON.stringify(left));
  });

  it("leaves an entry it does not recognise exactly as it was", () => {
    const foreign = JSON.stringify({ version: 2, panels: [] });
    window.localStorage.setItem(KEY, foreign);
    pointPanelAtDiff("thr_pr");
    expect(window.localStorage.getItem(KEY)).toBe(foreign);
  });

  it("says nothing when storage cannot be read", () => {
    const refusing = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    try {
      expect(() => pointPanelAtDiff("thr_pr")).not.toThrow();
    } finally {
      refusing.mockRestore();
    }
  });
});

describe("opening the changes", () => {
  it("points the panel before it goes, since bb reads the entry as the thread comes on screen", () => {
    screen(false);
    const seenOnTheWay: (string | null)[] = [];
    const toThread = vi.fn(() => seenOnTheWay.push(window.localStorage.getItem(KEY)));
    openChanges("thr_pr", toThread);
    expect(toThread).toHaveBeenCalledWith("thr_pr");
    expect(JSON.parse(seenOnTheWay[0] as string).secondary.activeTabId).toBe("git-diff:git-diff:none");
  });

  it("presses the panel's control on a narrow screen, once the thread is on screen", async () => {
    screen(true);
    openChanges("thr_pr", () => window.history.pushState({}, "", THREAD));
    const { pressed } = control("Show right panel (⌘ J)");
    await pass(SETTLE_MS - 1);
    expect(pressed).not.toHaveBeenCalled();
    await pass(1);
    expect(pressed).toHaveBeenCalledTimes(1);
    await pass(ARRIVAL_MS);
    expect(pressed).toHaveBeenCalledTimes(1);
  });
});

describe("showing the panel on arrival", () => {
  it("presses nothing on a wide screen, where the stored entry opens the panel", async () => {
    screen(false);
    window.history.pushState({}, "", THREAD);
    showPanelOnArrival("thr_pr");
    const { pressed } = control("Show right panel (⌘ J)");
    await pass(ARRIVAL_MS);
    expect(pressed).not.toHaveBeenCalled();
  });

  it("presses nothing where the browser cannot say how wide it is", async () => {
    window.history.pushState({}, "", THREAD);
    expect(() => showPanelOnArrival("thr_pr")).not.toThrow();
    const { pressed } = control("Show right panel");
    await pass(ARRIVAL_MS);
    expect(pressed).not.toHaveBeenCalled();
  });

  it("presses a control that was already there when it looked", async () => {
    screen(true);
    window.history.pushState({}, "", THREAD);
    const { pressed } = control("Show right panel");
    showPanelOnArrival("thr_pr");
    await pass(SETTLE_MS);
    expect(pressed).toHaveBeenCalledTimes(1);
  });

  it("presses once, however much the thread goes on drawing while it settles", async () => {
    screen(true);
    window.history.pushState({}, "", THREAD);
    showPanelOnArrival("thr_pr");
    const { pressed } = control("Show right panel");
    await pass(SETTLE_MS / 3);
    document.body.append(document.createElement("section"));
    await pass(SETTLE_MS / 3);
    document.body.append(document.createElement("section"));
    await pass(SETTLE_MS * 3);
    // A second press would shut the drawer the first one opened.
    expect(pressed).toHaveBeenCalledTimes(1);
  });

  it("waits for the thread: a control on another page is not its to press", async () => {
    screen(true);
    showPanelOnArrival("thr_pr");
    const { pressed } = control("Show right panel");
    await pass(SETTLE_MS * 2);
    expect(pressed).not.toHaveBeenCalled();
    // Another thread is not this one either.
    window.history.pushState({}, "", "/projects/prj_1/threads/thr_pr_2");
    control("Show right panel");
    await pass(SETTLE_MS * 2);
    expect(pressed).not.toHaveBeenCalled();
  });

  it("leaves a panel the reader already opened, and stops looking", async () => {
    screen(true);
    window.history.pushState({}, "", THREAD);
    showPanelOnArrival("thr_pr");
    const open = control("Hide right panel (⌘ J)");
    await pass(SETTLE_MS);
    open.button.remove();
    const { pressed } = control("Show right panel (⌘ J)");
    await pass(ARRIVAL_MS);
    expect(pressed).not.toHaveBeenCalled();
    expect(open.pressed).not.toHaveBeenCalled();
  });

  it("presses no other control, whatever it is called", async () => {
    screen(true);
    window.history.pushState({}, "", THREAD);
    showPanelOnArrival("thr_pr");
    const other = control("Open the follow-ups panel");
    const info = control("Show thread info panel");
    await pass(ARRIVAL_MS);
    expect(other.pressed).not.toHaveBeenCalled();
    expect(info.pressed).not.toHaveBeenCalled();
  });

  it("does not press once the reader has gone somewhere else while it settled", async () => {
    screen(true);
    window.history.pushState({}, "", THREAD);
    showPanelOnArrival("thr_pr");
    const { pressed } = control("Show right panel");
    await pass(SETTLE_MS - 1);
    window.history.pushState({}, "", "/plugins/follow-up/page");
    await pass(SETTLE_MS);
    expect(pressed).not.toHaveBeenCalled();
  });

  it("gives up after a while: a control drawn later is the reader's to press", async () => {
    screen(true);
    window.history.pushState({}, "", THREAD);
    showPanelOnArrival("thr_pr");
    await pass(ARRIVAL_MS);
    const { pressed } = control("Show right panel");
    await pass(ARRIVAL_MS);
    expect(pressed).not.toHaveBeenCalled();
  });
});
