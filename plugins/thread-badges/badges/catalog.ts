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

export function isEnabled(values: BadgeSettings | undefined, id: string): boolean {
  const value = values?.[enabledKey(id)];
  // Absent means the settings have not loaded yet; fall back to the catalog.
  if (value === undefined) {
    return BADGE_TYPES.find((type) => type.id === id)?.defaultEnabled ?? false;
  }
  return value === true;
}
