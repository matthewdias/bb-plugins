import assert from "node:assert/strict";
import test from "node:test";
import {
  anchorFrom,
  archiveRefusalFor,
  firstUserText,
  isSideChat,
  isTabFor,
  oneLine,
  refusalFor,
  sideChatState,
  titleFor,
  type ThreadFacts,
} from "../lib/promotion.ts";

const sideChat = (overrides: Partial<ThreadFacts> = {}): ThreadFacts => ({
  id: "thr_side",
  originKind: "fork",
  originPluginId: "side-chat",
  visibility: "hidden",
  archivedAt: null,
  status: "idle",
  queuedMessageCount: 0,
  sourceThreadId: "thr_main",
  ...overrides,
});

test("isSideChat: a hidden fork made by the side-chat plugin, and nothing else", () => {
  assert.equal(isSideChat(sideChat()), true);
  assert.equal(isSideChat(sideChat({ visibility: "visible" })), false);
  assert.equal(isSideChat(sideChat({ originPluginId: "follow-up" })), false);
  assert.equal(isSideChat(sideChat({ originPluginId: null })), false);
  assert.equal(isSideChat(sideChat({ originKind: null })), false);
});

test("refusalFor: an idle side chat with a message may be promoted", () => {
  assert.equal(refusalFor(sideChat(), true), null);
  // A failed last turn leaves the conversation intact.
  assert.equal(refusalFor(sideChat({ status: "error" }), true), null);
});

test("refusalFor: names each reason a side chat cannot be promoted yet", () => {
  assert.match(refusalFor(sideChat({ originPluginId: null }), true) ?? "", /not a side chat/);
  assert.match(refusalFor(sideChat({ archivedAt: 1 }), true) ?? "", /is archived/);
  for (const status of ["active", "starting", "pending", "stopping"]) {
    assert.match(refusalFor(sideChat({ status }), true) ?? "", /still working/, status);
  }
  assert.match(refusalFor(sideChat({ queuedMessageCount: 2 }), true) ?? "", /queued messages/);
  assert.match(refusalFor(sideChat(), false) ?? "", /no messages yet/);
});

test("firstUserText: the first non-empty user message, including inside turns", () => {
  assert.equal(
    firstUserText([
      { kind: "conversation", role: "assistant", text: "hello" },
      { kind: "conversation", role: "user", text: "  " },
      {
        kind: "turn",
        children: [
          { kind: "tool", text: "ignored" },
          { kind: "conversation", role: "user", text: "Why is CI red?" },
        ],
      },
      { kind: "conversation", role: "user", text: "later" },
    ]),
    "Why is CI red?",
  );
  assert.equal(firstUserText([{ kind: "conversation", role: "assistant", text: "hi" }]), null);
  // A message sent from another thread carries bb's sender label; a title should not.
  assert.equal(
    firstUserText([
      { kind: "conversation", role: "user", text: "[bb message from thread:thr_x]\n\nWhy is CI red?" },
    ]),
    "Why is CI red?",
  );
  assert.equal(
    firstUserText([{ kind: "conversation", role: "user", text: "[bb message from thread:thr_x]" }]),
    null,
  );
});

test("oneLine: flattens whitespace and cuts at a word near the limit", () => {
  assert.equal(oneLine("a\n  b\tc"), "a b c");
  assert.equal(oneLine("x".repeat(60)), "x".repeat(60));
  assert.equal(oneLine("alpha beta gamma delta", 15), "alpha beta…");
  // No space in the back half: a hard cut, still within the limit.
  assert.equal(oneLine("a " + "z".repeat(30), 10), `a ${"z".repeat(7)}…`);
  assert.ok(oneLine("word ".repeat(40)).length <= 60);
});

test("titleFor: the user's first question, on one line", () => {
  assert.equal(titleFor("Why is\nCI red?"), "Why is CI red?");
  assert.ok(titleFor("word ".repeat(40)).length <= 60);
});

test("isTabFor: matches either plugin's panel showing that side chat, by params", () => {
  const tab = (threadId: unknown, extra: Record<string, unknown> = {}) => ({
    kind: "plugin-panel",
    pluginId: "side-chat",
    paramsJson: JSON.stringify({ threadId, sourceThreadId: "thr_main" }),
    ...extra,
  });
  assert.equal(isTabFor(tab("thr_side"), "thr_side", "side-chats"), true);
  assert.equal(isTabFor(tab("thr_other"), "thr_side", "side-chats"), false);
  assert.equal(isTabFor(tab("thr_side", { pluginId: "follow-up" }), "thr_side", "side-chats"), false);
  assert.equal(isTabFor(tab("thr_side", { kind: "git-diff" }), "thr_side", "side-chats"), false);
  assert.equal(isTabFor(tab("thr_side", { paramsJson: "{not json" }), "thr_side", "side-chats"), false);
  assert.equal(isTabFor(tab("thr_side", { paramsJson: null }), "thr_side", "side-chats"), false);
  assert.equal(isTabFor({ kind: "thread-info" }, "thr_side", "side-chats"), false);
  // This plugin's own "Side chats" tab on the same side chat.
  assert.equal(isTabFor(tab("thr_side", { pluginId: "side-chats" }), "thr_side", "side-chats"), true);
  // Its list tab names no side chat.
  assert.equal(isTabFor(tab(undefined, { pluginId: "side-chats" }), "thr_side", "side-chats"), false);
});

test("archiveRefusalFor: any live side chat may be archived, busy or not", () => {
  assert.equal(archiveRefusalFor(sideChat()), null);
  assert.equal(archiveRefusalFor(sideChat({ status: "active", queuedMessageCount: 3 })), null);
  assert.match(archiveRefusalFor(sideChat({ archivedAt: 5 })) ?? "", /already archived/);
  assert.match(archiveRefusalFor(sideChat({ visibility: "visible" })) ?? "", /not a side chat/);
});

test("sideChatState: replying beats unread, and unread means attention after the last read", () => {
  const at = (status: string, lastReadAt: number | null, latestAttentionAt: number | null) =>
    sideChatState({ status, lastReadAt, latestAttentionAt });
  for (const status of ["pending", "starting", "active", "stopping"]) {
    assert.equal(at(status, 0, 99), "working", status);
  }
  assert.equal(at("idle", 10, 20), "unread");
  assert.equal(at("idle", null, 20), "unread");
  assert.equal(at("error", 10, 20), "unread");
  assert.equal(at("idle", 20, 20), "read");
  assert.equal(at("idle", 30, 20), "read");
  assert.equal(at("idle", 30, null), "read");
});

test("anchorFrom: reads the replied-to text back out of the seeded fallback title", () => {
  assert.equal(
    anchorFrom("Replying to this earlier message in the conversation: The build is green."),
    "The build is green.",
  );
  assert.equal(anchorFrom("Replying to this earlier message in the conversation:   "), null);
  assert.equal(anchorFrom("Some other fallback"), null);
  assert.equal(anchorFrom(null), null);
});
