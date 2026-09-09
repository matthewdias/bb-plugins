// The pull-request checks badge.
//
// Same source as the pull-request badge — bb's own
// `experimental_useSidebarThreadPullRequest` — but a different field. `state`
// says what the pull request *is*; `attention` says whether it wants
// something from you, already rolled up by the host from checks, reviews and
// mergeability. That roll-up is why this needs no git-host integration of its
// own: it arrives with every pull request and was, until now, only in a
// tooltip.
//
// It is a separate badge type rather than a colour on the other one because
// colour there tracks state (GitHub's green/purple/red), which the reader
// already knows. Two glyphs say two things; one glyph saying both says
// neither.
//
// Calling the same hook as the pull-request badge costs nothing extra. bb
// backs it with a TanStack query keyed by *environment id*, so both badges —
// and every other row on the same environment — are observers on one lookup.
// The same query polls every 30s while an open pull request has checks
// pending and refetches on window focus, so this badge is live and can ignore
// `revision`.
import {
  experimental_useSidebarThreadPullRequest,
  type PluginSidebarPullRequest,
} from "@get-bb/plugin-sdk/app";
import { Icon, type IconName } from "@/components/ui/icon";
import type { BadgeProps } from "./components";

type Attention = PluginSidebarPullRequest["attention"];

interface Signal {
  icon: IconName;
  color: keyof typeof COLORS;
  label: string;
}

const COLORS = {
  amber: "light-dark(#9a6700, #d29922)",
  blue: "light-dark(#0969da, #4493f8)",
  green: "light-dark(#1a7f37, #3fb950)",
  red: "var(--destructive)",
} as const;

/**
 * The attention values worth drawing. The four missing ones — `none`,
 * `draft`, `merged`, `closed` — only repeat `state`, which the pull-request
 * badge already draws; echoing them would put the same fact on the row twice.
 */
const SIGNALS = {
  blocked: { icon: "Lock", color: "amber", label: "Merge blocked" },
  changes_requested: {
    icon: "MessageSquare",
    color: "amber",
    label: "Changes requested",
  },
  checks_failed: { icon: "CircleX", color: "red", label: "Checks failed" },
  checks_pending: { icon: "Clock", color: "amber", label: "Checks running" },
  conflicts: { icon: "AlertTriangle", color: "red", label: "Merge conflicts" },
  ready_to_merge: {
    icon: "CircleCheck",
    color: "green",
    label: "Ready to merge",
  },
  review_requested: { icon: "Eye", color: "blue", label: "Review requested" },
} as const satisfies Partial<Record<Attention, Signal>>;

type SignalName = keyof typeof SIGNALS;

/** Something is wrong and a person has to fix it — not merely in progress. */
const PROBLEMS: ReadonlySet<string> = new Set([
  "blocked",
  "changes_requested",
  "checks_failed",
  "conflicts",
]);

function signalFor(
  pullRequest: PluginSidebarPullRequest,
  values: BadgeProps["values"],
): SignalName | null {
  const attention = pullRequest.attention;
  if (!(attention in SIGNALS)) return null;
  const signal = attention as SignalName;
  // Off by default: on a healthy pull request this one never clears, so it
  // would sit on the row for the whole life of the branch.
  if (signal === "ready_to_merge" && values.prChecks_showReady !== true) {
    return null;
  }
  if (values.prChecks_onlyProblems === true && !PROBLEMS.has(signal)) {
    return null;
  }
  return signal;
}

export function PrChecksBadge({ threadId, values }: BadgeProps) {
  const { pullRequest } = experimental_useSidebarThreadPullRequest(threadId);
  if (pullRequest === null) return null;
  const signal = signalFor(pullRequest, values);
  if (signal === null) return null;
  const { icon, color, label } = SIGNALS[signal];
  const title = `#${pullRequest.number} · ${label}`;
  return (
    <span
      aria-label={title}
      style={{
        alignItems: "center",
        color: COLORS[color],
        display: "inline-flex",
        lineHeight: 1,
      }}
      title={title}
    >
      <Icon aria-hidden name={icon} style={{ height: 14, width: 14 }} />
    </span>
  );
}
