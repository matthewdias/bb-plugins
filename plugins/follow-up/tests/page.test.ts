// The rules behind the Follow Up page: which threads get a card, in which
// tier, in what order, what the sidebar counts, and how the follow-ups lane is
// grouped. Every bb fact arrives as plain data, so none of this needs a host.
import assert from "node:assert/strict";
import test from "node:test";
import {
  activityLabel,
  capFinished,
  cardFor,
  countOf,
  excerptOf,
  groupFollowUps,
  inMotion,
  isUnread,
  pageLinkIn,
  pendingAsk,
  PENDING_STALE_MS,
  prAction,
  prFixMessage,
  prOwners,
  prRebaseMessage,
  prSummary,
  rank,
  reviewPrompt,
  threadFacts,
  type Card,
  type PendingAsk,
  type PrSummary,
  type ThreadFacts,
  type ThreadInputs,
} from "../lib/page.ts";
import type { FollowUp, Reason } from "../lib/followups.ts";

const NOW = 1_800_000_000_000;

const thread = (extra: Partial<ThreadFacts> = {}): ThreadFacts => ({
  id: "thr_a",
  title: "A thread",
  projectId: "prj_1",
  parentThreadId: null,
  status: "idle",
  archived: false,
  lastReadAt: 100,
  latestAttentionAt: 100,
  updatedAt: 100,
  hasPendingInteraction: false,
  environmentId: null,
  environmentIsWorktree: false,
  ...extra,
});

const inputs = (extra: Partial<ThreadInputs> = {}): ThreadInputs => ({
  thread: thread(),
  asks: [],
  offer: null,
  openFollowUps: 0,
  wrapUp: null,
  pr: null,
  reply: null,
  hiddenAt: null,
  parentTitle: null,
  review: null,
  ...extra,
});

const question = (createdAt: number, interactionId = `int_${createdAt}`): PendingAsk => ({
  kind: "question",
  interactionId,
  createdAt,
  questions: [
    { id: "q1", prompt: "Which?", shortLabel: null, multiSelect: false, allowFreeText: true, options: [] },
  ],
});

const pr = (attention: string, extra: Partial<PrSummary> = {}): PrSummary => ({
  number: 44,
  title: "Add the page",
  url: "https://github.com/o/r/pull/44",
  state: "open",
  attention,
  headRefName: "feature",
  baseRefName: "main",
  checks: { state: "passing", passed: 14, failed: 0, pending: 0, total: 14 },
  mergeability: "mergeable",
  ...extra,
});

const row = (id: string, reason: Reason | null, extra: Partial<FollowUp> = {}): FollowUp => ({
  id,
  text: `Row ${id}`,
  reason,
  file: null,
  detail: null,
  createdAt: "2026-10-08T00:00:00.000Z",
  ...extra,
});

const must = (card: Card | null): Card => {
  assert.ok(card !== null, "expected a card");
  return card;
};

// --- thread facts -----------------------------------------------------------

test("threadFacts: reads a list row, falling back to the generated title", () => {
  const facts = threadFacts({
    id: "thr_x",
    projectId: "prj_1",
    title: null,
    titleFallback: "  Fix the badge  ",
    status: "idle",
    archivedAt: null,
    lastReadAt: 5,
    latestAttentionAt: 9,
    updatedAt: 9,
    hasPendingInteraction: true,
    environmentId: "env_1",
    environmentIsWorktree: true,
    parentThreadId: "thr_p",
  });
  assert.deepEqual(facts, {
    id: "thr_x",
    title: "Fix the badge",
    projectId: "prj_1",
    parentThreadId: "thr_p",
    status: "idle",
    archived: false,
    lastReadAt: 5,
    latestAttentionAt: 9,
    updatedAt: 9,
    hasPendingInteraction: true,
    environmentId: "env_1",
    environmentIsWorktree: true,
  });
});

test("threadFacts: an archived row is archived; a row with no id is skipped", () => {
  assert.equal(threadFacts({ id: "t", projectId: "p", archivedAt: 3 })?.archived, true);
  assert.equal(threadFacts({ projectId: "p" }), null);
  assert.equal(threadFacts({ id: "t", projectId: "p" })?.title, "Untitled thread");
});

test("isUnread: attention after the last read, and never-read counts as unread", () => {
  assert.equal(isUnread(thread({ latestAttentionAt: 101, lastReadAt: 100 })), true);
  assert.equal(isUnread(thread({ latestAttentionAt: 100, lastReadAt: 100 })), false);
  assert.equal(isUnread(thread({ latestAttentionAt: 5, lastReadAt: null })), true);
});

test("inMotion: active threads, fresh pending ones, never a blocked or archived one", () => {
  assert.equal(inMotion(thread({ status: "active" }), NOW), true);
  assert.equal(inMotion(thread({ status: "idle" }), NOW), false);
  assert.equal(inMotion(thread({ status: "pending", updatedAt: NOW - 1000 }), NOW), true);
  assert.equal(inMotion(thread({ status: "pending", updatedAt: NOW - PENDING_STALE_MS }), NOW), false);
  assert.equal(inMotion(thread({ status: "active", hasPendingInteraction: true }), NOW), false);
  assert.equal(inMotion(thread({ status: "active", archived: true }), NOW), false);
});

// --- pending asks ---------------------------------------------------------------

test("pendingAsk: a question keeps its options and falls back to the label for a value", () => {
  const ask = pendingAsk({
    id: "int_1",
    status: "pending",
    createdAt: 7,
    payload: {
      kind: "user_question",
      questions: [
        {
          id: "q1",
          prompt: "Middle-click?",
          multiSelect: true,
          allowFreeText: false,
          options: [{ label: "Background", value: "bg", description: "Like browsers" }, { label: "Nothing" }],
        },
      ],
    },
  });
  assert.deepEqual(ask, {
    kind: "question",
    interactionId: "int_1",
    createdAt: 7,
    questions: [
      {
        id: "q1",
        prompt: "Middle-click?",
        shortLabel: null,
        multiSelect: true,
        allowFreeText: false,
        options: [
          { label: "Background", value: "bg", description: "Like browsers" },
          { label: "Nothing", value: "Nothing", description: null },
        ],
      },
    ],
  });
});

test("pendingAsk: only pending interactions count", () => {
  for (const status of ["resolved", "resolving", "interrupted"]) {
    assert.equal(pendingAsk({ id: "i", status, payload: { kind: "user_question", questions: [] } }), null);
  }
});

test("pendingAsk: approvals say what is being approved", () => {
  const command = pendingAsk({
    id: "i",
    status: "pending",
    createdAt: 1,
    payload: { kind: "approval", subject: { kind: "command", command: "git push\n  --force" } },
  });
  assert.deepEqual(command, {
    kind: "approval",
    interactionId: "i",
    createdAt: 1,
    subject: "command",
    summary: "git push --force",
  });
  const plan = pendingAsk({
    id: "i",
    status: "pending",
    payload: { kind: "approval", subject: { kind: "plan", plan: "\n## Offline queue\n1. Store" } },
  });
  assert.equal(plan?.kind === "approval" ? plan.summary : null, "Offline queue");
});

test("pendingAsk: a kind it cannot read is a form, so the thread still shows as blocked", () => {
  const ask = pendingAsk({ id: "i", status: "pending", createdAt: 2, payload: { kind: "plugin", title: "Grill round" } });
  assert.deepEqual(ask, { kind: "form", interactionId: "i", createdAt: 2, title: "Grill round" });
  assert.equal(pendingAsk({ id: "i", status: "pending" })?.kind, "form");
});

// --- cards ---------------------------------------------------------------------

test("cardFor: a pending ask makes a blocked card, even while the thread is busy", () => {
  const card = must(cardFor(inputs({ thread: thread({ status: "active" }), asks: [question(50), question(20)] })));
  assert.equal(card.tier, "blocked");
  assert.equal(card.lead, "question");
  assert.equal(card.since, 20, "since is the oldest ask");
  assert.deepEqual(card.asks.map((ask) => ask.createdAt), [20, 50]);
});

test("cardFor: a busy thread with nothing pending is not a card", () => {
  for (const status of ["active", "pending", "starting", "stopping"]) {
    assert.equal(
      cardFor(inputs({ thread: thread({ status, latestAttentionAt: 200 }), offer: { steps: ["Go"], goalMet: false, offeredAt: "x" } })),
      null,
      status,
    );
  }
});

test("cardFor: an archived thread is never a card", () => {
  assert.equal(cardFor(inputs({ thread: thread({ archived: true }), asks: [question(1)] })), null);
});

test("cardFor: a failed thread is your turn, ahead of anything else it holds", () => {
  const card = must(
    cardFor(inputs({ thread: thread({ status: "error" }), offer: { steps: ["Go"], goalMet: false, offeredAt: "x" } })),
  );
  assert.equal(card.tier, "turn");
  assert.equal(card.lead, "stopped");
});

test("cardFor: goal met with rows open is a wrap-up, and it outranks the steps", () => {
  const card = must(
    cardFor(inputs({ offer: { steps: ["Open a PR"], goalMet: true, offeredAt: "x" }, openFollowUps: 2 })),
  );
  assert.equal(card.lead, "wrap-up");
  assert.deepEqual(card.offer?.steps, ["Open a PR"], "the steps still ride along");
});

test("cardFor: goal met with nothing open is not a wrap-up", () => {
  const card = must(cardFor(inputs({ offer: { steps: ["Archive it"], goalMet: true, offeredAt: "x" } })));
  assert.equal(card.lead, "next");
});

test("cardFor: a held wrap-up is a wrap-up card whatever the offer says", () => {
  const card = must(cardFor(inputs({ wrapUp: { held: "A filing failed.", running: false } })));
  assert.equal(card.lead, "wrap-up");
});

test("cardFor: offered steps are your turn, read or not", () => {
  const card = must(cardFor(inputs({ offer: { steps: ["Delete the branch"], goalMet: false, offeredAt: "x" } })));
  assert.equal(card.tier, "turn");
  assert.equal(card.lead, "next");
});

test("cardFor: a reply ending on this thread's page link is a page card", () => {
  const reply = "[Open the Thread Page](https://h.example/api/v1/plugins/thread-pages/http/page?session=thr_a)";
  const card = must(cardFor(inputs({ reply })));
  assert.equal(card.lead, "page");
  assert.equal(card.pageUrl, "https://h.example/api/v1/plugins/thread-pages/http/page?session=thr_a");
});

test("cardFor: a pull request that wants you is your turn; one that does not adds nothing", () => {
  const ready = must(cardFor(inputs({ pr: pr("ready_to_merge") })));
  assert.equal(ready.lead, "pr");
  assert.equal(ready.pr?.action, "merge");
  assert.equal(cardFor(inputs({ pr: pr("checks_pending") })), null);
  assert.equal(cardFor(inputs({ pr: pr("draft") })), null);
});

test("cardFor: a merged pull request is finished, not your turn", () => {
  const card = must(cardFor(inputs({ pr: pr("merged") })));
  assert.equal(card.lead, "pr");
  assert.equal(card.tier, "finished");
});

test("cardFor: an unread finished turn is finished; a read one with nothing asked is nothing", () => {
  const card = must(cardFor(inputs({ thread: thread({ latestAttentionAt: 200, lastReadAt: 100 }), reply: "Done." })));
  assert.equal(card.tier, "finished");
  assert.equal(card.lead, "finished");
  assert.equal(card.excerpt, "Done.");
  assert.equal(cardFor(inputs({ reply: "Done." })), null);
});

test("cardFor: Not now hides a card until something new happens on the thread", () => {
  const base = { offer: { steps: ["Go"], goalMet: false, offeredAt: "x" } };
  assert.equal(cardFor(inputs({ ...base, hiddenAt: 100 })), null);
  assert.ok(cardFor(inputs({ ...base, hiddenAt: 99 })) !== null, "newer attention brings it back");
});

test("cardFor: Not now cannot hide a blocked thread", () => {
  const card = cardFor(inputs({ asks: [question(1)], hiddenAt: 1_000 }));
  assert.equal(card?.tier, "blocked");
});

test("cardFor: the lead order is stopped, wrap-up, next, page, pull request", () => {
  const page = "https://h/api/v1/plugins/thread-pages/http/page?session=thr_a";
  const all: Partial<ThreadInputs> = {
    offer: { steps: ["Go"], goalMet: false, offeredAt: "x" },
    reply: page,
    pr: pr("ready_to_merge"),
  };
  assert.equal(cardFor(inputs(all))?.lead, "next");
  assert.equal(cardFor(inputs({ ...all, offer: null }))?.lead, "page");
  assert.equal(cardFor(inputs({ ...all, offer: null, reply: null }))?.lead, "pr");
});

// --- ranking and counting --------------------------------------------------------

const card = (threadId: string, tier: Card["tier"], since: number): Card => ({
  ...must(cardFor(inputs({ thread: thread({ id: threadId, latestAttentionAt: since + 1, lastReadAt: 0 }), reply: "x" }))),
  tier,
  since,
});

test("rank: blocked first and oldest first; your turn and finished newest first", () => {
  const ranked = rank([
    card("t-new", "turn", 30),
    card("f-old", "finished", 1),
    card("b-new", "blocked", 50),
    card("t-old", "turn", 10),
    card("b-old", "blocked", 5),
    card("f-new", "finished", 40),
  ]);
  assert.deepEqual(ranked.map((c) => c.threadId), ["b-old", "b-new", "t-new", "t-old", "f-new", "f-old"]);
});

test("countOf: counts blocked and your-turn cards, not finished ones", () => {
  assert.equal(countOf([card("a", "blocked", 1), card("b", "turn", 1), card("c", "finished", 1), card("d", "finished", 2)]), 2);
  assert.equal(countOf([]), 0);
});

test("capFinished: keeps every ask and only the newest finished cards", () => {
  const ranked = rank([card("b", "blocked", 1), card("f1", "finished", 3), card("f2", "finished", 2), card("f3", "finished", 1)]);
  const { cards, moreFinished } = capFinished(ranked, 2);
  assert.deepEqual(cards.map((c) => c.threadId), ["b", "f1", "f2"]);
  assert.equal(moreFinished, 1);
});

// --- pull requests ---------------------------------------------------------------

test("cardFor: a review thread shows only for the pull request it was started for", () => {
  const started = { prNumber: 44, threadId: "thr_review" };
  assert.equal(cardFor(inputs({ pr: pr("ready_to_merge"), review: started }))?.reviewThreadId, "thr_review");
  assert.equal(cardFor(inputs({ pr: pr("ready_to_merge", { number: 45 }), review: started }))?.reviewThreadId, null);
});

test("prAction: maps bb's attention roll-up to what the card offers", () => {
  assert.equal(prAction(pr("ready_to_merge")), "merge");
  assert.equal(prAction(pr("review_requested")), "review");
  assert.equal(prAction(pr("changes_requested")), "fix");
  assert.equal(prAction(pr("checks_failed")), "fix");
  assert.equal(prAction(pr("conflicts")), "rebase");
  assert.equal(prAction(pr("merged")), "merged");
  for (const quiet of ["none", "draft", "checks_pending", "queued", "closed", "blocked"]) {
    assert.equal(prAction(pr(quiet)), null, quiet);
  }
});

test("prSummary: reads an available answer and treats anything else as nothing", () => {
  const summary = prSummary({
    outcome: "available",
    pullRequest: {
      number: 7,
      title: "T",
      url: "https://x/7",
      state: "open",
      attention: "checks_failed",
      headRefName: "h",
      baseRefName: "main",
      checks: { state: "failing", passedCount: 11, failedCount: 1, pendingCount: 0, totalCount: 12 },
      mergeability: { state: "mergeable" },
    },
  });
  assert.deepEqual(summary?.checks, { state: "failing", passed: 11, failed: 1, pending: 0, total: 12 });
  assert.equal(summary?.mergeability, "mergeable");
  assert.equal(prSummary({ outcome: "unavailable" }), null);
  assert.equal(prSummary(null), null);
});

test("prOwners: one thread per worktree, the most recently active, and no shared checkouts", () => {
  const owners = prOwners([
    thread({ id: "old", environmentId: "env_w", environmentIsWorktree: true, updatedAt: 1 }),
    thread({ id: "new", environmentId: "env_w", environmentIsWorktree: true, updatedAt: 9 }),
    thread({ id: "shared", environmentId: "env_s", environmentIsWorktree: false, updatedAt: 9 }),
    thread({ id: "gone", environmentId: "env_g", environmentIsWorktree: true, archived: true }),
  ]);
  assert.deepEqual([...owners], [["env_w", "new"]]);
});

test("PR messages name the PR and what is wrong", () => {
  assert.match(prFixMessage(pr("checks_failed", { checks: { state: "failing", passed: 1, failed: 2, pending: 0, total: 3 } })), /#44.*2 checks are failing/);
  assert.match(prFixMessage(pr("checks_failed", { checks: { state: "failing", passed: 1, failed: 1, pending: 0, total: 2 } })), /1 check is failing/);
  assert.match(prFixMessage(pr("changes_requested")), /Changes were requested on PR #44/);
  assert.match(prRebaseMessage(pr("conflicts")), /conflicts with main\. Rebase onto the latest main/);
  assert.match(reviewPrompt(pr("ready_to_merge")), /Review PR #44, "Add the page".*Do not change any code/);
});

// --- replies ---------------------------------------------------------------------

test("pageLinkIn: only this thread's own page counts", () => {
  const own = "https://h/api/v1/plugins/thread-pages/http/page?session=thr_a";
  const other = "https://h/api/v1/plugins/thread-pages/http/page?session=thr_b";
  assert.equal(pageLinkIn(`See ${other} and [here](${own})`, "thr_a"), own);
  assert.equal(pageLinkIn(other, "thr_a"), null);
  assert.equal(pageLinkIn("/api/v1/plugins/thread-pages/http/page?session=thr_a", "thr_a"), "/api/v1/plugins/thread-pages/http/page?session=thr_a");
  assert.equal(pageLinkIn(null, "thr_a"), null);
});

test("excerptOf: the last paragraph, cut from the front, links reduced to text", () => {
  assert.equal(excerptOf("First.\n\nSee [the PR](https://x) now."), "See the PR now.");
  assert.equal(excerptOf("abcdefghij", 5), "…ghij");
  assert.equal(excerptOf("  \n\n "), null);
  assert.equal(excerptOf(null), null);
});

test("excerptOf: a Thread Page link is left out, and a reply that is only the link has no excerpt", () => {
  const link = "https://h/api/v1/plugins/thread-pages/http/page?session=thr_a";
  assert.equal(excerptOf(`[Open the Thread Page](${link})`), null);
  assert.equal(excerptOf(`Built the plan.\n\n[Open the Thread Page](${link})`), "Built the plan.");
  assert.equal(excerptOf(`See ${link}`), "See");
});

// --- in motion -------------------------------------------------------------------

test("activityLabel: bb's presentation first, then the item's kind", () => {
  assert.equal(
    activityLabel({ type: "fileRead", path: "/a/b.ts", presentation: { label: { pending: "Reading file" }, title: "b.ts" } }),
    "Reading file · b.ts",
  );
  assert.equal(activityLabel({ type: "commandExecution", command: "npm test\n--watch" }), "Running npm test");
  assert.equal(activityLabel({ type: "fileChange", changes: [{ path: "/x/app.tsx" }] }), "Editing app.tsx");
  assert.equal(activityLabel({ type: "reasoning" }), "Thinking");
  assert.equal(activityLabel({ type: "agentMessage" }), "Writing a reply");
  assert.equal(activityLabel(null), "Working");
});

// --- follow-ups lane -------------------------------------------------------------

test("groupFollowUps: by project, open threads newest first, archived after, empty ones left out", () => {
  const groups = groupFollowUps(
    [
      { threadId: "t-arch", title: "Archived", projectId: "p1", archived: true, updatedAt: 99, rows: [row("a", "risk")] },
      { threadId: "t-old", title: "Old", projectId: "p1", archived: false, updatedAt: 1, rows: [row("b", "deferred")] },
      { threadId: "t-new", title: "New", projectId: "p1", archived: false, updatedAt: 5, rows: [row("c", "out-of-scope")] },
      { threadId: "t-empty", title: "Empty", projectId: "p1", archived: false, updatedAt: 9, rows: [] },
      { threadId: "t-z", title: "Zed", projectId: "p2", archived: false, updatedAt: 1, rows: [row("d", null, { sentAt: "x" })] },
    ],
    new Map([
      ["p1", "Transpondarr"],
      ["p2", "bb-plugins"],
    ]),
  );
  assert.deepEqual(groups.map((g) => g.projectName), ["bb-plugins", "Transpondarr"]);
  assert.deepEqual(groups[1]?.threads.map((t) => t.threadId), ["t-new", "t-old", "t-arch"]);
  assert.equal(groups[1]?.threads[0]?.rows[0]?.lead, "handoff", "out of scope leads with a handoff");
  assert.equal(groups[1]?.threads[1]?.rows[0]?.lead, "do");
  assert.equal(groups[0]?.threads[0]?.rows[0]?.inProgress, true);
  assert.equal(groups[1]?.threads[2]?.rows[0]?.lead, "handoff", "an archived thread's rows go to a new thread");
});
