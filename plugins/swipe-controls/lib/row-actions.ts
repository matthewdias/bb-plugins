// What a swiped row offers.
//
// Its buttons are the actions the user picked for bb's thread rows, under the
// thread list's Customize row actions. That choice is the thread-list
// plugin's `rowActions` preference: up to three thread action keys,
// `<owner>/<id>`, left to right. bb shows them on a row's hover, which a
// phone never has. Its two whole swipes, right and all the way left, are
// Swipe Controls' own settings, each any one of bb's thread actions.
//
// bb evaluates each action for a thread: its label, its icon, whether it
// applies, and what running it does. Here:
// - a swipe right runs its action on release, as Mail's does;
// - the row actions are the buttons a leftward swipe uncovers, in the same
//   order, bb's own and other plugins' alike, less the one a swipe right
//   already runs, except that the full swipe's own button goes outermost, at
//   the edge its swipe comes from, as Mail's Archive does;
// - a swipe all the way left runs its action, whether or not it is one of
//   the buttons;
// - an action that asks a further question (Move to section's list of
//   sections) is left out: a swiped row has nowhere to ask it.
//
// Pure: the overlay reads the preference and the settings and has bb
// evaluate them, the controller builds rows from what this returns.

import type { ZodType } from "zod";
import * as z from "zod/mini";

/** bb's own thread actions that a swipe treats specially. */
export const READ = "bb--core/read";
export const ARCHIVE = "bb--core/archive";

/** bb's own limit on row actions. */
export const MAX_ROW_ACTIONS = 3;

/**
 * What a row offers when the thread list can't be asked: it is turned off, or
 * replaced by another list, or hasn't answered yet. The set Swipe Controls
 * offered before it followed the preference.
 */
export const FALLBACK_ROW_ACTIONS: readonly string[] = [READ, "bb--core/pin", ARCHIVE];

/** The thread-list plugin, and its RPC that lists every preference. */
export const THREAD_LIST = { pluginId: "thread-list", method: "listPreferences" } as const;

/** The names the preference held before bb 0.46 gave thread actions keys. */
const LEGACY_KEYS: Readonly<Record<string, string>> = {
  split: "bb--core/split",
  copyLink: "bb--core/copyLink",
  read: READ,
  pin: "bb--core/pin",
  move: "thread-list/move",
  rename: "bb--core/rename",
  archive: ARCHIVE,
};

const KEY = /^[^/\s]+\/[^/\s]+$/;

function keyOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const key = Object.hasOwn(LEGACY_KEYS, value)
    ? LEGACY_KEYS[value]!
    : value.startsWith("core/")
      ? `bb--${value}`
      : value;
  return KEY.test(key) ? key : null;
}

/**
 * The preference as the thread list stores it, read as it reads it: old names
 * turned into keys, anything that isn't a key dropped, repeats dropped, at
 * most three.
 */
const rowActionsSchema = z.pipe(
  z.array(z.unknown()),
  z.transform((values): string[] => {
    const keys = values.flatMap((value) => keyOf(value) ?? []);
    return [...new Set(keys)].slice(0, MAX_ROW_ACTIONS);
  }),
);

/**
 * `listPreferences`'s result, down to `rowActions`.
 *
 * `callRpc` is typed for classic Zod, but only parses with the schema. Zod
 * Mini's schemas parse the same way, and keep zod's 190 KB out of an app
 * bundle that is otherwise 23 KB.
 */
export const threadListPreferencesSchema = z.pipe(
  z.object({ preferences: z.object({ rowActions: rowActionsSchema }) }),
  z.transform((result) => result.preferences.rowActions),
) as unknown as ZodType<string[]>;

/** One thread action as bb evaluated it for a thread: what a swipe needs of the SDK's entry. */
export interface ThreadActionEntry {
  key: string;
  action: {
    label: string;
    icon: string;
    variant?: "default" | "destructive";
    disabled?: boolean;
    choices?: unknown;
    run(): unknown;
  };
}

export interface RowButton {
  key: string;
  /** What fits under the icon. */
  label: string;
  /** bb's own name for the action. */
  title: string;
  /** A bb icon name. */
  icon: string;
  destructive: boolean;
  disabled: boolean;
  run(): void;
}

export interface RowContent {
  /** What a swipe right runs; null when the row doesn't take one. */
  leading: RowButton | null;
  /** The buttons a swipe left uncovers. */
  trailing: RowButton[];
  /** What a swipe all the way left runs: one of the buttons, or an action of its own. Null for none. */
  full: RowButton | null;
}

/** Which actions a row offers, as thread action keys. */
export interface RowActionKeys {
  /** The user's row actions. */
  rowActions: readonly string[];
  /** A swipe right; null for none. */
  right: string | null;
  /** A swipe all the way left; null for none. */
  fullLeft: string | null;
}

/** Every key a row needs bb to evaluate. */
export function keysOf(keys: RowActionKeys): string[] {
  return [...new Set([...keys.rowActions, keys.right, keys.fullLeft].flatMap((key) => key ?? []))];
}

/** bb's names that don't fit a 72px button. */
const SHORT_LABELS: Readonly<Record<string, string>> = {
  "bb--core/split": "Split",
  "bb--core/copyLink": "Copy link",
};

/** What swiping a thread's row offers, from its actions as bb evaluated them. */
export function rowContent(
  entries: readonly ThreadActionEntry[],
  thread: { isUnread: boolean },
  keys: RowActionKeys,
): RowContent {
  const button = (entry: ThreadActionEntry): RowButton => ({
    key: entry.key,
    label: entry.key === READ ? (thread.isUnread ? "Read" : "Unread") : (SHORT_LABELS[entry.key] ?? entry.action.label),
    title: entry.action.label,
    icon: entry.action.icon,
    destructive: entry.action.variant === "destructive",
    disabled: entry.action.disabled === true,
    // bb contains an action's errors itself, as it does for its own menu.
    run: () => void entry.action.run(),
  });
  /** bb's evaluation of `key`, when the row can offer it. */
  const offered = (key: string | null) =>
    entries.find((entry) => entry.key === key && entry.action.choices === undefined);
  /** A whole swipe's action: one that can run now. */
  const swipe = (key: string | null) => {
    const entry = offered(key);
    return entry === undefined || entry.action.disabled === true ? null : button(entry);
  };

  const buttons = keys.rowActions
    .filter((key) => key !== keys.right)
    .flatMap((key) => offered(key) ?? [])
    .map(button);
  const own = buttons.find((candidate) => candidate.key === keys.fullLeft && !candidate.disabled);
  return {
    leading: swipe(keys.right),
    trailing: own === undefined ? buttons : [...buttons.filter((candidate) => candidate !== own), own],
    full: own ?? swipe(keys.fullLeft),
  };
}
