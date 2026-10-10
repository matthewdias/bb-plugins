// What the review tests share: a page with one pull request card, and the
// changes its review reads.
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { FollowUpPage } from "../../src/page/page.tsx";
import type { Card } from "../../lib/page.ts";
import type { ReviewDiff } from "../../lib/review.ts";

const NOW = Date.now();

export const QUEUE_PATCH = ["@@ -12,3 +12,4 @@", "   const max = 5;", "-  retry(job);", "+  retry(job, { backoff: true });", "+  log(job);", "   return job;", ""].join("\n");

export const file = (path: string, extra: Partial<ReviewDiff["files"][number]> = {}): ReviewDiff["files"][number] => ({
  path,
  previousPath: null,
  change: "modified",
  additions: 2,
  deletions: 1,
  binary: false,
  patch: QUEUE_PATCH,
  cut: false,
  ...extra,
});

export const diffOf = (files: ReviewDiff["files"], more = 0): ReviewDiff => ({ files, more, base: "main" });

export function prCard(threadId: string, number = 71): Card {
  return {
    threadId,
    title: `Thread ${threadId}`,
    projectId: "prj_1",
    parentThreadId: null,
    parentTitle: null,
    tier: "turn",
    lead: "pr",
    since: NOW - 60_000,
    attentionAt: NOW - 60_000,
    asks: [],
    form: null,
    checklist: null,
    offer: null,
    openFollowUps: 0,
    followUps: [],
    wrapUp: null,
    pr: {
      number,
      title: "Add the offline queue",
      url: `https://github.com/o/r/pull/${number}`,
      state: "open",
      attention: "ready_to_merge",
      headRefName: "queue",
      baseRefName: "main",
      checks: { state: "passing", passed: 3, failed: 0, pending: 0, total: 3 },
      mergeability: "mergeable",
      action: "merge",
    } as Card["pr"],
    pageUrl: null,
    excerpt: null,
    unread: true,
    status: "idle",
    reviewThreadId: null,
    putAway: false,
    prKey: `${number}:ready_to_merge`,
    workers: [],
  };
}

export function renderReview(card: Card, answer: { outcome: string; diff: ReviewDiff | null }) {
  const rpc = {
    page_snapshot: async () => ({ cards: [card], putAway: [], moreFinished: 0, count: 1, running: [], followUps: [], projects: [{ id: "prj_1", name: "bb-plugins" }] }),
    page_pr_diff: async () => answer,
    page_reply: async () => ({ outcome: "sent" }),
  };
  return renderSlot({ component: FollowUpPage }, { subPath: "" }, { rpc: rpc as never });
}

export type Slot = ReturnType<typeof renderReview>;
export const calls = (slot: Slot, method: string) => slot.inspection.rpcCalls.filter((call) => call.method === method).map((call) => call.input);
