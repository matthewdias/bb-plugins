// Back and forward, as bb's own header buttons do them.
//
// bb's buttons call its router's navigate(-1) / navigate(1), which is
// history.go on the same session history this uses, so a swipe and a click
// land in the same place.

export type HistoryDirection = "back" | "forward";

export const BACK_FORWARD = {
  /** Summed wheel travel that commits. */
  commitPx: 140,
  /**
   * After a swipe goes back or forward, sideways movement is the same swipe
   * until the trackpad has been quiet this long. Chromium doesn't say when
   * fingers lift, so a hand held on the trackpad and moved again after a
   * pause looks like a new swipe. Without this, it went again.
   */
  releaseQuietMs: 250,
} as const;

/** Fingers moving right scroll content left (negative deltaX): that is back. */
export function directionOf(x: number): HistoryDirection {
  return x < 0 ? "back" : "forward";
}

export function progressOf(x: number): number {
  return Math.min(1, Math.abs(x) / BACK_FORWARD.commitPx);
}

interface NavigationLike {
  canGoBack?: unknown;
  canGoForward?: unknown;
}

/**
 * Whether there is anywhere to go. The Navigation API answers in Chromium,
 * which includes the desktop app. Where it is missing, assume yes: going
 * nowhere is harmless.
 */
export function canGo(direction: HistoryDirection, win: Window = window): boolean {
  const navigation = (win as { navigation?: NavigationLike }).navigation;
  const answer = direction === "back" ? navigation?.canGoBack : navigation?.canGoForward;
  return typeof answer === "boolean" ? answer : true;
}

export function go(direction: HistoryDirection, win: Window = window): void {
  if (direction === "back") win.history.back();
  else win.history.forward();
}
