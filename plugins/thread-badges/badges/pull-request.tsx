// The pull-request badge.
//
// bb resolves the pull request: `experimental_useSidebarThreadPullRequest` is
// first-party, per row and opt-in because it costs a git-host lookup, and the
// host owns polling and staleness. Nothing here fetches or caches anything.
import {
  experimental_useSidebarThreadPullRequest,
  type PluginSidebarPullRequest,
} from "@get-bb/plugin-sdk/app";
import { Icon, type IconName } from "@/components/ui/icon";
import type { BadgeProps } from "./components";

const STATE_ICON: Record<PluginSidebarPullRequest["state"], IconName> = {
  closed: "GitPullRequestClosed",
  draft: "GitPullRequestDraft",
  merged: "GitPullRequest",
  open: "GitPullRequestDraft",
};

/**
 * GitHub's own colours, because that is where the reader learned them: green
 * open, purple merged, red closed. Draft takes the theme's subtle grey, so
 * "not started" recedes into whatever palette is on.
 */
const STATE_COLOR: Record<PluginSidebarPullRequest["state"], string> = {
  closed: "var(--destructive)",
  draft: "var(--subtle-foreground)",
  merged: "light-dark(#8250df, #a371f7)",
  open: "light-dark(#1a7f37, #3fb950)",
};

function describe(pullRequest: PluginSidebarPullRequest): string {
  // `attention` repeats the state for merged, closed and draft; say it once.
  const attention =
    pullRequest.attention === "none" || pullRequest.attention === pullRequest.state
      ? ""
      : ` · ${pullRequest.attention.replace(/_/gu, " ")}`;
  return `#${pullRequest.number} · ${pullRequest.state}${attention} — ${pullRequest.title}`;
}

export function PullRequestBadge({ threadId, values }: BadgeProps) {
  const { pullRequest } = experimental_useSidebarThreadPullRequest(threadId);
  // Null is "nothing to show", never an error: no branch, no environment, or a
  // git-host hiccup all land here. Loading draws nothing rather than flicker.
  if (pullRequest === null) return null;
  if (
    values.pullRequest_onlyOpen === true &&
    (pullRequest.state === "merged" || pullRequest.state === "closed")
  ) {
    return null;
  }
  const label = describe(pullRequest);
  return (
    <span
      aria-label={label}
      style={{
        alignItems: "center",
        color: STATE_COLOR[pullRequest.state],
        display: "inline-flex",
        fontSize: 11,
        gap: 2,
        lineHeight: 1,
      }}
      title={label}
    >
      <Icon
        aria-hidden
        name={STATE_ICON[pullRequest.state]}
        style={{ height: 14, width: 14 }}
      />
      {values.pullRequest_showNumber === true ? <span>{pullRequest.number}</span> : null}
    </span>
  );
}
