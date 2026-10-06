// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { haptic } from "../../ui/haptics";

function fakeWindow({ native, coarse = true, vibrate = true }: { native?: unknown; coarse?: boolean; vibrate?: boolean }) {
  const vibrations: unknown[] = [];
  const win = {
    bb: native === undefined ? undefined : { native },
    matchMedia: (query: string) => ({ matches: query === "(pointer: coarse)" ? coarse : false }),
    navigator: vibrate ? { vibrate: (pattern: unknown) => vibrations.push(pattern) } : {},
  } as unknown as Window;
  return { win, vibrations };
}

describe("haptics", () => {
  it("asks bb's app for the kind, over its native bridge, when the app can do haptics", () => {
    const post = vi.fn();
    const { win, vibrations } = fakeWindow({ native: { capabilities: ["share", "haptic"], post } });
    haptic("impact-medium", win);
    expect(post).toHaveBeenCalledWith({ type: "haptic", kind: "impact-medium" });
    expect(vibrations).toEqual([]);
  });

  it("does not post to an app whose bridge lacks the haptic capability", () => {
    const post = vi.fn();
    const { win, vibrations } = fakeWindow({ native: { capabilities: ["share"], post } });
    haptic("selection", win);
    expect(post).not.toHaveBeenCalled();
    // It is still a phone: the browser fallback applies.
    expect(vibrations).toEqual([8]);
  });

  it("vibrates in a phone's browser, and only on a touchscreen", () => {
    const phone = fakeWindow({});
    haptic("success", phone.win);
    expect(phone.vibrations).toEqual([[12, 60, 12]]);

    const desktop = fakeWindow({ coarse: false });
    haptic("success", desktop.win);
    expect(desktop.vibrations).toEqual([]);
  });

  it("does nothing where there is no way to give feedback", () => {
    expect(() => haptic("error", fakeWindow({ vibrate: false }).win)).not.toThrow();
    expect(() => haptic("error", undefined)).not.toThrow();
  });

  it("never lets a failing bridge break the gesture", () => {
    const post = () => {
      throw new Error("bridge gone");
    };
    expect(() => haptic("selection", fakeWindow({ native: { capabilities: ["haptic"], post } }).win)).not.toThrow();
  });
});
