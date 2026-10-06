// One-finger horizontal drags, recognized from touch events.
//
// The numbers are bb's own, from its compact sidebar swipe, so a drag that
// would open bb's sidebar and a drag that swipes a row feel alike: 12px of
// intent, vertical wins at 1.15×, horizontal needs 1.25×, and a fling is
// 450px/s with the finger still moving in the last 100ms.

export const TOUCH = {
  intentPx: 12,
  rejectRatio: 1.15,
  claimRatio: 1.25,
  flingPxPerSec: 450,
  flingMaxIdleMs: 100,
} as const;

export type TouchState = "pending" | "claimed" | "rejected";

export interface TouchTrack {
  state: TouchState;
  startX: number;
  startY: number;
  /** Horizontal travel since the touch began. */
  dx: number;
  lastX: number;
  lastT: number;
  /** Smoothed horizontal velocity, px/s. */
  velocityX: number;
}

export function beginTouch(x: number, y: number, t: number): TouchTrack {
  return { state: "pending", startX: x, startY: y, dx: 0, lastX: x, lastT: t, velocityX: 0 };
}

export function moveTouch(track: TouchTrack, x: number, y: number, t: number): TouchTrack {
  if (track.state === "rejected") return track;
  const dx = x - track.startX;
  const dy = y - track.startY;
  const elapsed = t - track.lastT;
  const instant = elapsed > 0 ? ((x - track.lastX) / elapsed) * 1000 : track.velocityX;
  const velocityX = track.velocityX === 0 ? instant : track.velocityX * 0.3 + instant * 0.7;
  let state: TouchState = track.state;
  if (state === "pending") {
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    if (ay > TOUCH.intentPx && ay > ax * TOUCH.rejectRatio) state = "rejected";
    else if (ax >= TOUCH.intentPx && ax > ay * TOUCH.claimRatio) state = "claimed";
  }
  return { ...track, state, dx, lastX: x, lastT: t, velocityX };
}

/** The direction of a fling at release, or 0 when the finger had settled. */
export function flingOf(track: TouchTrack, releaseT: number): -1 | 0 | 1 {
  if (releaseT - track.lastT > TOUCH.flingMaxIdleMs) return 0;
  if (track.velocityX >= TOUCH.flingPxPerSec) return 1;
  if (track.velocityX <= -TOUCH.flingPxPerSec) return -1;
  return 0;
}
