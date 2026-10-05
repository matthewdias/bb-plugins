// How a complication from another plugin is drawn on a row: whether at all,
// where in the order, and its two options.
//
// Kept free of React because both halves read it: the backend stores these and
// the app draws with them. They live in the plugin's own storage behind an RPC
// rather than in bb's settings because bb's settings are declared when the
// backend loads, and a complication's provider is only discovered later, in
// the app, when that plugin's bundle registers it.
import { BADGE_TYPES } from "./catalog";

export interface ComplicationPrefs {
  /** Off until you turn it on: installing a plugin does not change your rows. */
  enabled: boolean;
  /** Same scale as the built-in badges' priorities; lower goes first. */
  priority: number;
  /** Draw the value's `text` beside its glyph or ring. */
  showText: boolean;
  /** Draw nothing once a gauge is full. Gauges only. */
  hideWhenComplete: boolean;
}

export type ComplicationPrefsMap = Readonly<Record<string, ComplicationPrefs>>;

/** The realtime signal the backend sends after a write, to every window. */
export const PREFS_CHANGED = "complication-prefs-changed";

/**
 * `<pluginId>/<name>` — the registry's own rule, repeated because the vendored
 * registry module does not export it, and this file must not touch that one.
 */
export const COMPLICATION_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * How many complications may hold settings. Far above any real install; the
 * point is that a misbehaving caller cannot grow the stored map without limit.
 */
export const MAX_STORED_PREFS = 200;

/**
 * Just after the built-in badges, so turning one on adds it to the end of the
 * row rather than displacing a badge you already see.
 */
export const DEFAULT_COMPLICATION_PRIORITY = BADGE_TYPES.length + 1;

export function defaultPrefs(): ComplicationPrefs {
  return {
    enabled: false,
    priority: DEFAULT_COMPLICATION_PRIORITY,
    showText: false,
    hideWhenComplete: false,
  };
}

/** A stored entry, field by field: anything missing or malformed takes its default. */
export function normalizePrefs(raw: unknown): ComplicationPrefs {
  const fallback = defaultPrefs();
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return fallback;
  const value = raw as Record<string, unknown>;
  const flag = (key: keyof ComplicationPrefs): boolean =>
    typeof value[key] === "boolean" ? (value[key] as boolean) : (fallback[key] as boolean);
  return {
    enabled: flag("enabled"),
    priority:
      typeof value.priority === "number" && Number.isFinite(value.priority)
        ? value.priority
        : fallback.priority,
    showText: flag("showText"),
    hideWhenComplete: flag("hideWhenComplete"),
  };
}

/** The whole stored map, keeping only well-formed ids. */
export function normalizePrefsMap(raw: unknown): Record<string, ComplicationPrefs> {
  const map: Record<string, ComplicationPrefs> = {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return map;
  for (const [id, entry] of Object.entries(raw)) {
    if (COMPLICATION_ID.test(id)) map[id] = normalizePrefs(entry);
  }
  return map;
}

/** One complication's settings, defaults included when it has none stored. */
export function prefsFor(map: ComplicationPrefsMap, id: string): ComplicationPrefs {
  return Object.prototype.hasOwnProperty.call(map, id) ? map[id] : defaultPrefs();
}
