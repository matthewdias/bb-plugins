// Two-finger trackpad swipes, recognized from wheel events.
//
// A trackpad swipe reaches the page as a stream of wheel events, and once the
// fingers lift macOS keeps the stream going with momentum events. Chromium
// does not say which is which, so a gesture here is a run of wheel events with
// no gap longer than `gestureGapMs`, momentum included. That is also what
// keeps one swipe from acting twice: the momentum tail belongs to the gesture
// that already acted.
//
// The axis is decided once per gesture, from the movement summed since it
// began, and then held. Deciding per event, as bb's own compact-viewport
// swipe does, drops slow swipes whose events are each a few pixels.

export const WHEEL = {
  /** Summed movement before the axis is decided. */
  intentPx: 12,
  /** Horizontal wins only when it beats vertical by this much. */
  axisRatio: 1.25,
  /** A longer pause than this starts a new gesture. */
  gestureGapMs: 160,
} as const;

export type WheelAxis = "pending" | "horizontal" | "vertical";

export interface WheelGesture {
  axis: WheelAxis;
  /**
   * deltaX summed since the gesture began. Positive scrolls content to the
   * right, which is fingers moving left.
   */
  x: number;
  y: number;
  lastT: number;
}

export interface WheelSample {
  dx: number;
  dy: number;
  t: number;
}

export interface WheelStep {
  gesture: WheelGesture;
  /** This sample started a new gesture. */
  began: boolean;
  /** This sample decided the gesture is horizontal. */
  locked: boolean;
}

export function stepWheel(previous: WheelGesture | null, sample: WheelSample): WheelStep {
  const began = previous === null || sample.t - previous.lastT > WHEEL.gestureGapMs;
  const base: WheelGesture = began
    ? { axis: "pending", x: 0, y: 0, lastT: sample.t }
    : previous;
  const x = base.x + sample.dx;
  const y = base.y + sample.dy;
  let axis = base.axis;
  if (axis === "pending" && Math.hypot(x, y) >= WHEEL.intentPx) {
    axis = Math.abs(x) > Math.abs(y) * WHEEL.axisRatio ? "horizontal" : "vertical";
  }
  return {
    gesture: { axis, x, y, lastT: sample.t },
    began,
    locked: base.axis !== "horizontal" && axis === "horizontal",
  };
}

/**
 * Wheel events this recognizer must leave alone: pinch (Chromium reports it
 * as a ctrl-wheel), shift-wheel (a mouse scrolling sideways, not a swipe),
 * and line- or page-based deltas, which only mice produce.
 */
export function isSwipeCandidate(event: Pick<WheelEvent, "ctrlKey" | "shiftKey" | "deltaMode">): boolean {
  return !event.ctrlKey && !event.shiftKey && event.deltaMode === 0;
}
