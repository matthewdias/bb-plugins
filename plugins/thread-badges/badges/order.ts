// Which badges a row draws, in what order: the built-in types and the
// complications other plugins provide, on one priority scale.
//
// This is the whole of "which badge wins". A row renders these in order and
// the cap hides whatever falls past it, so the entry dropped from a busy row is
// the last one here.
import {
  BADGE_TYPES,
  isEnabled,
  priorityOf,
  type BadgeSettings,
  type BadgeType,
} from "./catalog";
import { prefsFor, type ComplicationPrefs, type ComplicationPrefsMap } from "./complication-prefs";

export type RowEntry =
  | { kind: "builtin"; key: string; type: BadgeType }
  | { kind: "complication"; key: string; id: string; prefs: ComplicationPrefs };

/**
 * Enabled built-ins and enabled complications whose provider is live, lowest
 * priority first. A complication whose plugin is not running has nothing to
 * draw, so it is left out rather than asked for.
 *
 * Ties go to the built-ins, then to catalog or discovery order, so a set of
 * priorities nobody has touched still draws a stable row.
 */
export function orderedEntries(
  values: BadgeSettings | undefined,
  providerIds: readonly string[],
  prefs: ComplicationPrefsMap,
): readonly RowEntry[] {
  const builtins = BADGE_TYPES.filter((type) => isEnabled(values, type.id)).map(
    (type, index) => ({
      entry: { kind: "builtin", key: `builtin:${type.id}`, type } as RowEntry,
      priority: priorityOf(values, type.id),
      group: 0,
      index,
    }),
  );
  const complications = providerIds
    .map((id, index) => ({ id, index, prefs: prefsFor(prefs, id) }))
    .filter(({ prefs: entry }) => entry.enabled)
    .map(({ id, index, prefs: entry }) => ({
      entry: { kind: "complication", key: `complication:${id}`, id, prefs: entry } as RowEntry,
      priority: entry.priority,
      group: 1,
      index,
    }));
  return [...builtins, ...complications]
    .sort((a, b) => a.priority - b.priority || a.group - b.group || a.index - b.index)
    .map(({ entry }) => entry);
}
