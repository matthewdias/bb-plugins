import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeServer, pairingLink } from "../lib/pair.ts";
import { buildFeed, LIMITS, type PendingInteraction, type ThreadRow } from "../lib/snapshot.ts";

let seq = 0;
function thread(overrides: Partial<ThreadRow> = {}): ThreadRow {
  seq += 1;
  return {
    id: `thr_${seq}`,
    projectId: "proj_a",
    title: `Thread ${seq}`,
    status: "idle",
    visibility: "visible",
    archivedAt: null,
    deletedAt: null,
    hasPendingInteraction: false,
    latestAttentionAt: 100,
    lastReadAt: 100,
    updatedAt: 100,
    runtime: { displayStatus: "idle" },
    ...overrides,
  };
}

function feed(threads: ThreadRow[], pending: Record<string, PendingInteraction> = {}) {
  return buildFeed({
    threads,
    pending: new Map(Object.entries(pending)),
    projectNames: new Map([["proj_a", "Alpha"]]),
    actionsAllowed: false,
    now: 1,
  });
}

test("needs-me ranks error, then interaction, then unread, newest attention first", () => {
  const unreadOld = thread({ latestAttentionAt: 200, lastReadAt: 100 });
  const unreadNew = thread({ latestAttentionAt: 300, lastReadAt: 100 });
  const asking = thread({ status: "active", hasPendingInteraction: true, latestAttentionAt: 50 });
  const failed = thread({ status: "error", latestAttentionAt: 10 });
  const result = feed([unreadOld, unreadNew, asking, failed], {
    [asking.id]: { label: "Question for you", detail: "Which DB?" },
  });
  assert.deepEqual(
    result.needsMe.items.map((item) => [item.threadId, item.state]),
    [
      [failed.id, "error"],
      [asking.id, "interaction"],
      [unreadNew.id, "unread"],
      [unreadOld.id, "unread"],
    ],
  );
  assert.equal(result.needsMe.items[1]?.detail, "Which DB?");
});

test("a runtime error counts even when the status lags", () => {
  const lagging = thread({ status: "active", runtime: { displayStatus: "error" } });
  assert.equal(feed([lagging]).needsMe.items[0]?.state, "error");
});

test("running excludes a thread that is waiting on you", () => {
  const working = thread({ status: "active" });
  const asking = thread({ status: "active", hasPendingInteraction: true });
  const result = feed([working, asking], { [asking.id]: { label: "Needs approval" } });
  assert.deepEqual(result.running.items.map((item) => item.threadId), [working.id]);
  assert.equal(result.needsMe.total, 1);
});

test("read, hidden, archived and deleted threads never need you", () => {
  const result = feed([
    thread({ latestAttentionAt: 100, lastReadAt: 100 }),
    thread({ status: "error", visibility: "hidden" }),
    thread({ status: "error", archivedAt: 5 }),
    thread({ status: "error", deletedAt: 5 }),
  ]);
  assert.equal(result.needsMe.total, 0);
  assert.equal(result.recent.items.length, 1);
});

test("an unread thread that never had a read stamp still needs you", () => {
  assert.equal(feed([thread({ latestAttentionAt: 5, lastReadAt: null })]).needsMe.total, 1);
});

test("totals count everything while items stay capped", () => {
  const many = Array.from({ length: LIMITS.needsMe + 5 }, () => thread({ status: "error" }));
  const result = feed(many);
  assert.equal(result.needsMe.total, LIMITS.needsMe + 5);
  assert.equal(result.needsMe.items.length, LIMITS.needsMe);
  assert.equal(result.recent.items.length, LIMITS.recent);
});

test("items carry the project name, a fallback title and a joinable path", () => {
  const untitled = thread({ title: null, titleFallback: "/plan a widget" });
  const [item] = feed([untitled]).recent.items;
  assert.equal(item?.title, "/plan a widget");
  assert.equal(item?.projectName, "Alpha");
  assert.equal(item?.path, `/projects/proj_a/threads/${untitled.id}`);
});

test("the version ignores generatedAt but moves with anything a client renders", () => {
  const threads = [thread({ status: "error" })];
  const base = { pending: new Map(), projectNames: new Map(), actionsAllowed: false };
  const a = buildFeed({ ...base, threads, now: 1 });
  const b = buildFeed({ ...base, threads, now: 2 });
  assert.equal(a.version, b.version);
  assert.notEqual(buildFeed({ ...base, threads, now: 1, actionsAllowed: true }).version, a.version);
  assert.notEqual(
    buildFeed({ ...base, threads: [{ ...threads[0]!, title: "Renamed" }], now: 1 }).version,
    a.version,
  );
});

test("pairing accepts any http(s) base URL and drops a trailing slash", () => {
  assert.equal(normalizeServer("https://me.getbb.app/"), "https://me.getbb.app");
  assert.equal(normalizeServer(" https://mac.tailnet.ts.net:38886 "), "https://mac.tailnet.ts.net:38886");
  assert.equal(normalizeServer("ftp://x"), null);
  assert.equal(normalizeServer("https://x/?a=1"), null);
  assert.equal(normalizeServer("not a url"), null);
});

test("the pairing link round-trips server and token", () => {
  const link = new URL(pairingLink("https://me.getbb.app", "t+k/=n"));
  assert.equal(link.protocol, "glance:");
  assert.equal(link.searchParams.get("server"), "https://me.getbb.app");
  assert.equal(link.searchParams.get("token"), "t+k/=n");
});
