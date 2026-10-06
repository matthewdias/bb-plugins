// The server entry, run whole against the SDK's fake host.
import assert from "node:assert/strict";
import test from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../server.ts";

const MAIN = "thr_main";
const SIDE = "thr_side";

type Row = Record<string, unknown>;

const thread = (overrides: Row = {}): Row => ({
  id: SIDE,
  originKind: "fork",
  originPluginId: "side-chat",
  visibility: "hidden",
  archivedAt: null,
  status: "idle",
  queuedMessageCount: 0,
  sourceThreadId: MAIN,
  lifecycleOwnerThreadId: MAIN,
  environmentId: "env_main",
  titleFallback: "Replying to this earlier message in the conversation: The build is green.",
  lastReadAt: 900,
  latestAttentionAt: 800,
  updatedAt: 1_000,
  ...overrides,
});

const userSaid = (text: string) => ({
  rows: [
    {
      kind: "turn",
      children: [
        { kind: "conversation", role: "user", text },
        { kind: "conversation", role: "assistant", text: "Here is why." },
      ],
    },
  ],
});

const sideChatTab = {
  id: "plugin-panel:side-chat:x",
  kind: "plugin-panel",
  pluginId: "side-chat",
  actionId: "side-chat",
  title: "Side chat",
  paramsJson: JSON.stringify({ threadId: SIDE, sourceThreadId: MAIN, sourceMessageText: "", sourceSeqEnd: null }),
};
const infoTab = { id: "thread-info:thread-info:none", kind: "thread-info" };
// This plugin's own "Side chats" tab showing the same side chat.
const ownTab = {
  id: "plugin-panel:side-chats:x",
  kind: "plugin-panel",
  pluginId: "side-chats",
  actionId: "side-chats",
  title: "Why is CI red?",
  paramsJson: JSON.stringify({ threadId: SIDE, anchor: null }),
};

interface Options {
  threads?: Record<string, Row>;
  timelines?: Record<string, unknown>;
  archive?: () => unknown;
  tabsUpdate?: () => unknown;
}

async function host(options: Options = {}) {
  const { bb, harness } = createFakePluginHost({ pluginId: "side-chats" });
  const threads: Record<string, Row> = options.threads ?? { [SIDE]: thread() };
  const timelines: Record<string, unknown> = options.timelines ?? { [SIDE]: userSaid("Why is CI red?") };
  const order: string[] = [];

  harness.sdk.stub("threads.get", (args: { threadId: string }) => {
    const found = threads[args.threadId];
    if (found === undefined) throw new Error(`thread ${args.threadId} not found`);
    return found;
  });
  harness.sdk.stub("threads.timeline", (args: { threadId: string }) => timelines[args.threadId] ?? { rows: [] });
  harness.sdk.stub("threads.list", () => Object.values(threads));
  let forks = 0;
  harness.sdk.stub("threads.fork", () => {
    order.push("fork");
    return { id: `thr_promoted${++forks}` };
  });
  harness.sdk.stub("threads.archive", () => {
    order.push("archive");
    return options.archive?.() ?? { archivedThreadIds: [SIDE] };
  });
  harness.sdk.stub("threads.unarchive", () => ({ ok: true }));
  harness.sdk.stub("threads.tabs.get", () => ({ revision: 7, tabs: [infoTab, sideChatTab, ownTab] }));
  harness.sdk.stub("threads.tabs.update", () => {
    order.push("tabs");
    return options.tabsUpdate?.() ?? { revision: 8, tabs: [infoTab] };
  });
  harness.sdk.stub("environments.get", () => ({ id: "env_main", hostId: "host_remote" }));

  await plugin(bb);
  // The kv write is the fence a retry relies on, so record when it lands.
  const set = bb.storage.kv.set.bind(bb.storage.kv);
  bb.storage.kv.set = async (key: string, value: unknown) => {
    order.push(`kv:${key}`);
    return set(key, value);
  };

  const promote = (input: Row) =>
    harness.callRpc("promoteSideChat", { sideChatThreadId: SIDE, environment: "shared", ...input }) as Promise<{
      threadId: string;
      title: string;
      alreadyPromoted: boolean;
      warnings: string[];
    }>;
  const forkArgs = () => harness.sdk.callsTo("threads.fork").map((args) => args[0] as Row);
  const cli = async (argv: string[], ctx: { threadId?: string } = { threadId: MAIN }) =>
    (await harness.runCli(argv, ctx)) as { exitCode: number; stdout: string; stderr: string };
  return { harness, promote, forkArgs, order, cli, bb };
}

test("promote: forks a visible thread with no lifecycle owner, in the shared environment", async () => {
  const { promote, forkArgs } = await host();
  const result = await promote({});
  assert.deepEqual(result, {
    threadId: "thr_promoted1",
    title: "Why is CI red?",
    alreadyPromoted: false,
    warnings: [],
  });
  const [args] = forkArgs();
  assert.deepEqual(args, {
    sourceThreadId: SIDE,
    origin: "plugin",
    originPluginId: "side-chats",
    visibility: "visible",
    title: "Why is CI red?",
    environment: { type: "reuse", environmentId: "env_main" },
    pluginMetadata: { promotedFrom: SIDE, mainThreadId: MAIN },
  });
  assert.equal("lifecycleOwnerThreadId" in (args as Row), false);
  assert.equal("parentThreadId" in (args as Row), false);
});

test("promote: a worktree promotion asks for a new managed worktree on the side chat's host", async () => {
  const { promote, forkArgs } = await host();
  await promote({ environment: "worktree" });
  assert.deepEqual(forkArgs()[0]?.environment, {
    type: "host",
    hostId: "host_remote",
    workspace: { type: "managed-worktree", baseBranch: { kind: "default" } },
  });
});

test("promote: an explicit title wins over the derived one", async () => {
  const { promote, forkArgs } = await host();
  const result = await promote({ title: "Investigate CI" });
  assert.equal(result.title, "Investigate CI");
  assert.equal(forkArgs()[0]?.title, "Investigate CI");
});

test("promote: records the promotion before archiving, then closes the side-chat tab", async () => {
  const { promote, order, harness } = await host();
  await promote({});
  assert.deepEqual(order, ["fork", `kv:promoted:${SIDE}`, "archive", "tabs"]);
  assert.deepEqual(harness.sdk.callsTo("threads.tabs.update")[0]?.[0], {
    threadId: MAIN,
    expectedRevision: 7,
    tabs: [infoTab],
  });
  assert.ok(
    harness.realtimeSignals.some(
      (signal) => signal.channel === "side-chats-changed" && (signal.payload as Row).threadId === MAIN,
    ),
  );
});

test("promote: a second promotion returns the first thread instead of forking again", async () => {
  const { promote, forkArgs } = await host();
  const first = await promote({});
  const second = await promote({ environment: "worktree" });
  assert.equal(forkArgs().length, 1);
  assert.equal(second.threadId, first.threadId);
  assert.equal(second.alreadyPromoted, true);
});

test("promote: two promotions in flight fork once", async () => {
  const { promote, forkArgs } = await host();
  const [a, b] = await Promise.all([promote({}), promote({})]);
  assert.equal(forkArgs().length, 1);
  assert.equal(a.threadId, b.threadId);
});

test("promote: a failed archive is a warning, and the new thread stands", async () => {
  const { promote } = await host({
    archive: () => {
      throw new Error("archive exploded");
    },
  });
  const result = await promote({});
  assert.equal(result.threadId, "thr_promoted1");
  assert.deepEqual(result.warnings, ["The side chat was not archived: archive exploded"]);
});

test("promote: a failed tab close is logged, not reported", async () => {
  const { promote, harness } = await host({
    tabsUpdate: () => {
      throw new Error("revision conflict");
    },
  });
  const result = await promote({});
  assert.deepEqual(result.warnings, []);
  assert.ok(harness.logEntries.some((entry) => /tab not closed/.test(entry.message)));
});

test("promote: refuses a thread that is not a side chat, without forking", async () => {
  const { promote, forkArgs } = await host({ threads: { [SIDE]: thread({ originPluginId: null }) } });
  await assert.rejects(promote({}), /not a side chat/);
  assert.equal(forkArgs().length, 0);
});

test("promote: refuses a side chat that is still working, without forking", async () => {
  const { promote, forkArgs } = await host({ threads: { [SIDE]: thread({ status: "active" }) } });
  await assert.rejects(promote({}), /still working/);
  assert.equal(forkArgs().length, 0);
});

test("promote: refuses a side chat with nothing in it, without forking", async () => {
  const { promote, forkArgs } = await host({ timelines: {} });
  await assert.rejects(promote({}), /no messages yet/);
  assert.equal(forkArgs().length, 0);
});

test("listSideChats: lists live side chats with a message, newest first", async () => {
  const { harness } = await host({
    threads: {
      a: thread({ id: "a", updatedAt: 1, titleFallback: null }),
      b: thread({ id: "b", updatedAt: 3, status: "active" }),
      c: thread({ id: "c", updatedAt: 4, lastReadAt: 10, latestAttentionAt: 20 }),
      empty: thread({ id: "empty", updatedAt: 2 }),
      visible: thread({ id: "visible", visibility: "visible" }),
    },
    timelines: {
      a: userSaid("first question"),
      b: userSaid("second\nquestion"),
      c: userSaid("third"),
      visible: userSaid("x"),
    },
  });
  const result = (await harness.callRpc("listSideChats", { threadId: MAIN })) as { sideChats: Row[] };
  const anchor = "The build is green.";
  assert.deepEqual(result.sideChats, [
    { id: "c", preview: "third", anchor, state: "unread", updatedAt: 4 },
    { id: "b", preview: "second question", anchor, state: "working", updatedAt: 3 },
    { id: "a", preview: "first question", anchor: null, state: "read", updatedAt: 1 },
  ]);
  assert.deepEqual(harness.sdk.callsTo("threads.list")[0]?.[0], {
    includeHidden: true,
    originKind: "fork",
    originPluginId: "side-chat",
    sourceThreadId: MAIN,
    archived: false,
    limit: 50,
  });
});

test("listSideChats: reads each side chat's first message once", async () => {
  const { harness } = await host();
  await harness.callRpc("listSideChats", { threadId: MAIN });
  await harness.callRpc("listSideChats", { threadId: MAIN });
  assert.equal(harness.sdk.callsTo("threads.timeline").length, 1);
});

test("listSideChats: an empty side chat is read again until it has a message", async () => {
  const timelines: Record<string, unknown> = {};
  const { harness } = await host({ timelines });
  assert.deepEqual(await harness.callRpc("listSideChats", { threadId: MAIN }), { sideChats: [] });
  timelines[SIDE] = userSaid("Now there is one");
  const result = (await harness.callRpc("listSideChats", { threadId: MAIN })) as { sideChats: Row[] };
  assert.equal(result.sideChats[0]?.preview, "Now there is one");
});

test("archive: archives the side chat and closes both plugins' tabs for it", async () => {
  const { harness, forkArgs } = await host();
  const result = await harness.callRpc("archiveSideChat", { sideChatThreadId: SIDE });
  assert.deepEqual(result, { sideChatThreadId: SIDE });
  assert.deepEqual(harness.sdk.callsTo("threads.archive")[0]?.[0], { threadId: SIDE });
  assert.deepEqual(harness.sdk.callsTo("threads.tabs.update")[0]?.[0], {
    threadId: MAIN,
    expectedRevision: 7,
    tabs: [infoTab],
  });
  assert.equal(forkArgs().length, 0);
});

test("archive: a side chat mid-reply may be archived", async () => {
  const { harness } = await host({ threads: { [SIDE]: thread({ status: "active" }) } });
  await harness.callRpc("archiveSideChat", { sideChatThreadId: SIDE });
  assert.equal(harness.sdk.callsTo("threads.archive").length, 1);
});

test("archive: refuses what is not a live side chat, and reports a failed archive", async () => {
  const { harness } = await host({ threads: { [SIDE]: thread({ originPluginId: null }) } });
  await assert.rejects(harness.callRpc("archiveSideChat", { sideChatThreadId: SIDE }), /not a side chat/);
  assert.equal(harness.sdk.callsTo("threads.archive").length, 0);

  const failing = await host({
    archive: () => {
      throw new Error("archive exploded");
    },
  });
  await assert.rejects(
    failing.harness.callRpc("archiveSideChat", { sideChatThreadId: SIDE }),
    /archive exploded/,
  );
  assert.equal(failing.harness.sdk.callsTo("threads.tabs.update").length, 0);
});

test("events: a side chat being created, starting or finishing a reply, or archived refreshes its main thread", async () => {
  const { harness } = await host();
  for (const event of ["thread.created", "thread.active", "thread.idle", "thread.archived"] as const) {
    const before = harness.realtimeSignals.length;
    await harness.emitThreadEvent(event, { thread: thread(), lastAssistantText: null } as never);
    assert.deepEqual(harness.realtimeSignals.slice(before), [
      { channel: "side-chats-changed", payload: { threadId: MAIN } },
    ], event);
  }
  const before = harness.realtimeSignals.length;
  await harness.emitThreadEvent("thread.created", { thread: thread({ originPluginId: null }) } as never);
  assert.equal(harness.realtimeSignals.length, before);
});

test("cli: list and promote", async () => {
  const { cli } = await host();
  assert.deepEqual(await cli([]), { exitCode: 0, stdout: `${SIDE}  Why is CI red?\n`, stderr: "" });
  assert.deepEqual(await cli(["promote", SIDE]), {
    exitCode: 0,
    stdout: `Promoted ${SIDE} to thr_promoted1: Why is CI red?\n`,
    stderr: "",
  });
  assert.deepEqual(await cli(["promote", SIDE]), {
    exitCode: 0,
    stdout: `Already promoted ${SIDE} to thr_promoted1: Why is CI red?\n`,
    stderr: "",
  });
});

test("cli: promote --worktree --title, and refusals become errors", async () => {
  const { cli, forkArgs } = await host();
  const result = await cli(["promote", SIDE, "--worktree", "--title", "Fix CI", "--json"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).title, "Fix CI");
  assert.equal((forkArgs()[0]?.environment as Row).type, "host");

  const { cli: other } = await host({ threads: { [SIDE]: thread({ queuedMessageCount: 1 }) } });
  const refused = await other(["promote", SIDE]);
  assert.equal(refused.exitCode, 1);
  assert.match(refused.stderr, /queued messages/);
});

test("cli: list without a thread asks for one", async () => {
  const { cli } = await host();
  const result = await cli([], {});
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /pass --thread/);
});

test("cli: list marks replies in progress and unread", async () => {
  const { cli } = await host({
    threads: {
      a: thread({ id: "a", updatedAt: 2, status: "active" }),
      b: thread({ id: "b", updatedAt: 1, lastReadAt: 1, latestAttentionAt: 2 }),
    },
    timelines: { a: userSaid("one"), b: userSaid("two") },
  });
  assert.deepEqual(await cli(["list"]), {
    exitCode: 0,
    stdout: "a  [replying] one\nb  [new reply] two\n",
    stderr: "",
  });
});

test("cli: archive", async () => {
  const { cli } = await host();
  assert.deepEqual(await cli(["archive", SIDE]), {
    exitCode: 0,
    stdout: `Archived side chat ${SIDE}\n`,
    stderr: "",
  });
  const again = await host({ threads: { [SIDE]: thread({ archivedAt: 1 }) } });
  const refused = await again.cli(["archive", SIDE]);
  assert.equal(refused.exitCode, 1);
  assert.match(refused.stderr, /already archived/);
});

// An archived side chat whose main thread is live, ready to be brought back.
const archivedSide = () => ({
  [SIDE]: thread({ archivedAt: 5 }),
  [MAIN]: thread({ id: MAIN, originKind: null, originPluginId: null, visibility: "visible", sourceThreadId: null }),
});

test("unarchive: restores an archived side chat and refreshes its main thread", async () => {
  const { harness } = await host({ threads: archivedSide() });
  const result = await harness.callRpc("unarchiveSideChat", { sideChatThreadId: SIDE });
  assert.deepEqual(result, { sideChatThreadId: SIDE });
  assert.deepEqual(harness.sdk.callsTo("threads.unarchive")[0]?.[0], { threadId: SIDE });
  assert.ok(
    harness.realtimeSignals.some(
      (signal) => signal.channel === "side-chats-changed" && (signal.payload as Row).threadId === MAIN,
    ),
  );
});

test("unarchive: refuses while the main thread is archived", async () => {
  const threads = archivedSide();
  threads[MAIN] = { ...threads[MAIN], archivedAt: 4 };
  const { harness } = await host({ threads });
  await assert.rejects(
    harness.callRpc("unarchiveSideChat", { sideChatThreadId: SIDE }),
    /main thread .* is archived/,
  );
  assert.equal(harness.sdk.callsTo("threads.unarchive").length, 0);
});

test("unarchive: refuses a side chat that was promoted, naming the thread it became", async () => {
  const { harness, bb } = await host({ threads: archivedSide() });
  await bb.storage.kv.set(`promoted:${SIDE}`, { threadId: "thr_promoted9", title: "x" });
  await assert.rejects(
    harness.callRpc("unarchiveSideChat", { sideChatThreadId: SIDE }),
    /promoted to thr_promoted9/,
  );
  assert.equal(harness.sdk.callsTo("threads.unarchive").length, 0);
});

test("unarchive: refuses a side chat that is not archived", async () => {
  const { harness } = await host();
  await assert.rejects(harness.callRpc("unarchiveSideChat", { sideChatThreadId: SIDE }), /is not archived/);
});

test("events: a side chat being unarchived refreshes its main thread", async () => {
  const { harness } = await host();
  const before = harness.realtimeSignals.length;
  await harness.emitThreadEvent("thread.unarchived", { thread: thread() } as never);
  assert.deepEqual(harness.realtimeSignals.slice(before), [
    { channel: "side-chats-changed", payload: { threadId: MAIN } },
  ]);
});

test("cli: unarchive", async () => {
  const { cli } = await host({ threads: archivedSide() });
  assert.deepEqual(await cli(["unarchive", SIDE]), {
    exitCode: 0,
    stdout: `Unarchived side chat ${SIDE}\n`,
    stderr: "",
  });
});
