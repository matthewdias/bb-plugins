// Two-finger trackpad swipes, recognized from wheel events.
//
// A trackpad swipe reaches the page as a stream of wheel events, and once the
// fingers lift macOS keeps the stream going with momentum events. Chromium
// does not say which is which, so a gesture here is a run of wheel events with
// no gap longer than `gestureGapMs`, momentum included. That is also what
// keeps one swipe from acting twice: the momentum tail belongs to the gesture
// that already acted.
//
// Momentum is still told apart, for a row: a flick that runs on with momentum
// must not swipe a row all the way. Momentum is a run of events in one
// direction, each smaller than the last, which fingers rarely make for long.
// Once a run is long enough, all of it counts as momentum, back to its start,
// and so does what follows while it keeps shrinking. A bigger event is the
// fingers pushing again.
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
  /** Momentum: this many events in a row, one way, each smaller than the last. */
  momentumEvents: 3,
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
  /** The last sample's deltaX. */
  lastDx: number;
  /** How many samples in a row have shrunk, one way, ending with this one. */
  shrinking: number;
  /** Their deltaX, summed. */
  shrinkingDx: number;
  /** The gesture is running on with momentum. */
  coasting: boolean;
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
  /**
   * deltaX this sample found to be momentum: its own while coasting, and on
   * the sample that starts coasting, the whole run's.
   */
  momentumDx: number;
}

export function stepWheel(previous: WheelGesture | null, sample: WheelSample): WheelStep {
  const began = previous === null || sample.t - previous.lastT > WHEEL.gestureGapMs;
  const base: WheelGesture = began
    ? { axis: "pending", x: 0, y: 0, lastT: sample.t, lastDx: 0, shrinking: 0, shrinkingDx: 0, coasting: false }
    : previous;
  const x = base.x + sample.dx;
  const y = base.y + sample.dy;
  let axis = base.axis;
  if (axis === "pending" && Math.hypot(x, y) >= WHEEL.intentPx) {
    axis = Math.abs(x) > Math.abs(y) * WHEEL.axisRatio ? "horizontal" : "vertical";
  }
  const size = Math.abs(sample.dx);
  const sameWay = sample.dx !== 0 && Math.sign(sample.dx) === Math.sign(base.lastDx);
  // Shrinking, or holding steady once already coasting: momentum's tail
  // repeats its last few pixels.
  const shrank = sameWay && (size < Math.abs(base.lastDx) || (base.coasting && size <= Math.abs(base.lastDx)));
  const shrinking = shrank ? base.shrinking + 1 : 0;
  const shrinkingDx = shrank ? base.shrinkingDx + sample.dx : 0;
  const coasting = shrinking >= WHEEL.momentumEvents;
  return {
    gesture: { axis, x, y, lastT: sample.t, lastDx: sample.dx, shrinking, shrinkingDx, coasting },
    began,
    locked: base.axis !== "horizontal" && axis === "horizontal",
    momentumDx: !coasting ? 0 : base.coasting ? sample.dx : shrinkingDx,
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
