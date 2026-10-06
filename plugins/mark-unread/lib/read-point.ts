// The read point and the timeline's row ids, without the DOM.
//
// bb wraps every timeline row in `[data-timeline-row-id]`, and for a message
// that id is the same string a `messageAction` receives as `message.id`. The
// id is private to bb, so everything here that reads its shape is a guess at a
// format bb does not promise, kept in one place so a change breaks one file.
// Verified against bb 0.45.0:
//
//   <thread>:user-seed:<seq>                         a message you sent
//   <thread>:assistant:kind:assistant|turn:<turn>|…   an agent message
//   <thread>:<turn>:turn…, <thread>:<turn>:work-summary…  a turn's summary row
import type { ReadPoint } from "./schema";

export type { ReadPoint };

/** Realtime channel: a thread's read point was set or cleared. */
export const POINT_CHANGED = "point-changed";

export type MessageRole = ReadPoint["role"];

export type RowKind = MessageRole | "other";

export interface ParsedRowId {
  threadId: string;
  kind: RowKind;
  /** Known only for messages you sent. */
  seq: number | null;
  /** The turn an agent message or summary row belongs to, when the id says. */
  turnId: string | null;
}

const USER_SEED = /^user-seed:(\d+)$/;
const ASSISTANT_TURN = /(?:^|\|)turn:([^|]+)/;
const SUMMARY_ROW = /^([^:]+):(?:turn|work-summary)(?::|$)/;

export function parseRowId(id: string): ParsedRowId | null {
  const colon = id.indexOf(":");
  if (colon <= 0) return null;
  const threadId = id.slice(0, colon);
  const rest = id.slice(colon + 1);
  const user = USER_SEED.exec(rest);
  if (user) return { threadId, kind: "user", seq: Number(user[1]), turnId: null };
  if (rest.startsWith("assistant:")) {
    return { threadId, kind: "assistant", seq: null, turnId: ASSISTANT_TURN.exec(rest)?.[1] ?? null };
  }
  return { threadId, kind: "other", seq: null, turnId: SUMMARY_ROW.exec(rest)?.[1] ?? null };
}

/**
 * The row ids a turn collapses into once it finishes. An agent message written
 * mid-turn is its own row while the turn runs, then folds into the turn's
 * "Worked for…" row, so a point set on one has to fall back to that.
 */
export function turnRowPrefix(threadId: string, turnId: string): string {
  return `${threadId}:${turnId}:`;
}

/** A point counts as seen by a visit to its thread that began after it was set. */
export function seenDuringVisit(point: Pick<ReadPoint, "setAt">, visitStartedAt: number): boolean {
  return visitStartedAt > point.setAt;
}

// ---------------------------------------------------------------------------
// The click modifier

/** Setting values, shown to the user as they are. */
export const MODIFIER_OPTIONS = ["Option", "Command", "Shift", "Off"] as const;
export type ModifierSetting = (typeof MODIFIER_OPTIONS)[number];
export const DEFAULT_MODIFIER: ModifierSetting = "Option";

export function parseModifier(value: unknown): ModifierSetting {
  return (MODIFIER_OPTIONS as readonly unknown[]).includes(value) ? (value as ModifierSetting) : DEFAULT_MODIFIER;
}

export interface ModifierState {
  altKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}

/**
 * Exactly the chosen modifier and no other, so Option+Shift-click and the
 * like stay free for whatever else wants them. Control is never offered: on a
 * Mac, Control-click is a right-click and never arrives as a click.
 */
export function modifierMatches(setting: ModifierSetting, event: ModifierState): boolean {
  const held = {
    Option: event.altKey,
    Command: event.metaKey,
    Shift: event.shiftKey,
  };
  if (setting === "Off" || event.ctrlKey) return false;
  return Object.entries(held).every(([name, down]) => down === (name === setting));
}
