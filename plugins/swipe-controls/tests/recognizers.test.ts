import { describe, expect, it } from "vitest";
import { WHEEL, type WheelGesture, isSwipeCandidate, stepWheel } from "../lib/wheel.ts";
import { TOUCH, beginTouch, flingOf, moveTouch } from "../lib/touch.ts";
import { BACK_FORWARD, canGo, directionOf, progressOf } from "../lib/history.ts";

function run(samples: [number, number, number][]): { gesture: WheelGesture | null; locks: number; begins: number } {
  let gesture: WheelGesture | null = null;
  let locks = 0;
  let begins = 0;
  for (const [dx, dy, t] of samples) {
    const step = stepWheel(gesture, { dx, dy, t });
    gesture = step.gesture;
    if (step.locked) locks += 1;
    if (step.began) begins += 1;
  }
  return { gesture, locks, begins };
}

describe("stepWheel", () => {
  it("locks a slow horizontal swipe made of small deltas", () => {
    const { gesture, locks } = run([
      [3, 0, 0],
      [3, 1, 16],
      [3, 0, 32],
      [3, 0, 48],
      [3, 0, 64],
    ]);
    expect(gesture?.axis).toBe("horizontal");
    expect(gesture?.x).toBe(15);
    expect(locks).toBe(1);
  });

  it("waits for intent before deciding", () => {
    const { gesture } = run([[WHEEL.intentPx - 1, 0, 0]]);
    expect(gesture?.axis).toBe("pending");
  });

  it("decides at exactly the intent distance", () => {
    const { gesture } = run([[WHEEL.intentPx, 0, 0]]);
    expect(gesture?.axis).toBe("horizontal");
  });

  it("calls a diagonal vertical unless horizontal clearly wins", () => {
    expect(run([[12, 10, 0]]).gesture?.axis).toBe("vertical");
    expect(run([[13, 10, 0]]).gesture?.axis).toBe("horizontal");
  });

  it("holds the axis once decided", () => {
    const { gesture } = run([
      [0, 20, 0],
      [40, 0, 16],
      [40, 0, 32],
    ]);
    expect(gesture?.axis).toBe("vertical");
  });

  it("starts a new gesture after a pause, momentum included before it", () => {
    const { gesture, begins } = run([
      [20, 0, 0],
      [5, 0, WHEEL.gestureGapMs],
      [-20, 0, WHEEL.gestureGapMs * 2 + 1],
    ]);
    expect(begins).toBe(2);
    expect(gesture?.x).toBe(-20);
  });

  it("leaves pinch, shift-wheel and line deltas alone", () => {
    expect(isSwipeCandidate({ ctrlKey: false, shiftKey: false, deltaMode: 0 })).toBe(true);
    expect(isSwipeCandidate({ ctrlKey: true, shiftKey: false, deltaMode: 0 })).toBe(false);
    expect(isSwipeCandidate({ ctrlKey: false, shiftKey: true, deltaMode: 0 })).toBe(false);
    expect(isSwipeCandidate({ ctrlKey: false, shiftKey: false, deltaMode: 1 })).toBe(false);
  });
});

describe("touch tracking", () => {
  it("claims a horizontal drag at the intent distance", () => {
    let track = beginTouch(100, 100, 0);
    track = moveTouch(track, 100 + TOUCH.intentPx - 1, 100, 16);
    expect(track.state).toBe("pending");
    track = moveTouch(track, 100 + TOUCH.intentPx, 100, 32);
    expect(track.state).toBe("claimed");
    expect(track.dx).toBe(TOUCH.intentPx);
  });

  it("rejects a vertical drag, and stays rejected", () => {
    let track = beginTouch(100, 100, 0);
    track = moveTouch(track, 105, 120, 16);
    expect(track.state).toBe("rejected");
    track = moveTouch(track, 200, 120, 32);
    expect(track.state).toBe("rejected");
  });

  it("stays pending on a diagonal neither axis wins", () => {
    const track = moveTouch(beginTouch(0, 0, 0), 14, 13, 16);
    expect(track.state).toBe("pending");
  });

  it("reads a fling only while the finger is still moving", () => {
    let track = beginTouch(0, 0, 0);
    track = moveTouch(track, -20, 0, 10);
    track = moveTouch(track, -40, 0, 20);
    expect(track.velocityX).toBeLessThan(-TOUCH.flingPxPerSec);
    expect(flingOf(track, 20 + TOUCH.flingMaxIdleMs)).toBe(-1);
    expect(flingOf(track, 21 + TOUCH.flingMaxIdleMs)).toBe(0);
  });

  it("reads no fling from a slow drag", () => {
    let track = beginTouch(0, 0, 0);
    track = moveTouch(track, 20, 0, 100);
    track = moveTouch(track, 40, 0, 200);
    expect(flingOf(track, 200)).toBe(0);
  });
});

describe("history", () => {
  it("maps fingers right (negative deltaX) to back", () => {
    expect(directionOf(-1)).toBe("back");
    expect(directionOf(1)).toBe("forward");
  });

  it("reaches full progress at the commit distance and no sooner", () => {
    expect(progressOf(BACK_FORWARD.commitPx - 1)).toBeLessThan(1);
    expect(progressOf(-BACK_FORWARD.commitPx)).toBe(1);
    expect(progressOf(BACK_FORWARD.commitPx * 3)).toBe(1);
  });

  it("asks the Navigation API where it exists, and assumes yes where not", () => {
    const withApi = { navigation: { canGoBack: false, canGoForward: true } } as unknown as Window;
    expect(canGo("back", withApi)).toBe(false);
    expect(canGo("forward", withApi)).toBe(true);
    expect(canGo("back", {} as Window)).toBe(true);
  });
});
