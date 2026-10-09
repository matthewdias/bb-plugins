// The pull-request complication, from bb's own per-thread lookup.
//
// One line: `#N title`, then the worst state as a phrase, and a link to the
// pull request. `attention` is bb's rolled-up "does this need you", so it
// alone decides the phrase and the tone. No detail: bb's own Info panel shows
// the checks, review and mergeability, and can act on them.
import type { PluginSidebarPullRequest } from "@get-bb/plugin-sdk/app";
import type { ComplicationValue } from "./complications";

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

/** `null` when the thread's branch has no pull request. */
export function prValue(pullRequest: PluginSidebarPullRequest | null): ComplicationValue | null {
  if (pullRequest === null) return null;
  const label = `#${pullRequest.number} ${pullRequest.title}`;
  const attention = Object.prototype.hasOwnProperty.call(ATTENTION, pullRequest.attention)
    ? ATTENTION[pullRequest.attention]
    : { tone: "default" };

  return {
    icon: "GitPullRequest",
    label,
    tone: attention.tone,
    ...(attention.text !== undefined ? { text: attention.text } : {}),
    open: { href: pullRequest.url },
  } as ComplicationValue;
}
