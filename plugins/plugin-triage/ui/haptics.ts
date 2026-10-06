// Haptic feedback on phones.
//
// In bb's iOS and Android apps the page runs in a web view with a native
// bridge at `window.bb.native`, whose handshake lists what the app can do.
// When that includes "haptic", the app plays the kind asked for with the
// platform's own feedback, and honours the app's haptics setting. The kinds
// and the message are the app's (packages/mobile-bridge/src/messages.ts in
// get-bb/bb). In a phone's browser, Android vibrates instead; iOS Safari has
// no web API for this, so it stays silent.

export type HapticKind =
  | "selection"
  | "impact-light"
  | "impact-medium"
  | "impact-heavy"
  | "success"
  | "warning"
  | "error";

/** Vibration patterns (ms) approximating each kind, for browsers. */
const PATTERNS: Record<HapticKind, number | number[]> = {
  selection: 8,
  "impact-light": 12,
  "impact-medium": 18,
  "impact-heavy": 28,
  success: [12, 60, 12],
  warning: [20, 80, 20],
  error: [30, 60, 30, 60, 30],
};

interface NativeBridge {
  capabilities?: unknown;
  post(message: unknown): void;
}

function nativeBridge(win: Window): NativeBridge | null {
  const native = (win as Window & { bb?: { native?: unknown } }).bb?.native;
  if (typeof native !== "object" || native === null) return null;
  const bridge = native as Partial<NativeBridge>;
  if (typeof bridge.post !== "function") return null;
  if (!Array.isArray(bridge.capabilities) || !bridge.capabilities.includes("haptic")) return null;
  return bridge as NativeBridge;
}

export function haptic(kind: HapticKind, win: Window | undefined = typeof window === "undefined" ? undefined : window): void {
  if (win === undefined) return;
  try {
    const bridge = nativeBridge(win);
    if (bridge !== null) {
      bridge.post({ type: "haptic", kind });
      return;
    }
    // Only on a touchscreen: a desktop browser that happens to implement
    // vibrate has nothing to vibrate, and a key press there wants no buzz.
    const touch = win.matchMedia?.("(pointer: coarse)").matches === true;
    if (touch && typeof win.navigator.vibrate === "function") win.navigator.vibrate(PATTERNS[kind]);
  } catch {
    // Feedback is a nicety; never let it break the gesture it accompanies.
  }
}
