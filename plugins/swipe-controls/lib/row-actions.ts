// Which actions a swiped row offers: the ones the user picked for bb's thread
// rows, under the thread list's Customize row actions.
//
// That choice is the thread-list plugin's `rowActions` preference: up to three
// thread action keys, `<owner>/<id>`, left to right. bb shows them on a row's
// hover, which a phone never has. bb evaluates each for a thread: its label,
// its icon, whether it applies, and what running it does. Here:
// - Mark read is the rightward swipe, as in Mail, not a button;
// - the rest are the buttons a leftward swipe uncovers, in the same order,
//   bb's own and other plugins' alike;
// - an action that asks a further question (Move to section's list of
//   sections) is left out: a swiped row has nowhere to ask it;
// - a full swipe archives only when Archive is one of the buttons.
//
// Pure: the overlay reads the preference and has bb evaluate it, the
// controller builds rows from what this returns.

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
  /** The rightward swipe; null when the row doesn't take one. */
  leading: { label: string; icon: string; run(): void } | null;
  trailing: RowButton[];
  /** What a full leftward swipe runs: Archive, when it is one of the buttons. */
  archive: RowButton | null;
}

/** bb's names that don't fit a 72px button. */
const SHORT_LABELS: Readonly<Record<string, string>> = {
  "bb--core/split": "Split",
  "bb--core/copyLink": "Copy link",
};

/** What swiping a thread's row offers, from its row actions as bb evaluated them. */
export function rowContent(entries: readonly ThreadActionEntry[], thread: { isUnread: boolean }): RowContent {
  const run = (entry: ThreadActionEntry) => () => {
    // bb contains an action's errors itself, as it does for its own menu.
    void entry.action.run();
  };
  const read = entries.find((entry) => entry.key === READ && entry.action.disabled !== true);
  const trailing = entries
    .filter((entry) => entry.key !== READ && entry.action.choices === undefined)
    .map(
      (entry): RowButton => ({
        key: entry.key,
        label: SHORT_LABELS[entry.key] ?? entry.action.label,
        title: entry.action.label,
        icon: entry.action.icon,
        destructive: entry.action.variant === "destructive",
        disabled: entry.action.disabled === true,
        run: run(entry),
      }),
    );
  return {
    leading:
      read === undefined
        ? null
        : { label: thread.isUnread ? "Read" : "Unread", icon: read.action.icon, run: run(read) },
    trailing,
    archive: trailing.find((button) => button.key === ARCHIVE && !button.disabled) ?? null,
  };
}
