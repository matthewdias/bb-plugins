// What badge types exist, as data.
//
// Kept free of React so the backend can read it too: the settings a badge type
// contributes are derived from this catalog rather than written out twice.
// Adding a type is an entry here plus a component in ./components.tsx.
//
// These are the badges this plugin computes itself. Anything another plugin
// publishes as a complication — Follow Up's progress ring, for one — is not
// listed here: it is discovered in the app and drawn by ./complication-badge,
// with its settings in ./complication-prefs.

export interface BadgeSetting {
  /** Unique across the plugin; prefix it with the badge id. */
  key: string;
  label: string;
  default: boolean;
}

export interface BadgeType {
  /** Stable id. Also names the switch that turns this badge on. */
  id: string;
  name: string;
  /** Shown under the switch in Settings. */
  description: string;
  defaultEnabled: boolean;
  /** Extra switches this badge owns. Booleans only, for now. */
  settings: readonly BadgeSetting[];
}

/** The switch that turns a badge type on. */
export function enabledKey(id: string): string {
  return `show_${id}`;
}

/** The number that decides which enabled badges get the visible slots. */
export function priorityKey(id: string): string {
  return `${id}_priority`;
}

export const BADGE_TYPES: readonly BadgeType[] = [
  {
    id: "pullRequest",
    name: "pull requests",
    description:
      "The state of the pull request on this thread's branch: open, draft, merged, or closed.",
    defaultEnabled: true,
    settings: [
      {
        key: "pullRequest_showNumber",
        label: "Pull requests: show the number beside the glyph",
        default: false,
      },
      {
        key: "pullRequest_onlyOpen",
        label: "Pull requests: hide merged and closed ones",
        default: false,
      },
    ],
  },
  {
    id: "prChecks",
    name: "pull request checks",
    description:
      "Whether this thread's pull request wants something from you: checks running or failed, conflicts, a review, or a block on merging.",
    defaultEnabled: true,
    settings: [
      {
        key: "prChecks_showReady",
        label: "PR checks: keep a tick on pull requests that are ready to merge",
        default: false,
      },
      {
        key: "prChecks_onlyProblems",
        label: "PR checks: only show problems, not checks running or reviews requested",
        default: false,
      },
    ],
  },
  {
    id: "ports",
    name: "ports",
    description:
      "A plug on threads whose worktree is serving something. Needs the Worktree " +
      "Ports plugin. Off by default: the cap below is two badges and this one " +
      "sorts last, so turning it on means raising the cap or lowering its priority.",
    // The only badge that ships off. Not because it is less useful than the
    // others, but because switching it on cannot be the whole gesture: at the
    // shipped cap of two it would sort past the last slot and draw nothing, so
    // an on-by-default switch would be a switch that does nothing. Off, it asks
    // the one question — "is this worth a slot?" — that it actually needs
    // answered, and the store makes that literal: a badge switched off never
    // subscribes, so an untouched install never polls for ports at all.
    defaultEnabled: false,
    settings: [
      {
        key: "ports_appsOnly",
        label: "Ports: ignore backing services and internal listeners",
        default: true,
      },
      {
        key: "ports_showNumber",
        label: "Ports: show the port number beside the glyph",
        default: false,
      },
    ],
  },
];

export type BadgeSettings = Readonly<Record<string, string | number | boolean>>;

/**
 * How many badges a row draws before the rest are dropped.
 *
 * A sidebar row is ~260px wide and already holds a title, a preview line and
 * the sidebar's own trailing controls; at ~14px a badge, three is busy and
 * four starts truncating titles. So the cap ships at two and the priorities
 * below decide which two, rather than the row quietly getting narrower as
 * badge types are added.
 */
export const MAX_BADGES_KEY = "max_badges";
export const DEFAULT_MAX_BADGES = 2;
/**
 * The highest cap you can set. Not the number of badge types: complications
 * from other plugins are badge types too, and how many exist is only known in
 * the app. Six is already more than a row has room for.
 */
export const MAX_BADGES_LIMIT = 6;

/** Its catalog position, so untouched settings keep the order written here. */
export function defaultPriority(id: string): number {
  const index = BADGE_TYPES.findIndex((type) => type.id === id);
  return (index === -1 ? BADGE_TYPES.length : index) + 1;
}

export function maxBadges(values: BadgeSettings | undefined): number {
  const value = values?.[MAX_BADGES_KEY];
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_MAX_BADGES;
  // Clamped rather than rejected: a stored 0 or 99 should still draw a
  // sensible row, and settings can be written from outside this plugin.
  return Math.min(Math.max(Math.round(value), 1), MAX_BADGES_LIMIT);
}

export function priorityOf(values: BadgeSettings | undefined, id: string): number {
  const value = values?.[priorityKey(id)];
  return typeof value === "number" && Number.isFinite(value) ? value : defaultPriority(id);
}

export function isEnabled(values: BadgeSettings | undefined, id: string): boolean {
  const value = values?.[enabledKey(id)];
  // Absent means the settings have not loaded yet; fall back to the catalog.
  if (value === undefined) {
    return BADGE_TYPES.find((type) => type.id === id)?.defaultEnabled ?? false;
  }
  return value === true;
}
