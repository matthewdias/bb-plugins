// Follow Up as a Thread Pages contributor: one read, of the calling session's
// own follow-ups. The declaration's rules are Thread Pages' (bb-thread-pages
// 1.9.0, src/domain/capabilities/contributed.ts), pinned here so a change that
// would make it refuse ours fails a test rather than a page.
import assert from "node:assert/strict";
import test from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../server.ts";
import { calledMethod, callingSession, listReply, NO_SESSION, THREAD_PAGES_DECLARATION, unknownMethod } from "../lib/thread-pages.ts";
import type { FollowUp } from "../lib/followups.ts";

const KEYWORDS = new Set(["type", "description", "properties", "required", "additionalProperties", "enum", "const", "minimum", "maximum", "minLength", "maxLength", "pattern", "items", "minItems", "maxItems"]);

/** Every schema object in a schema, itself included. */
function nodes(schema: unknown): Record<string, unknown>[] {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) return [];
  const node = schema as Record<string, unknown>;
  const inner = [...Object.values((node.properties as Record<string, unknown> | undefined) ?? {}), node.items];
  return [node, ...inner.flatMap(nodes)];
}

test("thread pages: the declaration is one Thread Pages accepts", () => {
  const declaration = THREAD_PAGES_DECLARATION;
  assert.deepEqual(Object.keys(declaration).sort(), ["guide", "instruction", "methods", "version"]);
  assert.match(declaration.version, /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}$/);
  assert.ok(Buffer.byteLength(declaration.instruction) <= 2 * 1024, "the instruction reaches every session, so it is short");
  assert.ok(Buffer.byteLength(declaration.guide) <= 16 * 1024);
  for (const method of declaration.methods) {
    assert.match(method.name, /^follow-up\.[a-z][A-Za-z0-9]{0,63}$/, "its namespace is the plugin's id");
    assert.ok(method.description.length > 0 && method.description.length <= 240);
    for (const key of Object.keys(method)) assert.ok(["name", "description", "effect", "params", "result", "reasons"].includes(key), key);
    for (const node of [...nodes(method.params), ...nodes(method.result)]) {
      for (const key of Object.keys(node)) assert.ok(KEYWORDS.has(key), `"${key}" is outside the schema subset`);
      assert.ok(node.type !== undefined, "every schema names a type");
    }
    // A parameter object is closed, or Thread Pages refuses the method.
    for (const node of nodes(method.params)) if (node.type === "object") assert.equal(node.additionalProperties, false);
    for (const reason of Object.keys(method.reasons)) assert.match(reason, /^[a-z][a-z0-9_]{0,63}$/);
  }
});

test("thread pages: Follow Up contributes reads and nothing else", () => {
  // Thread Pages runs a contributed call with no dialog, from any page.
  assert.deepEqual(THREAD_PAGES_DECLARATION.methods.map((method) => [method.name, method.effect]), [["follow-up.list", "read"]]);
  assert.deepEqual(THREAD_PAGES_DECLARATION.methods[0].params, { type: "object", properties: {}, additionalProperties: false }, "and it cannot be pointed at another thread");
});

test("thread pages: reading a call, and answering it", () => {
  assert.equal(callingSession({ caller: { sessionId: "thr_a", scope: "docs" } }), "thr_a");
  for (const call of [{ caller: { sessionId: null } }, { caller: { sessionId: "" } }, { caller: {} }, {}, null, "x"]) {
    assert.equal(callingSession(call), null, JSON.stringify(call));
  }
  assert.equal(calledMethod({ method: "follow-up.list" }), "follow-up.list");
  assert.equal(calledMethod({ method: 7 }), null);
  const row = (id: string, extra: Partial<FollowUp> = {}): FollowUp => ({ id, text: `Row ${id}`, reason: "deferred", file: null, detail: null, createdAt: "2026-10-09T00:00:00.000Z", ...extra });
  assert.deepEqual(listReply([row("a", { file: "a.ts:3", detail: "Why." }), row("b", { reason: null, sentAt: "2026-10-09T01:00:00.000Z" })], 4), {
    ok: true,
    result: {
      followUps: [
        { id: "a", text: "Row a", reason: "deferred", file: "a.ts:3", detail: "Why.", createdAt: "2026-10-09T00:00:00.000Z", inProgress: false },
        { id: "b", text: "Row b", reason: null, file: null, detail: null, createdAt: "2026-10-09T00:00:00.000Z", inProgress: true },
      ],
      open: 2,
      done: 4,
    },
  });
  assert.deepEqual(NO_SESSION, { ok: false, error: { code: "unavailable", message: "Follow-ups belong to a session; the home page has none.", reason: "no_session" } });
  assert.equal(THREAD_PAGES_DECLARATION.methods[0].reasons[NO_SESSION.ok ? "no_session" : (NO_SESSION.error.reason as "no_session")] !== undefined, true, "the reason it fails with is one it declares");
  assert.deepEqual(unknownMethod("follow-up.close"), { ok: false, error: { code: "unknown_method", message: "follow-up has no follow-up.close" } });
});

test("thread pages: through the server, a page gets its own session's follow-ups and no one else's", async () => {
  const { bb, harness } = createFakePluginHost();
  await plugin(bb);
  const call = (method: string, input: unknown) => harness.callRpc(method, input) as Promise<any>;
  await harness.callAgentTool("record_follow_up", { text: "Fix the flaky test", reason: "deferred" }, { threadId: "thr_a" });
  await harness.callAgentTool("record_follow_up", { text: "Someone else's", reason: "risk" }, { threadId: "thr_b" });
  assert.deepEqual(await call("threadPagesContributions", null), THREAD_PAGES_DECLARATION);
  const invoke = (input: unknown) => call("threadPagesInvoke", input);
  const mine = await invoke({ method: "follow-up.list", params: {}, caller: { sessionId: "thr_a" }, requestId: "r1" });
  assert.equal(mine.ok, true);
  assert.deepEqual(mine.result.followUps.map((row: { text: string }) => row.text), ["Fix the flaky test"]);
  assert.deepEqual([mine.result.open, mine.result.done], [1, 0]);
  // Whatever a page puts in params, the session read is the caller's.
  const pointed = await invoke({ method: "follow-up.list", params: { threadId: "thr_b" }, caller: { sessionId: "thr_a" }, requestId: "r2" });
  assert.deepEqual(pointed.result.followUps.map((row: { text: string }) => row.text), ["Fix the flaky test"]);
  assert.deepEqual(await invoke({ method: "follow-up.list", params: {}, caller: { sessionId: null }, requestId: "r3" }), NO_SESSION);
  for (const method of ["follow-up.record", "follow-up.done", "follow-up.dismiss", "followups_done", ""]) {
    const refused = await invoke({ method, params: { id: mine.result.followUps[0].id }, caller: { sessionId: "thr_a" }, requestId: "r4" });
    assert.deepEqual([refused.ok, refused.error.code], [false, "unknown_method"], method);
  }
  const after = await invoke({ method: "follow-up.list", params: {}, caller: { sessionId: "thr_a" }, requestId: "r5" });
  assert.equal(after.result.open, 1, "nothing a page called changed anything");
});
