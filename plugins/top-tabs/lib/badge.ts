// What a destination's badge draws on its tab.
//
// A panel sets its badge as a value (`experimental_useBadge`), and bb hands
// it over with the destination: a count, a short text, or neither, which
// means a dot. Tab Nav draws it as bb does: in the narrow rail a count caps
// at 9+ and text becomes a dot, as on bb's own Rail; with names showing, as
// in bb's lists, a count caps at 99+ and text is drawn.
import type { ExperimentalBadge } from "@get-bb/plugin-sdk/app";

export type BadgeMark =
  | { kind: "count"; text: string }
  | { kind: "text"; text: string }
  | { kind: "dot" };

/** Where a badge is drawn: on a rail icon, or beside a name. */
export type BadgeSize = "rail" | "list";

/** bb's caps: 9+ on its Rail, 99+ in its lists. */
const COUNT_CAP: Record<BadgeSize, number> = { rail: 9, list: 99 };
/** bb's own limit for a badge's text. */
const TEXT_LIMIT = 8;

export function badgeMark(badge: Pick<ExperimentalBadge, "count" | "text">, size: BadgeSize): BadgeMark {
  const { count, text } = badge;
  if (typeof count === "number" && Number.isInteger(count) && count > 0) {
    const cap = COUNT_CAP[size];
    return { kind: "count", text: count > cap ? `${cap}+` : String(count) };
  }
  if (size === "list" && typeof text === "string" && text.trim() !== "") {
    return { kind: "text", text: text.trim().slice(0, TEXT_LIMIT) };
  }
  return { kind: "dot" };
}

/** A tab's accessible name: its label, and the badge's when one is drawn. */
export function tabName(label: string, badge: Pick<ExperimentalBadge, "label"> | null): string {
  return badge === null || badge.label.trim() === "" ? label : `${label}, ${badge.label.trim()}`;
}
