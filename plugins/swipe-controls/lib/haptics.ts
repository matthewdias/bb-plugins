// Haptic feedback, wherever bb can deliver it.
//
// - The bb iOS and Android apps inject `window.bb.native`, a bridge to the
//   shell. When its handshake lists the "haptic" capability, posting
//   `{ type: "haptic", kind }` plays the matching UIKit or Android pattern,
//   and the shell applies the user's own Haptics setting first. The message
//   shape is bb's (packages/mobile-bridge/src/messages.ts). It is not plugin
//   API, so everything is checked and a mismatch just plays nothing.
// - Android browsers have navigator.vibrate. It is only used for a coarse
//   pointer, so a desktop Chrome with the API and no motor is left alone.
// - Nothing else can. iOS Safari has no vibrate, and neither Chromium nor
//   bb's Electron shell exposes the trackpad's actuator, so there is no
//   desktop driver until bb grows one.

export type HapticKind =
  | "selection"
  | "impact-light"
  | "impact-medium"
  | "impact-heavy"
  | "success"
  | "warning"
  | "error";

export type HapticDriver = "native" | "vibrate" | null;

export interface Haptics {
  readonly driver: HapticDriver;
  play(kind: HapticKind): void;
}

interface NativeBridge {
  capabilities: readonly unknown[];
  post(message: unknown): void;
}

function nativeBridge(win: Window): NativeBridge | null {
  const bb = (win as { bb?: unknown }).bb;
  if (typeof bb !== "object" || bb === null) return null;
  const native = (bb as { native?: unknown }).native;
  if (typeof native !== "object" || native === null) return null;
  const { capabilities, post } = native as { capabilities?: unknown; post?: unknown };
  if (!Array.isArray(capabilities) || typeof post !== "function") return null;
  if (!capabilities.includes("haptic")) return null;
  return native as NativeBridge;
}

/** Milliseconds, or an on/off pattern, per kind. Short: a tick, not a buzz. */
const VIBRATION: Record<HapticKind, number | number[]> = {
  selection: 8,
  "impact-light": 10,
  "impact-medium": 15,
  "impact-heavy": 25,
  success: [10, 40, 10],
  warning: [20, 60, 20],
  error: [30, 60, 30, 60, 30],
};

function canVibrate(win: Window): boolean {
  const vibrate = (win.navigator as { vibrate?: unknown }).vibrate;
  return typeof vibrate === "function" && win.matchMedia?.("(pointer: coarse)").matches === true;
}

export function createHaptics(win: Window = window): Haptics {
  const native = nativeBridge(win);
  if (native !== null) {
    return {
      driver: "native",
      play(kind) {
        try {
          native.post({ type: "haptic", kind });
        } catch {
          // A navigation can tear the bridge down mid-call. A lost tick is fine.
        }
      },
    };
  }
  if (canVibrate(win)) {
    return {
      driver: "vibrate",
      play(kind) {
        try {
          win.navigator.vibrate(VIBRATION[kind]);
        } catch {
          // Blocked before the first user activation. Nothing to do.
        }
      },
    };
  }
  return { driver: null, play() {} };
}
