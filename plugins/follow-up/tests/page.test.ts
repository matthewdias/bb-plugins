// The rules behind the Follow Up page: which threads get a card, in which
// tier, in what order, what the sidebar counts, and how the follow-ups lane is
// grouped. Every bb fact arrives as plain data, so none of this needs a host.
import assert from "node:assert/strict";
import test from "node:test";
import {
  activityLabel,
  approvalDetail,
  approvalResolution,
  fileChangesFor,
  hasUnseen,
  PATCH_FILES_MAX,
  PATCH_MAX,
  asksFor,
  parsePutAway,
  prKey,
  capFinished,
  cardFor,
  combineFamilies,
  foldRunning,
  mergedWorkers,
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
  reveal,
  reviewPrompt,
  threadFacts,
  type Card,
  type PendingAsk,
  type PrSummary,
  type ThreadFacts,
  type ThreadInputs,
} from "../lib/page.ts";
import { makeForm } from "../lib/ask.ts";
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
  createdAt: 100,
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
  hidden: null,
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
    createdAt: 3,
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
    createdAt: 3,
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
    decisions: [],
    reason: null,
    detail: { kind: "command", command: "git push\n  --force", cwd: null, actions: [], sessionGrant: null },
    unseen: false,
    held: "It offers no choice the page can make.",
  });
  const plan = pendingAsk({
    id: "i",
    status: "pending",
    payload: { kind: "approval", subject: { kind: "plan", plan: "\n## Offline queue\n1. Store" } },
  });
  assert.equal(plan?.kind === "approval" ? plan.summary : null, "Offline queue");
});

// --- approvals in place ------------------------------------------------------

const approval = (subject: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id: "int_a",
  status: "pending",
  createdAt: 5,
  payload: { kind: "approval", availableDecisions: ["allow_once", "allow_for_session", "deny"], reason: null, subject, ...extra },
});

const sessionGrant = { fileSystem: { read: ["/repo"], write: ["/repo"] }, network: { enabled: true } };

test("pendingAsk: an approval carries its choices, in bb's order, and why the agent asked", () => {
  const ask = pendingAsk(approval({ kind: "command", command: "npm test" }, { availableDecisions: ["deny", "allow_once"], reason: " Run the suite " }));
  assert.equal(ask?.kind, "approval");
  if (ask?.kind !== "approval") return;
  assert.deepEqual(ask.decisions, ["allow_once", "deny"]);
  assert.equal(ask.reason, "Run the suite");
});

test("pendingAsk: an approval offers only the choices bb lists, so one listing none offers none", () => {
  for (const availableDecisions of [undefined, [], ["approve", "allow_always"]]) {
    const ask = pendingAsk(approval({ kind: "command", command: "rm -rf build" }, { availableDecisions }));
    assert.deepEqual(ask?.kind === "approval" ? ask.decisions : null, [], JSON.stringify(availableDecisions));
  }
});

test("reveal: a character that draws nothing is shown as its code; newlines, tabs and emoji are kept", () => {
  assert.equal(reveal("echo \u202Etxt.exe"), "echo ⟦U+202E⟧txt.exe");
  assert.equal(reveal("rm -rf /tmp/a\u200B /"), "rm -rf /tmp/a⟦U+200B⟧ /");
  assert.equal(reveal("cat \u2066x\u2069"), "cat ⟦U+2066⟧x⟦U+2069⟧");
  assert.equal(reveal("a\u0007b"), "a⟦U+0007⟧b");
  assert.equal(reveal("one\n\ttwo"), "one\n\ttwo");
  assert.equal(reveal("⚠️ 👨‍👩‍👧 ❤️‍🔥"), "⚠️ 👨‍👩‍👧 ❤️‍🔥");
  // A selector or joiner with no emoji to belong to is shown.
  assert.equal(reveal("rm\uFE0F x\u200Dy"), "rm⟦U+FE0F⟧ x⟦U+200D⟧y");
  assert.equal(hasUnseen({ a: [{ b: "ok" }, "fine ⚠️"] }), false);
  assert.equal(hasUnseen({ a: [{ b: "x\u202Ey" }] }), true);
});

test("pendingAsk: what an approval shows can't hide behind characters that don't draw", () => {
  const hidden = "\u202E";
  const ask = pendingAsk(
    approval(
      { kind: "command", command: `ls ${hidden}gpj.sh`, cwd: `/repo${hidden}`, actions: [{ type: "read", name: `a${hidden}.ts`, path: "/a.ts" }], sessionGrant: { fileSystem: { read: [`/r${hidden}`], write: [] }, network: null } },
      { reason: `fine${hidden}` },
    ),
  );
  assert.equal(ask?.kind, "approval");
  if (ask?.kind !== "approval" || ask.detail.kind !== "command") return;
  assert.equal(ask.unseen, true);
  assert.equal(ask.summary, "ls ⟦U+202E⟧gpj.sh");
  assert.equal(ask.reason, "fine⟦U+202E⟧");
  assert.equal(ask.detail.command, "ls ⟦U+202E⟧gpj.sh");
  assert.equal(ask.detail.cwd, "/repo⟦U+202E⟧");
  assert.deepEqual(ask.detail.actions, ["Reads a⟦U+202E⟧.ts"]);
  assert.deepEqual(ask.detail.sessionGrant?.read, ["/r⟦U+202E⟧"]);
  // The subject alone is enough to warn, and so is the reason alone.
  const what = pendingAsk(approval({ kind: "tool_use", tool: "Bash", presentation: { title: `Tidy${hidden}` } }));
  assert.equal(what?.kind === "approval" ? what.unseen : null, true);
  const why = pendingAsk(approval({ kind: "command", command: "ls" }, { reason: `a\u200Bb` }));
  assert.equal(why?.kind === "approval" ? why.unseen : null, true);
  const clean = pendingAsk(approval({ kind: "plan", plan: "## Plan ✅\n- ship ⚠️" }));
  assert.equal(clean?.kind === "approval" ? clean.unseen : null, false);
  // What is granted is still exactly what bb asked for, never the shown form.
  assert.deepEqual(approvalResolution(approval({ kind: "command", command: "x", sessionGrant: { fileSystem: { read: [`/r${hidden}`], write: [] }, network: null } }), "allow_for_session"), {
    decision: "allow_for_session",
    grantedPermissions: { fileSystem: { read: [`/r${hidden}`], write: [] }, network: null },
  });
});

test("approvalDetail: a tool, a permission and a plan show unseen characters too", () => {
  const z = "\u200B";
  assert.deepEqual(
    approvalDetail({ kind: "tool_use", tool: `rm${z}`, presentation: { title: `Tidy${z}`, detail: `rm -rf ${z}/`, badge: { tone: "neutral", label: `Safe${z}` } } }),
    { kind: "tool_use", tool: "rm⟦U+200B⟧", title: "Tidy⟦U+200B⟧", detail: "rm -rf ⟦U+200B⟧/", destructive: false, badge: "Safe⟦U+200B⟧" },
  );
  assert.deepEqual(
    approvalDetail({ kind: "permission_grant", toolName: `Bash${z}`, permissions: { fileSystem: { read: [], write: [`/etc${z}`] }, network: null } }),
    { kind: "permission_grant", toolName: "Bash⟦U+200B⟧", asked: { read: [], write: ["/etc⟦U+200B⟧"], network: false } },
  );
  assert.deepEqual(approvalDetail({ kind: "plan", plan: `Step${z}`, planFilePath: `/p${z}.md` }), { kind: "plan", plan: "Step⟦U+200B⟧", planFilePath: "/p⟦U+200B⟧.md" });
});

test("approvalDetail: each kind shows what bb's card shows", () => {
  assert.deepEqual(
    approvalDetail({
      kind: "command",
      command: "rg TODO src",
      cwd: "/repo",
      actions: [{ type: "search", query: "TODO", path: "src", command: "rg" }, { type: "read", name: "a.ts", path: "/a.ts", command: "cat" }, { type: "unknown", command: "x" }],
      sessionGrant,
    }),
    { kind: "command", command: "rg TODO src", cwd: "/repo", actions: ['Searches for "TODO" in src', "Reads a.ts"], sessionGrant: { read: ["/repo"], write: ["/repo"], network: true } },
  );
  assert.deepEqual(
    approvalDetail({ kind: "permission_grant", toolName: "Bash", permissions: { fileSystem: { read: ["/notes"], write: [] }, network: null } }),
    { kind: "permission_grant", toolName: "Bash", asked: { read: ["/notes"], write: [], network: false } },
  );
  assert.deepEqual(approvalDetail({ kind: "plan", plan: "## Plan", planFilePath: null }), { kind: "plan", plan: "## Plan", planFilePath: null });
  assert.deepEqual(
    approvalDetail({ kind: "tool_use", tool: "rm", presentation: { title: "Delete cache", detail: "rm -rf .cache", badge: { tone: "destructive", label: "Destructive" } } }),
    { kind: "tool_use", tool: "rm", title: "Delete cache", detail: "rm -rf .cache", destructive: true, badge: "Destructive" },
  );
  assert.equal(approvalDetail({ kind: "file_change", itemId: "it_1", writeScope: "/repo", sessionGrant: null }).kind, "file_change");
});

test("approvalResolution: deny sends only the decision", () => {
  assert.deepEqual(approvalResolution(approval({ kind: "command", command: "x", sessionGrant }), "deny"), { decision: "deny" });
});

test("approvalResolution: a command sends its session grant only for Allow for session", () => {
  const command = approval({ kind: "command", command: "x", sessionGrant });
  assert.deepEqual(approvalResolution(command, "allow_once"), { decision: "allow_once", grantedPermissions: null });
  assert.deepEqual(approvalResolution(command, "allow_for_session"), { decision: "allow_for_session", grantedPermissions: sessionGrant });
  const change = approval({ kind: "file_change", itemId: "i", writeScope: null, sessionGrant });
  assert.deepEqual(approvalResolution(change, "allow_for_session"), { decision: "allow_for_session", grantedPermissions: sessionGrant });
});

test("approvalResolution: a permission grant sends its own permissions, normalized, either way", () => {
  const grant = approval({ kind: "permission_grant", toolName: null, permissions: { fileSystem: { read: ["/a"], write: ["/b"] }, network: { enabled: false } } });
  const expected = { network: null, fileSystem: { read: ["/a"], write: ["/b"] } };
  assert.deepEqual(approvalResolution(grant, "allow_once"), { decision: "allow_once", grantedPermissions: expected });
  assert.deepEqual(approvalResolution(grant, "allow_for_session"), { decision: "allow_for_session", grantedPermissions: expected });
  const network = approval({ kind: "permission_grant", toolName: null, permissions: { fileSystem: null, network: { enabled: true } } });
  assert.deepEqual(approvalResolution(network, "allow_once"), { decision: "allow_once", grantedPermissions: { network: { enabled: true }, fileSystem: null } });
});

test("approvalResolution: a plan or a tool sends no grant", () => {
  assert.deepEqual(approvalResolution(approval({ kind: "plan", plan: "p" }), "allow_once"), { decision: "allow_once", grantedPermissions: null });
  assert.deepEqual(approvalResolution(approval({ kind: "tool_use", tool: "t" }), "allow_for_session"), { decision: "allow_for_session", grantedPermissions: null });
});

const started = (id: string, changes: unknown[]) => ({ type: "item/started", data: { item: { id, type: "fileChange", changes } } });

test("fileChangesFor: finds the approval's item among the thread's events, whole", () => {
  const events = [started("other", [{ path: "/x", kind: "add", diff: "+x" }]), started("it_1", [{ path: "/a.ts", kind: "update", diff: "@@ -1 +1 @@\n-a\n+b" }, { path: "/gone.ts", kind: "delete" }, { path: "/b.ts", kind: "update", movePath: "/c.ts", diff: "" }])];
  assert.deepEqual(fileChangesFor("it_1", events), {
    files: [
      { path: "/a.ts", change: "update", movedTo: null, patch: "@@ -1 +1 @@\n-a\n+b", cut: false, unseen: false },
      { path: "/gone.ts", change: "delete", movedTo: null, patch: "", cut: false, unseen: false },
      { path: "/b.ts", change: "update", movedTo: "/c.ts", patch: "", cut: false, unseen: false },
    ],
    whole: true,
  });
  assert.equal(fileChangesFor("missing", events), null);
});

test("fileChangesFor: anything it can't carry whole says so", () => {
  const whole = (changes: unknown[]) => fileChangesFor("it", [started("it", changes)])?.whole;
  const file = (n: number) => ({ path: `/f${n}.ts`, kind: "add", diff: "+x" });
  assert.equal(whole(Array.from({ length: PATCH_FILES_MAX }, (_, n) => file(n))), true);
  assert.equal(whole(Array.from({ length: PATCH_FILES_MAX + 1 }, (_, n) => file(n))), false, "more files than it carries");
  assert.equal(whole([{ path: "/big.ts", kind: "add", diff: "x".repeat(PATCH_MAX + 1) }]), false, "a diff past the limit");
  assert.equal(whole([file(1), { kind: "add", diff: "+x" }]), false, "a file with no path");
  assert.equal(whole([{ path: "/a.ts", diff: "+x" }]), false, "a change of no kind");
  assert.equal(whole([{ path: "/a.ts", kind: "update" }]), false, "an edit without its diff");
  assert.equal(whole([{ path: "/a.ts", kind: "update", diff: "", movePath: 7 }]), false, "a move to somewhere unreadable");
  assert.equal(whole([]), false, "nothing to show");
  const big = fileChangesFor("it", [started("it", [{ path: "/big.ts", kind: "add", diff: "x".repeat(PATCH_MAX + 5) }])]);
  assert.equal(big?.files[0]?.patch.length, PATCH_MAX);
  assert.equal(big?.files[0]?.cut, true);
  const sly = fileChangesFor("it_2", [started("it_2", [{ path: "/a\u202E.ts", kind: "update", diff: "+ok" }, { path: "/b.ts", kind: "add", diff: "+x\u200By" }, { path: "/c.ts", kind: "update", diff: "", movePath: "/d\u2066.ts" }])]);
  assert.deepEqual(
    sly?.files.map(({ path, movedTo, patch, unseen }) => ({ path, movedTo, patch, unseen })),
    [
      { path: "/a⟦U+202E⟧.ts", movedTo: null, patch: "+ok", unseen: true },
      { path: "/b.ts", movedTo: null, patch: "+x⟦U+200B⟧y", unseen: true },
      { path: "/c.ts", movedTo: "/d⟦U+2066⟧.ts", patch: "", unseen: true },
    ],
  );
});

test("pendingAsk: a file change is answerable only with its whole diff in hand", () => {
  const change = approval({ kind: "file_change", itemId: "it", writeScope: "/repo", sessionGrant: null });
  const held = (ask: PendingAsk | null) => (ask?.kind === "approval" ? { held: ask.held, decisions: ask.decisions } : null);
  assert.deepEqual(held(pendingAsk(change)), { held: "Its diff couldn't be read here.", decisions: [] }, "no events read");
  assert.deepEqual(held(pendingAsk(change, [])), { held: "Its diff couldn't be read here.", decisions: [] }, "its item not among them");
  assert.deepEqual(held(pendingAsk(change, [started("it", [{ path: "/a", kind: "add", diff: "x".repeat(PATCH_MAX + 1) }])])), {
    held: "Its change is too big to show whole here.",
    decisions: [],
  });
  const ok = pendingAsk(change, [started("it", [{ path: "/a", kind: "add", diff: "+a\u200B" }])]);
  assert.deepEqual(held(ok), { held: null, decisions: ["allow_once", "allow_for_session", "deny"] });
  assert.equal(ok?.kind === "approval" && ok.detail.kind === "file_change" ? ok.detail.files.length : null, 1);
  assert.equal(ok?.kind === "approval" ? ok.unseen : null, true, "an unseen character in the diff warns");
});

test("pendingAsk: an approval whose card would show nothing to approve is held", () => {
  const heldOf = (subject: Record<string, unknown>) => {
    const ask = pendingAsk(approval(subject));
    return ask?.kind === "approval" ? [ask.held, ask.decisions.length] : null;
  };
  assert.deepEqual(heldOf({ kind: "command", command: "  " }), ["Its command couldn't be read here.", 0]);
  assert.deepEqual(heldOf({ kind: "command", command: ["rm", "-rf", "/"] }), ["Its command couldn't be read here.", 0]);
  assert.deepEqual(heldOf({ kind: "plan", plan: "" }), ["Its plan couldn't be read here.", 0]);
  assert.deepEqual(heldOf({ kind: "tool_use", presentation: { title: "Harmless" } }), ["Its tool couldn't be read here.", 0]);
  assert.deepEqual(heldOf({ kind: "command", command: "ls" }), [null, 3]);
});

test("pendingAsk: a grant the card can't list whole is never sent from the page", () => {
  const real = { network: { enabled: null }, fileSystem: { read: ["/repo"], write: [] } };
  const decisions = (subject: Record<string, unknown>) => {
    const ask = pendingAsk(approval(subject));
    return ask?.kind === "approval" ? ask.decisions : null;
  };
  // bb's own shape is listed whole, so every choice stays.
  assert.deepEqual(decisions({ kind: "command", command: "ls", sessionGrant: real }), ["allow_once", "allow_for_session", "deny"]);
  assert.deepEqual(decisions({ kind: "permission_grant", toolName: null, permissions: real }), ["allow_once", "allow_for_session", "deny"]);
  assert.deepEqual(decisions({ kind: "permission_grant", toolName: null, permissions: null }), ["allow_once", "allow_for_session", "deny"]);
  // Anything more: a session grant loses Allow for session; a permission
  // grant, which sends its permissions with any allow, goes to the thread.
  for (const unlisted of [
    { ...real, macos: { accessibility: true } },
    { network: { enabled: true, proxy: "x" }, fileSystem: null },
    { network: { enabled: "yes" }, fileSystem: null },
    { network: null, fileSystem: { read: ["/repo", { path: "/" }], write: [] } },
    { network: null, fileSystem: { read: [], write: "/" } },
    { network: null, fileSystem: { read: [], write: [], execute: ["/"] } },
    "everything",
  ]) {
    assert.deepEqual(decisions({ kind: "command", command: "ls", sessionGrant: unlisted }), ["allow_once", "deny"], JSON.stringify(unlisted));
    assert.deepEqual(decisions({ kind: "permission_grant", toolName: null, permissions: unlisted }), [], JSON.stringify(unlisted));
  }
  const held = pendingAsk(approval({ kind: "permission_grant", toolName: null, permissions: { ...real, extra: 1 } }));
  assert.equal(held?.kind === "approval" ? held.held : null, "It asks for more than the page can list.");
});

test("pendingAsk: a kind it cannot read is a form, so the thread still shows as blocked", () => {
  const ask = pendingAsk({ id: "i", status: "pending", createdAt: 2, payload: { kind: "plugin", title: "Grill round" } });
  assert.deepEqual(ask, { kind: "form", interactionId: "i", createdAt: 2, title: "Grill round" });
  assert.equal(pendingAsk({ id: "i", status: "pending" })?.kind, "form");
});

test("asksFor: a thread bb flags as waiting gets a generic ask when none could be read", () => {
  const waiting = thread({ hasPendingInteraction: true, updatedAt: 42 });
  assert.deepEqual(asksFor(waiting, []), [
    { kind: "form", interactionId: "", createdAt: 42, title: "Waiting on you in the thread" },
  ]);
  assert.deepEqual(asksFor(waiting, [question(7)]).map((ask) => ask.kind), ["question"]);
  assert.deepEqual(asksFor(thread(), []), [], "nothing invented for a thread bb says is not waiting");
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
  assert.equal(card.pageUrl, "/api/v1/plugins/thread-pages/http/page?session=thr_a");
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

test("cardFor: Not now puts a card away until something new happens on the thread", () => {
  const base = { offer: { steps: ["Go"], goalMet: false, offeredAt: "x" } };
  assert.equal(cardFor(inputs({ ...base, hidden: { at: 100, pr: null } }))?.putAway, true);
  assert.equal(cardFor(inputs({ ...base, hidden: { at: 99, pr: null } }))?.putAway, false, "newer attention brings it back");
  assert.equal(cardFor(inputs(base))?.putAway, false);
});

test("cardFor: Not now cannot put away a blocked thread", () => {
  const card = cardFor(inputs({ asks: [question(1)], hidden: { at: 1_000 } }));
  assert.equal(card?.tier, "blocked");
  assert.equal(card?.putAway, false);
});

test("cardFor: a change to the thread's PR brings a put-away card back", () => {
  const at = { at: 100, pr: "44:ready_to_merge" };
  assert.equal(cardFor(inputs({ pr: pr("ready_to_merge"), hidden: at }))?.putAway, true, "same PR state: still away");
  assert.equal(cardFor(inputs({ pr: pr("checks_failed"), hidden: at }))?.putAway, false, "checks failed: back");
  assert.equal(cardFor(inputs({ pr: pr("merged"), hidden: at }))?.putAway, false, "merged: back");
  const finished = { thread: thread({ latestAttentionAt: 100, lastReadAt: 0 }), reply: "Done." };
  assert.equal(cardFor(inputs({ ...finished, hidden: { at: 100, pr: null } }))?.putAway, true);
  assert.equal(cardFor(inputs({ ...finished, pr: pr("review_requested"), hidden: { at: 100, pr: null } }))?.putAway, false, "a PR appearing: back");
});

test("cardFor: a record from before PR changes counted only ends with new attention", () => {
  assert.equal(cardFor(inputs({ pr: pr("checks_failed"), hidden: { at: 100 } }))?.putAway, true);
});

test("parsePutAway and prKey: both record forms, and the PR state compared", () => {
  assert.deepEqual(parsePutAway(300), { at: 300 });
  assert.deepEqual(parsePutAway({ at: 300, pr: "44:merged" }), { at: 300, pr: "44:merged" });
  assert.deepEqual(parsePutAway({ at: 300, pr: null }), { at: 300, pr: null });
  assert.equal(parsePutAway("nonsense"), null);
  assert.equal(prKey(pr("checks_failed")), "44:checks_failed");
  assert.equal(prKey(null), null);
});

test("cardFor: a card carries its thread's open follow-ups, with their lead actions", () => {
  const c = must(
    cardFor(inputs({ pr: pr("ready_to_merge"), openFollowUps: 2, rows: [row("a", "risk"), row("b", "out-of-scope", { sentAt: "x" })] })),
  );
  assert.deepEqual(c.followUps, [
    { id: "a", text: "Row a", reason: "risk", lead: "do", inProgress: false },
    { id: "b", text: "Row b", reason: "out-of-scope", lead: "handoff", inProgress: true },
  ]);
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

test("cardFor: a form the agent asked with is your turn, ahead of what the thread merely offers", () => {
  const made = makeForm("Offline queue", [{ type: "item", id: "issue-1", title: "#1", choices: [{ label: "Close it" }, { label: "Leave open" }] }], "2026-10-09T12:00:00.000Z");
  if (!made.ok) throw new Error(made.problem);
  const offer = { steps: ["Go"], goalMet: true, offeredAt: "x" };
  const card = must(cardFor(inputs({ form: made.form, offer, openFollowUps: 2 })));
  assert.deepEqual([card.tier, card.lead], ["turn", "ask"]);
  assert.deepEqual(card.form, made.form);
  assert.equal(must(cardFor(inputs({ form: made.form, thread: thread({ status: "error" }) }))).lead, "stopped", "a failed turn still leads");
  assert.equal(must(cardFor(inputs({ form: made.form, asks: [question(5)] }))).lead, "question", "and so does a stopped agent");
  // Read, idle, nothing else: the form alone is the card.
  assert.equal(must(cardFor(inputs({ form: made.form, thread: thread({ lastReadAt: 99, latestAttentionAt: 10 }) }))).lead, "ask");
  // A form with everything on it answered is no card of its own.
  const spent = { ...made.form, done: { "issue-1": "Close it" } };
  const after = must(cardFor(inputs({ form: spent, offer: { ...offer, goalMet: false } })));
  assert.deepEqual([after.lead, after.form], ["next", null]);
  assert.equal(cardFor(inputs({ form: made.form, thread: thread({ status: "active" }) })), null, "a working thread is not asked about");
});

test("cardFor: a checklist that stopped is your turn, after a form and ahead of an offer", () => {
  const checklist = { id: "cl_1", name: "Ship issue", status: "paused" as const, done: 1, total: 3, next: "Plan", note: null, noteCut: false, error: null };
  const offer = { steps: ["Go"], goalMet: true, offeredAt: "x" };
  const read = thread({ lastReadAt: 99, latestAttentionAt: 10 });
  const card = must(cardFor(inputs({ checklist, offer, openFollowUps: 2, thread: read })));
  assert.deepEqual([card.tier, card.lead, card.checklist], ["turn", "checklist", checklist]);
  const made = makeForm("T", [{ type: "item", id: "i", title: "I", choices: [{ label: "A" }] }], "2026-10-09T12:00:00.000Z");
  if (!made.ok) throw new Error(made.problem);
  assert.equal(must(cardFor(inputs({ checklist, form: made.form }))).lead, "ask");
  assert.equal(must(cardFor(inputs({ checklist, thread: thread({ status: "error" }) }))).lead, "stopped");
  assert.equal(must(cardFor(inputs({ checklist: null, offer }))).checklist, null);
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

test("prOwners: one thread per worktree, the one that opened it, and no shared checkouts", () => {
  const owners = prOwners([
    thread({ id: "later", environmentId: "env_w", environmentIsWorktree: true, createdAt: 5 }),
    thread({ id: "opener", environmentId: "env_w", environmentIsWorktree: true, createdAt: 1 }),
    thread({ id: "shared", environmentId: "env_s", environmentIsWorktree: false, createdAt: 1 }),
    thread({ id: "gone", environmentId: "env_g", environmentIsWorktree: true, archived: true }),
  ]);
  assert.deepEqual([...owners], [["env_w", "opener"]]);
});

test("prOwners: a newer, busier review thread in the same worktree does not take the PR", () => {
  const owners = prOwners([
    thread({ id: "author", environmentId: "env_w", environmentIsWorktree: true, createdAt: 1, updatedAt: 1000 }),
    thread({ id: "review", environmentId: "env_w", environmentIsWorktree: true, createdAt: 2, updatedAt: 2000 }),
  ]);
  assert.equal(owners.get("env_w"), "author");
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
  const path = "/api/v1/plugins/thread-pages/http/page?session=thr_a";
  const own = `https://h${path}`;
  const other = "https://h/api/v1/plugins/thread-pages/http/page?session=thr_b";
  assert.equal(pageLinkIn(`See ${other} and [here](${own})`, "thr_a"), path);
  assert.equal(pageLinkIn(other, "thr_a"), null);
  assert.equal(pageLinkIn(path, "thr_a"), path);
  assert.equal(pageLinkIn(null, "thr_a"), null);
});

test("pageLinkIn: never hands back the host a reply wrote, only bb's own path", () => {
  const phish = "https://evil.example/api/v1/plugins/thread-pages/http/page?session=thr_a&x=1";
  assert.equal(pageLinkIn(`[Open the Thread Page](${phish})`, "thr_a"), "/api/v1/plugins/thread-pages/http/page?session=thr_a");
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

// --- families ------------------------------------------------------------------

const fam = (id: string, parentThreadId: string | null, extra: Partial<ThreadFacts> = {}) =>
  thread({ id, parentThreadId, title: `T ${id}`, ...extra });

const famCard = (id: string, parent: string | null, tier: Card["tier"], since: number, extra: Partial<Card> = {}): Card => ({
  ...card(id, tier, since),
  parentThreadId: parent,
  ...extra,
});

test("combineFamilies: a worker folds into its parent's card, which takes the more urgent tier", () => {
  const threads = [fam("p", null), fam("w1", "p"), fam("w2", "p")];
  const combined = combineFamilies(
    [famCard("p", null, "finished", 10), famCard("w1", "p", "turn", 30), famCard("w2", "p", "finished", 20)],
    threads,
  );
  assert.equal(combined.length, 1);
  assert.equal(combined[0]?.threadId, "p");
  assert.equal(combined[0]?.tier, "turn", "a worker's turn makes the family your turn");
  assert.equal(combined[0]?.since, 30);
  assert.deepEqual(combined[0]?.workers.map((w) => w.threadId), ["w1", "w2"]);
  assert.equal(countOf(combined), 1, "a family counts once");
});

test("combineFamilies: the family card keeps the parent's own attention mark", () => {
  // Parent unread and asking nothing at 300; a worker with steps at 200.
  const threads = [fam("p", null, { latestAttentionAt: 300 }), fam("w", "p", { latestAttentionAt: 200 })];
  const parent = famCard("p", null, "finished", 300, { attentionAt: 300 });
  const worker = famCard("w", "p", "turn", 200, { attentionAt: 200 });
  const [family] = combineFamilies([parent, worker], threads);
  assert.equal(family?.since, 200, "the family sorts by its turn");
  assert.equal(family?.attentionAt, 300, "but Not now hides the parent at its own mark");
});

test("combineFamilies: a parent with no card of its own carries its own attention mark", () => {
  const [family] = combineFamilies(
    [famCard("w", "p", "turn", 50)],
    [fam("p", null, { latestAttentionAt: 70 }), fam("w", "p")],
  );
  assert.equal(family?.attentionAt, 70);
});

test("combineFamilies: a blocked worker keeps its own card", () => {
  const threads = [fam("p", null), fam("w1", "p"), fam("w2", "p")];
  const combined = combineFamilies(
    [famCard("w1", "p", "blocked", 5), famCard("w2", "p", "turn", 30)],
    threads,
  );
  assert.deepEqual(combined.map((c) => [c.threadId, c.lead === "workers"]).sort(), [["p", true], ["w1", false]]);
  assert.equal(countOf(combined), 2, "a family and a blocked worker");
});

test("combineFamilies: a parent with nothing to ask gets a card led by its workers", () => {
  const threads = [fam("p", null, { status: "active" }), fam("w1", "p"), fam("w2", "p")];
  const combined = combineFamilies([famCard("w1", "p", "finished", 10), famCard("w2", "p", "finished", 40)], threads);
  assert.equal(combined.length, 1);
  assert.deepEqual([combined[0]?.lead, combined[0]?.tier, combined[0]?.since, combined[0]?.title], ["workers", "finished", 40, "T p"]);
});

test("combineFamilies: a worker whose parent is not open stands alone", () => {
  const combined = combineFamilies([famCard("w1", "gone", "turn", 10)], [fam("w1", "gone")]);
  assert.deepEqual(combined.map((c) => [c.threadId, c.workers.length]), [["w1", 0]]);
});

test("combineFamilies: a worker's worker folds into the topmost open ancestor", () => {
  const threads = [fam("root", null), fam("mid", "root"), fam("leaf", "mid")];
  const combined = combineFamilies([famCard("leaf", "mid", "turn", 10)], threads);
  assert.deepEqual(combined.map((c) => [c.threadId, c.workers.map((w) => w.threadId)]), [["root", ["leaf"]]]);
});

test("mergedWorkers: only workers whose pull request merged", () => {
  const merged = { ...pr("merged"), action: "merged" as const };
  const ready = { ...pr("ready_to_merge"), action: "merge" as const };
  const family = combineFamilies(
    [famCard("w1", "p", "finished", 1, { lead: "pr", pr: merged }), famCard("w2", "p", "turn", 2, { lead: "pr", pr: ready })],
    [fam("p", null), fam("w1", "p"), fam("w2", "p")],
  )[0];
  assert.deepEqual(family && mergedWorkers(family).map((w) => w.threadId), ["w1"]);
});

test("foldRunning: running workers fold under their parent's row, or a row made for an idle parent", () => {
  const row = (threadId: string, startedAt: number | null) => ({
    threadId, title: `T ${threadId}`, projectId: "prj_1", status: "active", startedAt, now: "Working", openFollowUps: 0, doneFollowUps: 0,
  });
  const threads = [fam("busy", null, { status: "active" }), fam("b1", "busy"), fam("idle", null), fam("i1", "idle"), fam("i2", "idle"), fam("solo", "gone")];
  const folded = foldRunning([row("busy", 1), row("b1", 2), row("i1", 30), row("i2", 20), row("solo", 5)], threads);
  const byId = new Map(folded.map((r) => [r.threadId, r]));
  assert.deepEqual([...byId.keys()].sort(), ["busy", "idle", "solo"]);
  assert.deepEqual(byId.get("busy")?.workers.map((w) => w.threadId), ["b1"]);
  assert.equal(byId.get("idle")?.now, "2 workers running");
  assert.equal(byId.get("idle")?.startedAt, 20, "the earliest worker's start");
  assert.deepEqual(byId.get("solo")?.workers, []);
});
