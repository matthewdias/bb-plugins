// The pull-request complication, from bb's own per-thread lookup.
//
// `attention` is bb's rolled-up "does this need you", so it alone decides the
// small sizes: a phrase for the text and a tone for the glyph. The detail
// spells out what it was rolled up from.
import type { PluginSidebarPullRequest } from "@get-bb/plugin-sdk/app";
import type { ComplicationValue } from "./complications";
import type { DetailRow } from "./validate";

/**
 * Each attention state's text and tone. Pending and queued are `running`,
 * which pulses like bb's own work in progress; merged is a success; draft,
 * closed and a quiet open PR are `default`. bb reports no counts here, so the
 * text is a phrase rather than "2 failing".
 */
export const ATTENTION: Readonly<Record<string, { text?: string; tone: string }>> = {
  checks_failed: { text: "checks failing", tone: "error" },
  conflicts: { text: "conflicts", tone: "error" },
  checks_pending: { text: "checks running", tone: "running" },
  changes_requested: { text: "changes requested", tone: "warning" },
  blocked: { text: "blocked", tone: "warning" },
  review_requested: { text: "review requested", tone: "info" },
  ready_to_merge: { text: "ready to merge", tone: "success" },
  queued: { text: "in merge queue", tone: "running" },
  merged: { text: "merged", tone: "success" },
  draft: { text: "draft", tone: "default" },
  closed: { text: "closed", tone: "default" },
  none: { tone: "default" },
};

const CHECKS: Readonly<Record<string, { value: string; tone?: string }>> = {
  passing: { value: "passing", tone: "success" },
  failing: { value: "failing", tone: "error" },
  pending: { value: "running", tone: "running" },
  no_checks: { value: "none" },
  unknown: { value: "unknown" },
};

const REVIEW: Readonly<Record<string, { value: string; tone?: string }>> = {
  approved: { value: "approved", tone: "success" },
  changes_requested: { value: "changes requested", tone: "warning" },
  review_requested: { value: "requested", tone: "info" },
  review_required: { value: "required" },
  none: { value: "none" },
};

const MERGEABILITY: Readonly<Record<string, { value: string; tone?: string }>> = {
  mergeable: { value: "mergeable", tone: "success" },
  conflicts: { value: "conflicts", tone: "error" },
  blocked: { value: "blocked", tone: "warning" },
  draft: { value: "draft" },
  unknown: { value: "unknown" },
};

function lookup(
  table: Readonly<Record<string, { value: string; tone?: string }>>,
  state: string,
): { value: string; tone?: string } {
  return Object.prototype.hasOwnProperty.call(table, state) ? table[state] : { value: state };
}

/** `null` when the thread's branch has no pull request. */
export function prValue(pullRequest: PluginSidebarPullRequest | null): ComplicationValue | null {
  if (pullRequest === null) return null;
  const label = `#${pullRequest.number} ${pullRequest.title}`;
  const attention = Object.prototype.hasOwnProperty.call(ATTENTION, pullRequest.attention)
    ? ATTENTION[pullRequest.attention]
    : { tone: "default" };

  const rows: DetailRow[] = [
    { label: "Checks", ...lookup(CHECKS, pullRequest.experimental_checks.state) },
    { label: "Review", ...lookup(REVIEW, pullRequest.experimental_review.state) },
    { label: "Mergeability", ...lookup(MERGEABILITY, pullRequest.experimental_mergeability.state) },
  ];
  if (pullRequest.experimental_inMergeQueue === true) {
    rows.push({ label: "Merge queue", value: "queued", tone: "running" });
  } else if (pullRequest.experimental_autoMerge) {
    rows.push({ label: "Auto-merge", value: "on" });
  }

  return {
    icon: "GitPullRequest",
    label,
    tone: attention.tone,
    ...(attention.text !== undefined ? { text: attention.text } : {}),
    detail: { title: label, rows },
    open: { href: pullRequest.url },
  } as ComplicationValue;
}
