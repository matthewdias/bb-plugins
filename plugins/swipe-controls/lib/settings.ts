// The plugin's settings: declared once here, read by server.ts to define
// them and by the overlay to parse what bb hands back.

import type { GestureSettings } from "./controller.ts";

export const BACK_FORWARD_OPTIONS = ["In the desktop app", "Always", "Never"] as const;
export type BackForwardOption = (typeof BACK_FORWARD_OPTIONS)[number];

export const SETTINGS = {
  rowSwipes: {
    type: "boolean",
    label: "Swipe sidebar threads",
    description:
      "Swipe a thread right to mark it read or unread. Swipe it left for Pin and Archive. Works with a finger on a phone and two fingers on a trackpad.",
    default: true,
  },
  rowLeftSwipe: {
    type: "boolean",
    label: "On a phone, swipe threads left",
    description:
      "bb closes its sidebar with a leftward swipe. When on, a leftward swipe that starts on a thread swipes the thread instead, and the sidebar closes from its header, from empty space or with a tap beside it. When off, threads only swipe right.",
    default: true,
  },
  fullSwipeArchive: {
    type: "boolean",
    label: "Swipe all the way left to archive",
    description:
      "A long leftward swipe archives the thread when you let go, and bb's toast offers Undo. When off, swiping left only shows the buttons.",
    default: true,
  },
  backForward: {
    type: "select",
    label: "Swipe with two fingers to go back and forward",
    description:
      "Over the page, not the sidebar. Browsers already do this themselves, so by default it is on only in bb's desktop app.",
    options: [...BACK_FORWARD_OPTIONS],
    default: "In the desktop app",
  },
  haptics: {
    type: "boolean",
    label: "Haptic feedback",
    description:
      "A tick as a swipe reaches the point where letting go acts, in bb's iOS and Android apps and in Android browsers. The app's own Haptics setting still applies. Trackpads can't play haptics from bb.",
    default: true,
  },
} as const;

export type SettingValues = Record<string, string | number | boolean> | undefined;

function flag(values: SettingValues, key: keyof typeof SETTINGS, fallback: boolean): boolean {
  const value = values?.[key];
  return typeof value === "boolean" ? value : fallback;
}

/** Whether this window is bb's desktop app, which injects `window.bbDesktop`. */
export function isDesktopApp(win: Window): boolean {
  const desktop = (win as { bbDesktop?: unknown }).bbDesktop;
  return typeof desktop === "object" && desktop !== null;
}

export function backForwardEnabled(option: unknown, desktopApp: boolean): boolean {
  if (option === "Always") return true;
  if (option === "Never") return false;
  return desktopApp;
}

export function parseGestureSettings(values: SettingValues, desktopApp: boolean): GestureSettings {
  return {
    rowSwipes: flag(values, "rowSwipes", true),
    rowLeftSwipe: flag(values, "rowLeftSwipe", true),
    fullSwipeArchive: flag(values, "fullSwipeArchive", true),
    backForward: backForwardEnabled(values?.backForward ?? SETTINGS.backForward.default, desktopApp),
  };
}

export function hapticsEnabled(values: SettingValues): boolean {
  return flag(values, "haptics", true);
}
