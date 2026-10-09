// The Follow Up page through the server: what the snapshot gathers from the
// host, what each card's action calls, and when open pages are told to refetch.
// lib/page.ts's rules have their own tests; these pin the wiring around them.
import assert from "node:assert/strict";
import test from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../server.ts";

const NOW = Date.now();

type Row = Record<string, unknown>;

const threadRow = (id: string, extra: Row = {}): Row => ({
  id,
  projectId: "prj_1",
  title: `Thread ${id}`,
  status: "idle",
  archivedAt: null,
  lastReadAt: 100,
  latestAttentionAt: 100,
  updatedAt: NOW - 1000,
  createdAt: NOW - 100_000,
  hasPendingInteraction: false,
  environmentId: null,
  environmentIsWorktree: false,
  parentThreadId: null,
  ...extra,
});

const questionInteraction = (id: string, status = "pending"): Row => ({
  id,
  status,
  createdAt: 50,
  payload: {
    kind: "user_question",
    questions: [{ id: "q1", prompt: "Which?", multiSelect: false, allowFreeText: true, options: [{ label: "A", value: "a" }] }],
  },
});

const prResponse = (attention: string, number = 44): Row => ({
  outcome: "available",
  pullRequest: {
    number,
    title: "Add the page",
    url: `https://github.com/o/r/pull/${number}`,
    state: "open",
    attention,
    headRefName: "feature",
    baseRefName: "main",
    checks: { state: "passing", passedCount: 3, failedCount: 0, pendingCount: 0, totalCount: 3 },
    mergeability: { state: "mergeable" },
  },
});

interface World {
  threads: Row[];
  interactions: Record<string, Row[]>;
  outputs: Record<string, string | null>;
  prs: Record<string, Row>;
  /** `threads.get` answers for threads not in the list: archived ones. */
  others: Record<string, Row>;
  events: Record<string, Row[]>;
  /** How long a pull request lookup takes: GitHub is never instant. */
  prDelayMs: number;
}

async function host(world: Partial<World> = {}) {
  const w: World = {
    threads: [],
    interactions: {},
    outputs: {},
    prs: {},
    others: {},
    events: {},
    prDelayMs: 0,
    ...world,
  };
  const { bb, harness } = createFakePluginHost();
  let onChange: ((event: { changes: string[] }) => void) | null = null;
  let unsubscribed = 0;
  harness.sdk.stub("subscribe", (args: { callback: (event: { changes: string[] }) => void }) => {
    onChange = args.callback;
    return () => {
      unsubscribed += 1;
    };
  });
  harness.sdk.stub("threads.list", () => w.threads);
  harness.sdk.stub("threads.get", (args: { threadId: string }) => {
    const found = w.threads.find((row) => row.id === args.threadId) ?? w.others[args.threadId];
    if (found === undefined) throw new Error("no such thread");
    return found;
  });
  harness.sdk.stub("threads.interactions.list", (args: { threadId: string }) => w.interactions[args.threadId] ?? []);
  harness.sdk.stub("threads.interactions.get", (args: { threadId: string; interactionId: string }) =>
    (w.interactions[args.threadId] ?? []).find((row) => row.id === args.interactionId),
  );
  harness.sdk.stub("threads.interactions.resolve", () => ({}));
  harness.sdk.stub("threads.output", (args: { threadId: string }) => ({ output: w.outputs[args.threadId] ?? null }));
  harness.sdk.stub("threads.events.list", (args: { threadId: string }) => w.events[args.threadId] ?? []);
  harness.sdk.stub("threads.send", () => ({ ok: true, delivery: "sent" }));
  harness.sdk.stub("threads.markRead", () => ({}));
  harness.sdk.stub("threads.archive", () => ({}));
  harness.sdk.stub("threads.retry", () => ({}));
  harness.sdk.stub("threads.stop", () => ({}));
  let spawned = 0;
  harness.sdk.stub("threads.spawn", () => ({ id: `thr_spawned${++spawned}` }));
  harness.sdk.stub("projects.list", () => [
    { id: "prj_1", name: "bb-plugins" },
    { id: "prj_2", name: "Transpondarr" },
  ]);
  harness.sdk.stub(
    "environments.pullRequest",
    (args: { environmentId: string }) =>
      new Promise((resolve) =>
        setTimeout(() => resolve(w.prs[args.environmentId] ?? { outcome: "none" }), w.prDelayMs),
      ),
  );
  harness.sdk.stub("environments.mergePullRequest", () => ({ ok: true }));
  await plugin(bb);

  const call = (method: string, input: unknown = {}) => harness.callRpc(method, input) as Promise<any>;
  const calls = (path: string) => harness.sdk.callsTo(path).map((args) => args[0] as Row);
  const signals = () => harness.realtimeSignals.filter((signal) => signal.channel === "followups-page-changed").length;
  const record = (threadId: string, text: string, reason = "deferred") =>
    harness.callAgentTool("record_follow_up", { text, reason }, { threadId });
  const change = (...changes: string[]) => {
    assert.ok(onChange !== null, "the server subscribed to thread changes");
    onChange({ changes });
  };
  // Every kv key the plugin reads from here on, to check what a call costs.
  const reads: string[] = [];
  const kv = bb.storage.kv as unknown as { get: (key: string) => Promise<unknown> };
  const get = kv.get.bind(kv);
  kv.get = (key: string) => {
    reads.push(key);
    return get(key);
  };
  return { w, harness, call, calls, signals, record, change, unsubscribed: () => unsubscribed, reads };
}

/** Long enough for the page signal's debounce and any background lookup. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 320));

test("page: a blocked thread, an offer and an unread reply make three cards in tier order", async () => {
  const { harness, call } = await host({
    threads: [
      threadRow("thr_done", { latestAttentionAt: 300, lastReadAt: 100 }),
      threadRow("thr_next"),
      threadRow("thr_blocked", { status: "active", hasPendingInteraction: true }),
    ],
    interactions: { thr_blocked: [questionInteraction("int_1")] },
    outputs: { thr_done: "All done.", thr_next: "Want me to open a PR?" },
  });
  await harness.callAgentTool("offer_next_steps", { steps: ["Open a PR"] }, { threadId: "thr_next" });

  const page = await call("page_snapshot");
  assert.deepEqual(
    page.cards.map((card: any) => [card.threadId, card.tier, card.lead]),
    [
      ["thr_blocked", "blocked", "question"],
      ["thr_next", "turn", "next"],
      ["thr_done", "finished", "finished"],
    ],
  );
  assert.equal(page.count, 2, "finished turns are not counted");
  assert.equal(page.cards[2].excerpt, "All done.");
});

test("page: asks the host for open threads only", async () => {
  const { call, calls } = await host({ threads: [threadRow("thr_a")] });
  await call("page_snapshot");
  assert.deepEqual(calls("threads.list"), [{ archived: false }]);
});

test("page: only blocked threads have their asks read, and a read thread's reply is never fetched", async () => {
  const { call, calls } = await host({
    threads: [
      threadRow("thr_read"),
      threadRow("thr_blocked", { hasPendingInteraction: true }),
    ],
    interactions: { thr_blocked: [questionInteraction("int_1")] },
  });
  await call("page_snapshot");
  assert.deepEqual(calls("threads.interactions.list").map((args) => args.threadId), ["thr_blocked"]);
  assert.deepEqual(calls("threads.output").map((args) => args.threadId), []);
});

test("page: a busy thread is in motion, labelled with what it is doing, not a card", async () => {
  const { call } = await host({
    threads: [threadRow("thr_busy", { status: "active" })],
    events: {
      thr_busy: [
        { type: "item/started", createdAt: 30, data: { item: { type: "reasoning" } } },
        { type: "item/started", createdAt: 20, data: { item: { type: "commandExecution", command: "npm test" } } },
        { type: "turn/started", createdAt: 10 },
      ],
    },
  });
  const page = await call("page_snapshot");
  assert.deepEqual(page.cards, []);
  assert.equal(page.running.length, 1);
  assert.equal(page.running[0].now, "Running npm test", "reasoning between commands is still the command");
  assert.equal(page.running[0].startedAt, 10);
});

test("page: follow-ups on archived threads are in the lane, deleted threads' are not", async () => {
  const { call, record } = await host({
    threads: [threadRow("thr_live")],
    others: { thr_arch: threadRow("thr_arch", { archivedAt: 5, title: "Old work" }) },
  });
  await record("thr_live", "Split the worker");
  await record("thr_arch", "Retry expired tokens", "blocked");
  await record("thr_gone", "Lost to a deleted thread");
  const page = await call("page_snapshot");
  assert.equal(page.followUps.length, 1);
  assert.equal(page.followUps[0].projectName, "bb-plugins");
  assert.deepEqual(
    page.followUps[0].threads.map((thread: any) => [thread.threadId, thread.archived, thread.rows[0].text]),
    [
      ["thr_live", false, "Split the worker"],
      ["thr_arch", true, "Retry expired tokens"],
    ],
  );
});

test("page: the summary is the count and the first cards, without the lanes", async () => {
  const threads = [1, 2, 3, 4].map((n) => threadRow(`thr_${n}`, { hasPendingInteraction: true }));
  const { call, calls } = await host({
    threads,
    interactions: Object.fromEntries(threads.map((t) => [t.id, [questionInteraction(`int_${String(t.id)}`)]])),
  });
  const summary = await call("page_summary");
  assert.equal(summary.count, 4);
  assert.equal(summary.top.length, 3);
  assert.equal(calls("projects.list").length, 0);
  assert.equal(calls("threads.events.list").length, 0);
});

test("page: a worktree's pull request is looked up in the background, then shows on its card", async () => {
  const { call, calls, w, signals } = await host({
    threads: [
      threadRow("thr_pr", { environmentId: "env_w", environmentIsWorktree: true }),
      threadRow("thr_shared", { environmentId: "env_s", environmentIsWorktree: false }),
      threadRow("thr_working", { status: "active", environmentId: "env_x", environmentIsWorktree: true }),
    ],
    prs: { env_w: prResponse("ready_to_merge") },
    prDelayMs: 100,
  });
  const first = await call("page_snapshot");
  assert.deepEqual(first.cards, [], "the page never waits on GitHub");
  // The lookup's 100 ms, then the signal's debounce.
  await settle();
  await settle();
  assert.deepEqual(calls("environments.pullRequest").map((args) => args.environmentId), ["env_w"]);
  assert.equal(signals(), 1, "a lookup that found something tells the page");
  const second = await call("page_snapshot");
  assert.deepEqual(second.cards.map((card: any) => [card.threadId, card.lead, card.pr.action]), [["thr_pr", "pr", "merge"]]);
  await call("page_snapshot");
  await settle();
  assert.equal(calls("environments.pullRequest").length, 1, "a fresh lookup is not repeated");
  void w;
});

test("page: answering a question resolves it; a question no longer pending is stale", async () => {
  const { call, calls, w } = await host({
    threads: [threadRow("thr_q", { hasPendingInteraction: true })],
    interactions: { thr_q: [questionInteraction("int_1")] },
  });
  const answers = { q1: { selected: ["a"], freeText: "and quickly" } };
  assert.equal((await call("page_answer", { threadId: "thr_q", interactionId: "int_1", answers })).outcome, "answered");
  assert.deepEqual(calls("threads.interactions.resolve")[0], {
    threadId: "thr_q",
    interactionId: "int_1",
    resolution: { kind: "user_answer", answers },
  });
  w.interactions.thr_q = [questionInteraction("int_1", "resolved")];
  assert.equal((await call("page_answer", { threadId: "thr_q", interactionId: "int_1", answers })).outcome, "stale");
  assert.equal(calls("threads.interactions.resolve").length, 1);
});

test("page: merge asks for a method once per project, then uses it", async () => {
  const { call, calls, w } = await host({
    threads: [threadRow("thr_pr", { environmentId: "env_w", environmentIsWorktree: true })],
    prs: { env_w: prResponse("ready_to_merge") },
  });
  const first = await call("page_pr_merge", { threadId: "thr_pr" });
  assert.equal(first.outcome, "needs-method");
  assert.equal(calls("environments.mergePullRequest").length, 0);

  assert.equal((await call("page_pr_merge", { threadId: "thr_pr", method: "merge" })).outcome, "merged");
  assert.deepEqual(calls("environments.mergePullRequest")[0], { environmentId: "env_w", method: "merge" });

  const again = await call("page_pr_merge", { threadId: "thr_pr" });
  assert.deepEqual([again.outcome, again.method], ["merged", "merge"], "the project's method is remembered");

  w.prs.env_w = prResponse("checks_failed");
  const late = await call("page_pr_merge", { threadId: "thr_pr" });
  assert.equal(late.outcome, "not-ready", "checked again at the press, not trusted from the card");
  assert.equal(calls("environments.mergePullRequest").length, 2);
});

test("page: a merge tells the thread only once it has merged", async () => {
  const { call, calls, w } = await host({
    threads: [threadRow("thr_pr", { environmentId: "env_w", environmentIsWorktree: true })],
    prs: { env_w: prResponse("ready_to_merge") },
  });
  const merged = await call("page_pr_merge", { threadId: "thr_pr", method: "merge", tell: "I merged PR #44." });
  assert.deepEqual([merged.outcome, merged.told], ["merged", "sent"]);
  const sent = calls("threads.send");
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.threadId, "thr_pr");
  assert.equal((sent[0]?.input as Row[])[0]?.text, "I merged PR #44.");

  w.prs.env_w = prResponse("checks_failed");
  const refused = await call("page_pr_merge", { threadId: "thr_pr", tell: "I merged PR #44." });
  assert.deepEqual([refused.outcome, refused.told], ["not-ready", null]);
  assert.equal(calls("threads.send").length, 1, "nothing is said about a merge that did not happen");

  w.prs.env_w = prResponse("ready_to_merge");
  const quiet = await call("page_pr_merge", { threadId: "thr_pr" });
  assert.deepEqual([quiet.outcome, quiet.told], ["merged", null]);
  assert.equal(calls("threads.send").length, 1, "no message unless one was asked for");
});

test("page: Not now hides a card until the thread's attention moves", async () => {
  const { call, w } = await host({
    threads: [threadRow("thr_done", { latestAttentionAt: 300, lastReadAt: 100 })],
    outputs: { thr_done: "Done." },
  });
  assert.equal((await call("page_snapshot")).cards.length, 1);
  await call("page_hide", { threadId: "thr_done", at: 300 });
  assert.equal((await call("page_snapshot")).cards.length, 0);
  w.threads = [threadRow("thr_done", { latestAttentionAt: 400, lastReadAt: 100 })];
  assert.equal((await call("page_snapshot")).cards.length, 1);
});

test("page: thread changes that can move a card signal once per burst; streamed deltas do not", async () => {
  const { change, signals } = await host();
  change("events-appended");
  await settle();
  assert.equal(signals(), 0);
  change("interactions-changed");
  change("read-state-changed", "events-appended");
  change("status-changed");
  await settle();
  assert.equal(signals(), 1);
});

test("page: reparenting a thread or changing its environment signals open pages", async () => {
  for (const kind of ["parent-changed", "environment-changed"]) {
    const { change, signals } = await host();
    change(kind);
    await settle();
    assert.equal(signals(), 1, kind);
  }
});

test("page: the strip never shows a finished card, even with room to spare", async () => {
  const { call } = await host({
    threads: [
      threadRow("thr_q", { hasPendingInteraction: true }),
      threadRow("thr_done", { latestAttentionAt: 300, lastReadAt: 100 }),
    ],
    interactions: { thr_q: [questionInteraction("int_1")] },
    outputs: { thr_done: "Done." },
  });
  const summary = await call("page_summary");
  assert.deepEqual(summary.top.map((c: any) => c.threadId), ["thr_q"]);
  assert.equal(summary.count, 1);
});

test("page: a new pending question signals open pages", async () => {
  const { harness, signals } = await host();
  await harness.emitThreadEvent("interaction.pending", { threadId: "thr_a" } as never);
  await settle();
  assert.equal(signals(), 1);
});

test("page: a review thread starts as the author's child in the PR's worktree, and its card links it", async () => {
  const { call, calls } = await host({
    threads: [threadRow("thr_pr", { environmentId: "env_w", environmentIsWorktree: true })],
    prs: { env_w: prResponse("ready_to_merge") },
  });
  const result = await call("page_pr_review", { threadId: "thr_pr", prompt: "Review PR #44." });
  assert.deepEqual(result, { outcome: "spawned", spawnedThreadId: "thr_spawned1" });
  const spawn = calls("threads.spawn")[0];
  assert.equal(spawn.prompt, "Review PR #44.");
  assert.deepEqual(spawn.environment, { type: "reuse", environmentId: "env_w" });
  assert.equal(spawn.parentThreadId, "thr_pr", "a child of the author's thread");
  await call("page_snapshot");
  await settle();
  const page = await call("page_snapshot");
  assert.equal(page.cards[0].reviewThreadId, "thr_spawned1");
});

test("page: the review thread, newer and busier in the same worktree, never takes the author's PR", async () => {
  const { call, w } = await host({
    threads: [threadRow("thr_pr", { environmentId: "env_w", environmentIsWorktree: true })],
    prs: { env_w: prResponse("ready_to_merge") },
  });
  await call("page_pr_review", { threadId: "thr_pr", prompt: "Review PR #44." });
  // The host lists the reviewer it just spawned: the author's child, in its worktree.
  w.threads.push(
    threadRow("thr_spawned1", {
      parentThreadId: "thr_pr",
      environmentId: "env_w",
      environmentIsWorktree: true,
      createdAt: NOW,
      updatedAt: NOW,
      latestAttentionAt: 900,
      lastReadAt: 100,
    }),
  );
  w.outputs.thr_spawned1 = "No findings.";
  await call("page_snapshot");
  await settle();
  const page = await call("page_snapshot");
  const author = page.cards.find((c: any) => c.threadId === "thr_pr");
  assert.equal(author?.pr?.action, "merge", "the PR stays on the author's card");
  assert.equal(author?.reviewThreadId, "thr_spawned1", "with its Review thread link");
  const reviewer = author?.workers.find((w: any) => w.threadId === "thr_spawned1");
  assert.ok(reviewer, "the finished review sits in the author's card as a worker");
  assert.equal(reviewer.pr, null, "with no PR of its own to merge or fix");
  assert.equal(page.cards.filter((c: any) => c.threadId === "thr_spawned1").length, 0, "and no card of its own");
});

test("page: handing off from the lane spawns a thread and closes the row", async () => {
  const { call, calls, record, harness } = await host({
    threads: [threadRow("thr_live", { environmentId: "env_1" })],
  });
  await record("thr_live", "Split the worker", "out-of-scope");
  const id = (await call("page_snapshot")).followUps[0].threads[0].rows[0].id;
  const result = await call("page_handoff", { threadId: "thr_live", id });
  assert.deepEqual(result, { outcome: "spawned", spawnedThreadId: "thr_spawned1" });
  assert.equal(calls("threads.spawn")[0].parentThreadId, undefined);
  assert.deepEqual((await call("page_snapshot")).followUps, []);
  void harness;
});

test("page: reply, mark read, archive, retry and stop each call the host for that thread", async () => {
  const { call, calls } = await host({ threads: [threadRow("thr_a")] });
  assert.equal((await call("page_reply", { threadId: "thr_a", text: "Retry once." })).outcome, "sent");
  assert.equal((calls("threads.send")[0].input as Row[])[0]?.text, "Retry once.");
  assert.equal((await call("page_mark_read", { threadId: "thr_a" })).outcome, "done");
  assert.equal((await call("page_archive", { threadId: "thr_a" })).outcome, "done");
  assert.equal((await call("page_retry", { threadId: "thr_a" })).outcome, "retrying");
  assert.equal((await call("page_stop", { threadId: "thr_a" })).outcome, "stopped");
  for (const path of ["threads.markRead", "threads.archive", "threads.retry", "threads.stop"]) {
    assert.equal(calls(path)[0]?.threadId, "thr_a", path);
  }
});

test("page: workers fold into one family card, and archiving takes only merged workers it listed", async () => {
  const { call, calls } = await host({
    threads: [
      threadRow("thr_dev6", { title: "Dev #6" }),
      threadRow("thr_w11", { parentThreadId: "thr_dev6", environmentId: "env_11", environmentIsWorktree: true }),
      threadRow("thr_w12", { parentThreadId: "thr_dev6", environmentId: "env_12", environmentIsWorktree: true }),
      threadRow("thr_w13", { parentThreadId: "thr_dev6", environmentId: "env_13", environmentIsWorktree: true }),
      threadRow("thr_other", { environmentId: "env_o", environmentIsWorktree: true }),
    ],
    prs: {
      env_11: prResponse("merged", 11),
      env_12: prResponse("merged", 12),
      env_13: prResponse("ready_to_merge", 13),
      env_o: prResponse("merged", 99),
    },
  });
  await call("page_snapshot");
  await settle();
  const page = await call("page_snapshot");
  const family = page.cards.find((c: any) => c.threadId === "thr_dev6");
  assert.ok(family, "the parent has a family card");
  assert.equal(family.lead, "workers");
  assert.equal(family.tier, "turn", "the worker ready to merge makes it your turn");
  assert.deepEqual(family.workers.map((w: any) => w.threadId).sort(), ["thr_w11", "thr_w12", "thr_w13"]);
  assert.equal(page.cards.filter((c: any) => c.parentThreadId === "thr_dev6").length, 0, "no worker stands alone");

  const result = await call("page_archive_workers", {
    parentThreadId: "thr_dev6",
    threadIds: ["thr_w11", "thr_w12", "thr_w13", "thr_other"],
  });
  assert.deepEqual(result, { archived: 2, skipped: 2 }, "not the unmerged worker, not another family's thread");
  assert.deepEqual(calls("threads.archive").map((args) => args.threadId).sort(), ["thr_w11", "thr_w12"]);
});

test("page: a reload stops the change feed and the pending signal, so nothing touches a stale handle", async () => {
  const errors: unknown[] = [];
  const onError = (error: unknown) => errors.push(error);
  process.on("uncaughtException", onError);
  try {
    const { harness, change, signals, unsubscribed } = await host();
    change("interactions-changed"); // a signal is pending when the reload lands
    await harness.lifecycle.dispose();
    assert.equal(unsubscribed(), 1, "the change feed is let go of");
    change("status-changed"); // a late delivery from the old subscription
    await settle();
    assert.deepEqual(errors, [], "no uncaught PluginContextStaleError from a timer");
    assert.equal(signals(), 0);
  } finally {
    process.off("uncaughtException", onError);
  }
});

test("page: a busy thread bb says is waiting stays on the page when its asks cannot be read", async () => {
  const { call, harness } = await host({
    threads: [threadRow("thr_stuck", { status: "active", hasPendingInteraction: true })],
  });
  harness.sdk.stub("threads.interactions.list", () => {
    throw new Error("interactions unavailable");
  });
  const page = await call("page_snapshot");
  assert.deepEqual(
    page.cards.map((c: any) => [c.threadId, c.tier, c.lead, c.asks[0]?.title]),
    [["thr_stuck", "blocked", "form", "Waiting on you in the thread"]],
  );
});

test("page: archived threads in the follow-ups lane are looked up at once, not one after another", async () => {
  const others = Object.fromEntries(
    [1, 2, 3, 4].map((n) => [`thr_arch${n}`, threadRow(`thr_arch${n}`, { archivedAt: 5 })]),
  );
  const { call, record, harness } = await host({ threads: [], others });
  for (const id of Object.keys(others)) await record(id, `Row on ${id}`);
  let active = 0;
  let most = 0;
  harness.sdk.stub("threads.get", async (args: { threadId: string }) => {
    active += 1;
    most = Math.max(most, active);
    await new Promise((resolve) => setTimeout(resolve, 20));
    active -= 1;
    return others[args.threadId];
  });
  const page = await call("page_snapshot");
  assert.equal(page.followUps[0]?.threads.length, 4);
  assert.ok(most > 1, `lookups overlapped (at most ${most} at once)`);
});

test("page: a PR card carries the thread's open follow-ups for the close-out", async () => {
  const { call, record } = await host({
    threads: [threadRow("thr_pr", { environmentId: "env_w", environmentIsWorktree: true })],
    prs: { env_w: prResponse("ready_to_merge") },
  });
  await record("thr_pr", "Split the worker", "out-of-scope");
  await call("page_snapshot");
  await settle();
  const page = await call("page_snapshot");
  assert.deepEqual(
    page.cards[0].followUps.map((r: any) => [r.text, r.lead]),
    [["Split the worker", "handoff"]],
  );
});

test("page: the sidebar's summary reads follow-ups only for threads where they can matter", async () => {
  const { call, record, harness, reads } = await host({
    threads: [
      threadRow("thr_quiet1"),
      threadRow("thr_quiet2"),
      threadRow("thr_unread", { latestAttentionAt: 300, lastReadAt: 100 }),
      threadRow("thr_goal"),
    ],
    outputs: { thr_unread: "Done.", thr_goal: "Shipped." },
  });
  for (const id of ["thr_quiet1", "thr_quiet2", "thr_unread", "thr_goal"]) await record(id, `Row on ${id}`);
  await harness.callAgentTool("offer_next_steps", { steps: [], goal_met: true }, { threadId: "thr_goal" });
  reads.length = 0;
  const summary = await call("page_summary");
  const itemReads = reads.filter((key) => key.startsWith("items:")).sort();
  assert.deepEqual(itemReads, ["items:thr_goal", "items:thr_unread"], "not the quiet threads' rows");
  const byId = new Map(summary.top.map((c: any) => [c.threadId, c]));
  assert.equal((byId.get("thr_goal") as any)?.lead, "wrap-up", "a met goal still finds its open rows");
  const page = await call("page_snapshot");
  const finished = page.cards.find((c: any) => c.threadId === "thr_unread");
  assert.deepEqual(finished?.followUps.map((r: any) => r.text), ["Row on thr_unread"], "a card still lists its rows");
});
