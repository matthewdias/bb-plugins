import { afterEach, describe, expect, it, vi } from "vitest";
import { canScrollX, insetTarget, rowTarget } from "../lib/targets.ts";
import { markRows } from "../lib/row-marks.ts";
import { createHaptics } from "../lib/haptics.ts";
import { backForwardEnabled, parseGestureSettings } from "../lib/settings.ts";
import { bbRow } from "./helpers.ts";

afterEach(() => {
  document.body.replaceChildren();
});

describe("rowTarget", () => {
  it("finds the whole row from its title", () => {
    const { row, anchor } = bbRow("t1");
    document.body.append(row);
    expect(rowTarget(anchor)).toEqual({ element: row, threadId: "t1" });
  });

  it("finds the row from outside its anchor", () => {
    const { row, glyph } = bbRow("t1");
    document.body.append(row);
    expect(rowTarget(glyph)).toEqual({ element: row, threadId: "t1" });
  });

  it("falls back to the anchor in a list without bb's container", () => {
    const anchor = document.createElement("a");
    anchor.setAttribute("data-sidebar-thread-id", "t2");
    document.body.append(anchor);
    expect(rowTarget(anchor)).toEqual({ element: anchor, threadId: "t2" });
  });

  it("leaves a field inside a row alone", () => {
    const { row, anchor } = bbRow("t1");
    const input = document.createElement("input");
    anchor.append(input);
    document.body.append(row);
    expect(rowTarget(input)).toBe(null);
  });

  it("finds nothing off a row", () => {
    expect(rowTarget(document.body)).toBe(null);
  });
});

describe("insetTarget", () => {
  it("finds the main pane", () => {
    const main = document.createElement("main");
    main.setAttribute("data-sidebar", "inset");
    const p = document.createElement("p");
    main.append(p);
    document.body.append(main);
    expect(insetTarget(p)).toBe(main);
  });

  it("honors bb's opt-outs, ours, and fields", () => {
    const main = document.createElement("main");
    main.setAttribute("data-sidebar", "inset");
    for (const attribute of ["data-no-sidebar-swipe", "data-no-secondary-panel-swipe", "data-no-swipe-controls"]) {
      const region = document.createElement("div");
      region.setAttribute(attribute, "");
      main.append(region);
      expect(insetTarget(region)).toBe(null);
    }
    const textarea = document.createElement("textarea");
    main.append(textarea);
    document.body.append(main);
    expect(insetTarget(textarea)).toBe(null);
  });

  it("finds nothing outside the main pane", () => {
    expect(insetTarget(document.body)).toBe(null);
  });
});

describe("canScrollX", () => {
  function scroller(scrollLeft: number): { boundary: HTMLElement; inner: HTMLElement } {
    const boundary = document.createElement("main");
    const pre = document.createElement("pre");
    pre.style.overflowX = "auto";
    Object.defineProperty(pre, "scrollWidth", { value: 500 });
    Object.defineProperty(pre, "clientWidth", { value: 200 });
    pre.scrollLeft = scrollLeft;
    const inner = document.createElement("code");
    pre.append(inner);
    boundary.append(pre);
    document.body.append(boundary);
    return { boundary, inner };
  }

  it("keeps a swipe a code block can still scroll", () => {
    const { boundary, inner } = scroller(0);
    expect(canScrollX(inner, 10, boundary)).toBe(true);
  });

  it("lets a swipe through at the block's edge", () => {
    const { boundary, inner } = scroller(0);
    expect(canScrollX(inner, -10, boundary)).toBe(false);
  });

  it("keeps a swipe back while the block is scrolled", () => {
    const { boundary, inner } = scroller(50);
    expect(canScrollX(inner, -10, boundary)).toBe(true);
  });

  it("ignores scrollers outside the boundary", () => {
    const outer = document.createElement("div");
    outer.style.overflowX = "auto";
    Object.defineProperty(outer, "scrollWidth", { value: 500 });
    Object.defineProperty(outer, "clientWidth", { value: 200 });
    const boundary = document.createElement("main");
    const p = document.createElement("p");
    boundary.append(p);
    outer.append(boundary);
    document.body.append(outer);
    expect(canScrollX(p, 10, boundary)).toBe(false);
  });
});

describe("markRows", () => {
  it("marks rows that exist and rows that arrive, then unmarks only its own", async () => {
    const first = bbRow("t1");
    const theirs = bbRow("t3");
    theirs.row.setAttribute("data-no-sidebar-swipe", "");
    document.body.append(first.row, theirs.row);
    const unmark = markRows(document.body);
    expect(first.row.hasAttribute("data-no-sidebar-swipe")).toBe(true);
    expect(first.anchor.hasAttribute("data-no-sidebar-swipe")).toBe(false);

    const second = bbRow("t2");
    document.body.append(second.row);
    await Promise.resolve();
    expect(second.row.hasAttribute("data-no-sidebar-swipe")).toBe(true);

    unmark();
    expect(first.row.hasAttribute("data-no-sidebar-swipe")).toBe(false);
    expect(second.row.hasAttribute("data-no-sidebar-swipe")).toBe(false);
    expect(theirs.row.hasAttribute("data-no-sidebar-swipe")).toBe(true);
  });
});

describe("createHaptics", () => {
  const fakeWindow = (extra: Record<string, unknown>, coarse = false) =>
    ({
      navigator: {},
      matchMedia: () => ({ matches: coarse }),
      ...extra,
    }) as unknown as Window;

  it("posts to bb's app bridge when it offers haptics", () => {
    const post = vi.fn();
    const haptics = createHaptics(fakeWindow({ bb: { native: { capabilities: ["badge", "haptic"], post } } }));
    expect(haptics.driver).toBe("native");
    haptics.play("selection");
    expect(post).toHaveBeenCalledWith({ type: "haptic", kind: "selection" });
  });

  it("ignores a bridge without the capability", () => {
    const post = vi.fn();
    const haptics = createHaptics(fakeWindow({ bb: { native: { capabilities: ["badge"], post } } }));
    expect(haptics.driver).toBe(null);
    haptics.play("selection");
    expect(post).not.toHaveBeenCalled();
  });

  it("survives a bridge that throws", () => {
    const post = vi.fn(() => {
      throw new Error("torn down");
    });
    const haptics = createHaptics(fakeWindow({ bb: { native: { capabilities: ["haptic"], post } } }));
    expect(() => haptics.play("selection")).not.toThrow();
  });

  it("vibrates on a coarse pointer, not a fine one", () => {
    const vibrate = vi.fn();
    const touch = fakeWindow({ navigator: { vibrate } }, true);
    expect(createHaptics(touch).driver).toBe("vibrate");
    createHaptics(touch).play("impact-medium");
    expect(vibrate).toHaveBeenCalledWith(15);
    expect(createHaptics(fakeWindow({ navigator: { vibrate } }, false)).driver).toBe(null);
  });
});

describe("settings", () => {
  it("turns back/forward on in the desktop app by default", () => {
    expect(backForwardEnabled("In the desktop app", true)).toBe(true);
    expect(backForwardEnabled("In the desktop app", false)).toBe(false);
    expect(backForwardEnabled("Always", false)).toBe(true);
    expect(backForwardEnabled("Never", true)).toBe(false);
  });

  it("falls back to the defaults for missing or malformed values", () => {
    expect(parseGestureSettings(undefined, true)).toEqual({
      rowSwipes: true,
      rowLeftSwipe: true,
      fullSwipeArchive: true,
      backForward: true,
    });
    expect(parseGestureSettings({ rowSwipes: "yes", rowLeftSwipe: false }, false)).toEqual({
      rowSwipes: true,
      rowLeftSwipe: false,
      fullSwipeArchive: true,
      backForward: false,
    });
  });
});
