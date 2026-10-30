// ask_form, end to end through the server: the agent's tool stores a form, the
// card's RPCs read and answer it, and a turn starting takes it away.
import assert from "node:assert/strict";
import test from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../server.ts";

const THREAD = "thr_a";

type Sent = { threadId: string; mode: string; input: Array<Record<string, unknown>> };

async function host(options: { sendFails?: boolean; delivery?: "sent" | "queued" } = {}) {
  const { bb, harness } = createFakePluginHost();
  harness.sdk.stub("threads.send", () => {
    if (options.sendFails === true) throw new Error("provider is down");
    return { ok: true, delivery: options.delivery ?? "sent" };
  });
  await plugin(bb);
  const call = (method: string, input: unknown) => harness.callRpc(method, input) as Promise<any>;
  const ask = (input: unknown, threadId = THREAD) => harness.callAgentTool("ask_form", input, { threadId });
  const sent = () => harness.sdk.callsTo("threads.send").map((args) => args[0] as Sent);
  const signals = (name: string) => harness.realtimeSignals.filter((signal) => signal.channel === name).length;
  const form = async (threadId = THREAD) => (await call("ask_get", { threadId })).form;
  const turnStarts = (threadId = THREAD) => harness.emitThreadEvent("thread.active", { thread: { id: threadId } as never });
  return { harness, call, ask, sent, signals, form, turnStarts };
}

const retry = {
  type: "choice",
  id: "retry",
  prompt: "How should a failed upload retry?",
  options: [{ label: "Back off" }, { label: "Retry at once" }],
  recommended: ["Back off"],
};
const issue = (n: number, extra: Record<string, unknown> = {}) => ({
  type: "item",
  id: `issue-${n}`,
  title: `#${n} An issue`,
  choices: [{ label: "Close it" }, { label: "Leave open" }],
  ...extra,
});
const questions = { title: "Offline queue", parts: [{ type: "text", text: "Two things." }, retry] };

test("ask: a form is stored, read back and signalled to the thread and the page", async () => {
  const { ask, form, signals } = await host();
  assert.equal(await form(), null);
  const result = await ask(questions);
  assert.match(String(result), /^Shown, above the user's composer and on their Follow Up page\. End your turn now/);
  const read = await form();
  assert.equal(read.title, "Offline queue");
  assert.deepEqual(read.parts.map((part: { type: string }) => part.type), ["text", "choice"]);
  assert.equal(signals("followups-ask-changed"), 1);
  // The page's signal is debounced.
  await new Promise((resolve) => setTimeout(resolve, 320));
  assert.equal(signals("followups-page-changed"), 1);
});

test("ask: a form that does not hold together is refused with the reason, and nothing is stored", async () => {
  const { ask, form, signals } = await host();
  const refused = await ask({ title: "T", parts: [{ ...retry, recommended: ["Never"] }] });
  assert.match(String(refused), /^Not shown: The question "retry" recommends a label that is not one of its options\. Fix that and call ask_form again/);
  assert.match(String(await ask({ title: "T", parts: [{ type: "text", text: "FYI" }] })), /^Not shown: The form asks nothing/);
  assert.match(String(await ask({ title: "T", parts: [{ ...retry, options: [{ label: "Yes\u{E0061}" }, { label: "No" }], recommended: [] }] })), /does not show on screen/);
  assert.equal(await form(), null);
  assert.equal(signals("followups-ask-changed"), 0);
  // What the schema itself rules out never reaches that check.
  await assert.rejects(() => ask({ title: "T", parts: [] }));
  await assert.rejects(() => ask({ title: "T", parts: [{ type: "image", url: "https://x.test/a.png" }] }));
  await assert.rejects(() => ask({ title: "T", parts: [issue(1, { choices: [] })] }));
});

test("ask: asking again replaces the form", async () => {
  const { ask, form } = await host();
  await ask(questions);
  const first = (await form()).askedAt;
  await new Promise((resolve) => setTimeout(resolve, 5));
  await ask({ title: "Second", parts: [issue(1)] });
  const second = await form();
  assert.equal(second.title, "Second");
  assert.notEqual(second.askedAt, first);
});

test("ask: switched off, the tool refuses and the card is shown nothing", async () => {
  const { harness, ask, form } = await host();
  await ask(questions);
  await harness.setSettings({ askForms: false });
  assert.equal(await form(), null, "a form stored before the switch is not shown");
  assert.match(String(await ask(questions)), /^The user has turned forms off/);
  await harness.setSettings({ askForms: true });
  assert.notEqual(await form(), null);
});

test("ask: answering sends what the form's send box showed, with an exact copy for the agent alone", async () => {
  const { ask, call, form, sent } = await host();
  await ask(questions);
  const { askedAt } = await form();
  const result = await call("ask_answer", { threadId: THREAD, askedAt, answers: { retry: { type: "choice", selected: ["Retry at once"] } } });
  assert.deepEqual(result, { outcome: "sent", problem: null });
  const message = sent()[0];
  assert.equal(message?.threadId, THREAD);
  assert.equal(message?.mode, "queue-if-active", "behind a running turn, never into it");
  assert.equal(message?.input.length, 2);
  assert.equal(message?.input[0]?.text, "My answers to “Offline queue”:\n\n1. How should a failed upload retry?\n   Retry at once");
  assert.equal(message?.input[0]?.visibility, undefined);
  assert.equal(message?.input[1]?.visibility, "agent-only");
  assert.deepEqual(JSON.parse(String(message?.input[1]?.text).split("\n")[1] ?? "").answers, { retry: { selected: ["Retry at once"] } });
  assert.equal(await form(), null, "nothing is left to answer, so the form goes");
});

test("ask: an answer that does not fit the form is refused, and nothing is sent", async () => {
  const { ask, call, form, sent } = await host();
  await ask({ title: "T", parts: [retry, issue(1)] });
  const { askedAt } = await form();
  const answer = (answers: unknown) => call("ask_answer", { threadId: THREAD, askedAt, answers });
  assert.deepEqual(await answer({ retry: { type: "choice", selected: ["Never"] } }), { outcome: "invalid", problem: "That answer names an option the question does not have." });
  assert.deepEqual(await answer({ "issue-1": { type: "item", choice: "Close it" } }), { outcome: "invalid", problem: "Still to answer: How should a failed upload retry?" });
  assert.deepEqual(await answer({}), { outcome: "invalid", problem: "There is nothing to send yet." });
  assert.equal(sent().length, 0);
  assert.notEqual(await form(), null);
});

test("ask: an answer to a form the agent has since replaced is stale", async () => {
  const { ask, call, form, sent } = await host();
  await ask(questions);
  const { askedAt } = await form();
  await new Promise((resolve) => setTimeout(resolve, 5));
  await ask({ title: "Second", parts: [{ ...retry, options: [{ label: "A" }, { label: "B" }], recommended: [] }] });
  const stale = await call("ask_answer", { threadId: THREAD, askedAt, answers: { retry: { type: "choice", selected: ["Back off"] } } });
  assert.deepEqual(stale, { outcome: "stale", problem: null });
  assert.deepEqual(await call("ask_answer", { threadId: "thr_none", askedAt, answers: { retry: { type: "choice", selected: ["Back off"] } } }), { outcome: "stale", problem: null });
  assert.equal(sent().length, 0);
});

test("ask: a turn anyone else starts clears the form", async () => {
  const { ask, form, turnStarts, signals } = await host();
  await turnStarts();
  assert.equal(signals("followups-ask-changed"), 0, "a thread with no form signals nothing");
  await ask(questions);
  await turnStarts();
  assert.equal(await form(), null);
});

test("ask: the turn a partial answer starts leaves the undecided items, and the next turn clears them", async () => {
  const { ask, call, form, sent, turnStarts } = await host();
  await ask({ title: "Triage", parts: [issue(1), issue(2)] });
  const { askedAt } = await form();
  const first = await call("ask_answer", { threadId: THREAD, askedAt, answers: { "issue-1": { type: "item", choice: "Close it" } } });
  assert.equal(first.outcome, "sent");
  assert.match(String(sent()[0]?.input[0]?.text), /^On “Triage”:\n\n- #1 An issue: Close it\n\n1 item is still undecided\.$/);
  await turnStarts();
  const left = await form();
  assert.deepEqual(left.done, { "issue-1": "Close it" });
  assert.equal(left.keepThrough, false, "it passes one turn, not every turn");
  // Deciding the rest, on the same form.
  const second = await call("ask_answer", { threadId: THREAD, askedAt, answers: { "issue-2": { type: "item", choice: "Leave open" } } });
  assert.equal(second.outcome, "sent");
  assert.equal(await form(), null);
});

test("ask: undecided items do not outlive a turn someone else starts", async () => {
  const { ask, call, form, turnStarts } = await host();
  await ask({ title: "Triage", parts: [issue(1), issue(2)] });
  const { askedAt } = await form();
  await call("ask_answer", { threadId: THREAD, askedAt, answers: { "issue-1": { type: "item", choice: "Close it" } } });
  await turnStarts();
  await turnStarts();
  assert.equal(await form(), null);
});

test("ask: an answer queued behind a running turn says so", async () => {
  const { ask, call, form } = await host({ delivery: "queued" });
  await ask(questions);
  const { askedAt } = await form();
  const result = await call("ask_answer", { threadId: THREAD, askedAt, answers: { retry: { type: "choice", selected: ["Back off"] } } });
  assert.deepEqual(result, { outcome: "queued", problem: null });
});

test("ask: a send that fails puts the form back as it was", async () => {
  const { ask, call, form, sent } = await host({ sendFails: true });
  await ask({ title: "Triage", parts: [issue(1), issue(2)] });
  const before = await form();
  const result = await call("ask_answer", { threadId: THREAD, askedAt: before.askedAt, answers: { "issue-1": { type: "item", choice: "Close it" } } });
  assert.deepEqual(result, { outcome: "failed", problem: null });
  assert.equal(sent().length, 1);
  assert.deepEqual(await form(), before, "nothing marked done, nothing set to pass a turn");
});

test("ask: a form can be dropped unanswered, by the form it names", async () => {
  const { ask, call, form, sent } = await host();
  await ask(questions);
  const { askedAt } = await form();
  assert.deepEqual(await call("ask_clear", { threadId: THREAD, askedAt: "2020-01-01T00:00:00.000Z" }), { outcome: "stale" });
  assert.notEqual(await form(), null);
  assert.deepEqual(await call("ask_clear", { threadId: THREAD, askedAt }), { outcome: "cleared" });
  assert.equal(await form(), null);
  assert.equal(sent().length, 0);
});

test("ask: agents are told about forms only while the setting is on", async () => {
  const { harness } = await host();
  const rules = () => harness.registrations.instructionProvider?.({ threadId: THREAD, projectId: "p" }) ?? "";
  assert.match(rules(), /\n\nForms: when you would end a turn with several questions/);
  await harness.setSettings({ askForms: false });
  assert.doesNotMatch(rules(), /Forms: when you would end a turn/);
});
