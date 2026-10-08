// The providers you have hidden from the card, shared by the backend that
// stores the list and the app that reads it.
//
// A list in this plugin's own storage behind an RPC, not a bb setting: bb's
// settings are declared when the backend loads, and providers are discovered
// later, in the app, when each plugin's bundle registers one. Thread Badges
// keeps its per-complication settings the same way.

/** The realtime signal the backend sends after a write, to every window. */
export const HIDDEN_CHANGED = "hidden-providers-changed";

/** The declarative setting for the header's chips. */
export const SHOW_CHIPS_KEY = "showChips";

/**
 * `<pluginId>/<name>` — the registry's own rule, repeated because the vendored
 * registry does not export it and must not change.
 */
export const COMPLICATION_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Far above any real install; a misbehaving caller cannot grow the list without limit. */
export const MAX_HIDDEN = 200;

/** The stored list, keeping only well-formed ids, each once, in order. */
export function normalizeHidden(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  for (const id of raw) {
    if (typeof id === "string" && COMPLICATION_ID.test(id)) seen.add(id);
  }
  return [...seen];
}

/** The list after hiding or showing one provider. */
export function withHidden(list: readonly string[], id: string, hidden: boolean): string[] {
  const rest = list.filter((entry) => entry !== id);
  return hidden ? [...rest, id] : rest;
}
