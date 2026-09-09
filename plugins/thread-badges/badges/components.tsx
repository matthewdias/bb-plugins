// Badge id → the component that draws it.
//
// Separate from catalog.ts because this file imports React, and the backend
// reads the catalog to build its settings.
//
// A badge component renders null whenever it has nothing to say. It runs once
// per visible row, so it must be cheap and must not assume it is the only one.
import type { ComponentType } from "react";
import type { BadgeSettings } from "./catalog";
import { FollowUpsBadge } from "./follow-ups";
import { PrChecksBadge } from "./pr-checks";
import { PullRequestBadge } from "./pull-request";

export interface BadgeProps {
  threadId: string;
  /** Every effective setting, including the ones other badges own. */
  values: BadgeSettings;
  /**
   * Increments when the window regains focus, throttled. A badge whose source
   * cannot push to it — anything reading another plugin — should refetch on
   * this rather than go stale until the page reloads. Badges fed by a
   * first-party hook can ignore it; bb already owns their staleness.
   */
  revision: number;
}

export const BADGE_COMPONENTS: Readonly<Record<string, ComponentType<BadgeProps>>> = {
  followUps: FollowUpsBadge,
  prChecks: PrChecksBadge,
  pullRequest: PullRequestBadge,
};
