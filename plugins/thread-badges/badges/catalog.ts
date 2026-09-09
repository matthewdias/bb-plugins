// What badge types exist, as data.
//
// Kept free of React so the backend can read it too: the settings a badge type
// contributes are derived from this catalog rather than written out twice.
// Adding a type is an entry here plus a component in ./components.tsx.

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
    id: "followUps",
    name: "follow-ups",
    description:
      "A ring showing how much of this thread's follow-up list is done. Needs the Follow-ups plugin.",
    defaultEnabled: true,
    settings: [
      {
        key: "followUps_showOpenCount",
        label: "Follow-ups: show how many are still open",
        default: false,
      },
      {
        key: "followUps_hideWhenComplete",
        label: "Follow-ups: hide the ring once every follow-up is done",
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
/** Above this the cap stops meaning anything: every type could show at once. */
export const MAX_BADGES_LIMIT = BADGE_TYPES.length;

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

function priorityOf(values: BadgeSettings | undefined, id: string): number {
  const value = values?.[priorityKey(id)];
  return typeof value === "number" && Number.isFinite(value) ? value : defaultPriority(id);
}

/**
 * The enabled badge types, most wanted first.
 *
 * This is the whole of "which badge wins": a row renders them in this order
 * and the cap hides whatever falls past it, so the badge dropped from a busy
 * row is the last one here. Ties keep catalog order, which is what makes a
 * half-configured set of priorities stable rather than arbitrary.
 */
export function orderedBadgeTypes(values: BadgeSettings | undefined): readonly BadgeType[] {
  return BADGE_TYPES.filter((type) => isEnabled(values, type.id))
    .map((type, index) => ({ index, priority: priorityOf(values, type.id), type }))
    .sort((a, b) => a.priority - b.priority || a.index - b.index)
    .map((entry) => entry.type);
}

export function isEnabled(values: BadgeSettings | undefined, id: string): boolean {
  const value = values?.[enabledKey(id)];
  // Absent means the settings have not loaded yet; fall back to the catalog.
  if (value === undefined) {
    return BADGE_TYPES.find((type) => type.id === id)?.defaultEnabled ?? false;
  }
  return value === true;
}
