import { describe, expect, it } from "vitest";
import { DECIDE_DISTANCE, armed, keyCommand, leaning, progress, release } from "../lib/gesture";

describe("a drag", () => {
  it("leans sideways unless it is mostly upward", () => {
    expect(leaning(50, -20)).toBe("right");
    expect(leaning(-50, -20)).toBe("left");
    expect(leaning(20, -50)).toBe("up");
    expect(leaning(-30, 80)).toBe("left");
    expect(leaning(0, 60)).toBeNull();
    expect(leaning(0, 0)).toBeNull();
  });

  it("decides only past the threshold", () => {
    expect(release(DECIDE_DISTANCE - 1, 0)).toBeNull();
    expect(release(DECIDE_DISTANCE, 0)).toBe("right");
    expect(release(-DECIDE_DISTANCE, 10)).toBe("left");
    expect(release(5, -DECIDE_DISTANCE)).toBe("up");
    expect(release(0, DECIDE_DISTANCE * 2)).toBeNull();
  });

  it("decides a quick flick from a shorter drag, but not a twitch", () => {
    expect(release(60, 0, 1)).toBe("right");
    expect(release(60, 0, 0.1)).toBeNull();
    expect(release(20, 0, 5)).toBeNull();
  });

  it("is armed by distance alone, never by speed", () => {
    expect(armed(DECIDE_DISTANCE, 0)).toBe("right");
    expect(armed(60, 0)).toBeNull();
    expect(armed(0, -DECIDE_DISTANCE)).toBe("up");
  });

  it("reports progress toward deciding, capped at one", () => {
    expect(progress(DECIDE_DISTANCE / 2, 0)).toBeCloseTo(0.5);
    expect(progress(DECIDE_DISTANCE * 3, 0)).toBe(1);
    expect(progress(0, 0)).toBe(0);
  });
});

describe("keys", () => {
  it("map arrows to decisions, space and enter to details, Z to undo", () => {
    expect(keyCommand({ key: "ArrowRight" })).toBe("right");
    expect(keyCommand({ key: "ArrowLeft" })).toBe("left");
    expect(keyCommand({ key: "ArrowUp" })).toBe("up");
    expect(keyCommand({ key: "ArrowDown" })).toBeNull();
    expect(keyCommand({ key: " " })).toBe("details");
    expect(keyCommand({ key: "Enter" })).toBe("details");
    expect(keyCommand({ key: "Escape" })).toBe("close");
    expect(keyCommand({ key: "z" })).toBe("undo");
    expect(keyCommand({ key: "z", metaKey: true })).toBe("undo");
    expect(keyCommand({ key: "z", ctrlKey: true })).toBe("undo");
  });

  it("leave other modified presses to bb", () => {
    expect(keyCommand({ key: "ArrowRight", metaKey: true })).toBeNull();
    expect(keyCommand({ key: "ArrowLeft", altKey: true })).toBeNull();
    expect(keyCommand({ key: "z", altKey: true })).toBeNull();
  });
});
