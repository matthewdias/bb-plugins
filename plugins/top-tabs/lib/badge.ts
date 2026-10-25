// What a destination's badge draws on its tab.
//
// A panel sets its badge as a value (`experimental_useBadge`), and bb hands
// it over with the destination: a count, a short text, or neither, which
// means a dot. Tabs are drawn as bb draws lists, so a count caps at 99+.
import type { ExperimentalBadge } from "@get-bb/plugin-sdk/app";

export type BadgeMark =
  | { kind: "count"; text: string }
  | { kind: "text"; text: string }
  | { kind: "dot" };

const COUNT_CAP = 99;
/** bb's own limit for a badge's text. */
const TEXT_LIMIT = 8;

export function badgeMark(badge: Pick<ExperimentalBadge, "count" | "text">): BadgeMark {
  const { count, text } = badge;
  if (typeof count === "number" && Number.isInteger(count) && count > 0) {
    return { kind: "count", text: count > COUNT_CAP ? `${COUNT_CAP}+` : String(count) };
  }
  if (typeof text === "string" && text.trim() !== "") {
    return { kind: "text", text: text.trim().slice(0, TEXT_LIMIT) };
  }
  return { kind: "dot" };
}

/** A tab's accessible name: its label, and the badge's when one is drawn. */
export function tabName(label: string, badge: Pick<ExperimentalBadge, "label"> | null): string {
  return badge === null || badge.label.trim() === "" ? label : `${label}, ${badge.label.trim()}`;
}
