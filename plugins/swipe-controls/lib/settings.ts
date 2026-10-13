// The plugin's settings: declared once here, read by server.ts to define
// them and by the overlay to parse what bb hands back.

import type { GestureSettings } from "./controller.ts";

export const BACK_FORWARD_OPTIONS = ["In the desktop app", "Always", "Never"] as const;
export type BackForwardOption = (typeof BACK_FORWARD_OPTIONS)[number];

/**
 * What a whole swipe can run: bb's own thread actions, under the names bb
 * gives them, each with its thread action key. A setting's options are fixed
 * when the plugin loads, so another plugin's actions can't be listed here.
 */
export const SWIPE_ACTIONS = {
  "Mark read / unread": "bb--core/read",
  Pin: "bb--core/pin",
  Archive: "bb--core/archive",
  Rename: "bb--core/rename",
  "Open in split": "bb--core/split",
  "Copy thread link": "bb--core/copyLink",
  Delete: "bb--core/delete",
  Nothing: null,
} as const;
export type SwipeActionOption = keyof typeof SWIPE_ACTIONS;
export const SWIPE_ACTION_OPTIONS = Object.keys(SWIPE_ACTIONS) as SwipeActionOption[];

export const SETTINGS = {
  rowSwipes: {
    type: "boolean",
    label: "Swipe sidebar threads",
    description:
      "Swipe a thread right to act on it at once, and left for the row actions you picked in a row's Customize row actions. Works with a finger on a phone and two fingers on a trackpad.",
    default: true,
  },
  swipeRight: {
    type: "select",
    label: "Swipe right",
    description: "What swiping a thread right does when you let go. It doesn't have to be one of your row actions.",
    options: SWIPE_ACTION_OPTIONS,
    default: "Mark read / unread",
  },
  swipeLeftFull: {
    type: "select",
    label: "Swipe all the way left",
    description:
      "What a long leftward swipe does when you let go. It doesn't have to be one of your row actions. Archive shows bb's Undo toast. With Nothing, swiping left only shows the buttons.",
    options: SWIPE_ACTION_OPTIONS,
    default: "Archive",
  },
  rowLeftSwipe: {
    type: "boolean",
    label: "On a phone, swipe threads left",
    description:
      "bb closes its sidebar with a leftward swipe. When on, a leftward swipe that starts on a thread swipes the thread instead, and the sidebar closes from its header, from empty space or with a tap beside it. When off, threads only swipe right.",
    default: true,
  },
  hideRowActions: {
    type: "boolean",
    label: "Hide bb's row buttons",
    description:
      "bb shows your row actions as buttons on a thread when you point at it. A swipe offers the same ones, so this hides the buttons and leaves the title their room. The row's menu stays. Applies while thread swipes are on.",
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
    backForward: backForwardEnabled(values?.backForward ?? SETTINGS.backForward.default, desktopApp),
  };
}

/** The thread action key a swipe setting names; null for Nothing. An unknown value is the setting's default. */
function swipeAction(values: SettingValues, key: "swipeRight" | "swipeLeftFull"): string | null {
  const value = values?.[key];
  const option = typeof value === "string" && Object.hasOwn(SWIPE_ACTIONS, value) ? value : SETTINGS[key].default;
  return SWIPE_ACTIONS[option as SwipeActionOption];
}

/** The actions the two whole swipes run, as thread action keys. */
export interface SwipeActions {
  /** A swipe right; null for none. */
  right: string | null;
  /** A swipe all the way left; null for none. */
  fullLeft: string | null;
}

export function parseSwipeActions(values: SettingValues): SwipeActions {
  return { right: swipeAction(values, "swipeRight"), fullLeft: swipeAction(values, "swipeLeftFull") };
}

/** Whether bb's own row buttons are hidden: only while rows swipe. */
export function hidesRowActions(values: SettingValues): boolean {
  return flag(values, "rowSwipes", true) && flag(values, "hideRowActions", true);
}

export function hapticsEnabled(values: SettingValues): boolean {
  return flag(values, "haptics", true);
}
