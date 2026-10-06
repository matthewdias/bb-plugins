// Next steps, end to end through the server: the agent's tool writes an offer,
// the card's RPCs read and press it, and a turn starting takes it away.
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
  const offer = (input: unknown, threadId = THREAD) =>
    harness.callAgentTool("offer_next_steps", input, { threadId });
  const sent = () => harness.sdk.callsTo("threads.send").map((args) => args[0] as Sent);
  const signals = (name: string) =>
    harness.realtimeSignals.filter((signal) => signal.channel === name).length;
  return { harness, call, offer, sent, signals };
}

const steps = [
  { label: "Open a PR", prompt: "Open a PR for this branch against main." },
  { label: "Add a test", prompt: "Add a test for the empty export." },
];

test("next: an offer is stored, read back and signalled", async () => {
  const { call, offer, signals } = await host();
  assert.equal((await call("followups_next_get", { threadId: THREAD })).offer, null);
  const result = await offer({ steps });
  assert.match(String(result), /^Offered\. 2 buttons will show under your reply/);
  const read = (await call("followups_next_get", { threadId: THREAD })).offer;
  assert.deepEqual(read.steps, steps);
  assert.equal(read.goalMet, false);
  assert.equal(signals("followups-next-changed"), 1);
});

test("next: a turn starting clears the offer, and an empty thread signals nothing", async () => {
  const { harness, call, offer, signals } = await host();
  await harness.emitThreadEvent("thread.active", { thread: { id: THREAD } as never });
  assert.equal(signals("followups-next-changed"), 0);
  await offer({ steps });
  await harness.emitThreadEvent("thread.active", { thread: { id: THREAD } as never });
  assert.equal((await call("followups_next_get", { threadId: THREAD })).offer, null);
  assert.equal(signals("followups-next-changed"), 2);
});

test("next: an empty list clears an earlier offer; a met goal alone is kept", async () => {
  const { call, offer } = await host();
  await offer({ steps });
  assert.match(String(await offer({ steps: [] })), /^Cleared/);
  assert.equal((await call("followups_next_get", { threadId: THREAD })).offer, null);
  await offer({ steps: [], goal_met: true });
  const read = (await call("followups_next_get", { threadId: THREAD })).offer;
  assert.deepEqual([read.steps, read.goalMet], [[], true]);
});

test("next: more than three steps is refused by the tool's schema", async () => {
  const { offer } = await host();
  const four = [1, 2, 3, 4].map((n) => ({ label: `Step ${n}`, prompt: `Do step ${n}.` }));
  await assert.rejects(() => offer({ steps: four }));
});

test("next: switched off, the tool refuses and the card is shown nothing", async () => {
  const { harness, call, offer } = await host();
  await offer({ steps });
  await harness.setSettings({ offerNextSteps: false });
  assert.match(String(await offer({ steps })), /turned next-step buttons off/);
  assert.equal((await call("followups_next_get", { threadId: THREAD })).offer, null);
});

test("next: taking a step sends its prompt as the user's message and clears the offer", async () => {
  const { call, offer, sent } = await host();
  await offer({ steps });
  const { offer: read } = await call("followups_next_get", { threadId: THREAD });
  const result = await call("followups_next_take", {
    threadId: THREAD,
    offeredAt: read.offeredAt,
    index: 1,
  });
  assert.equal(result.outcome, "sent");
  assert.deepEqual(sent(), [
    {
      threadId: THREAD,
      mode: "auto",
      input: [{ type: "text", text: "Add a test for the empty export.", mentions: [] }],
    },
  ]);
  assert.equal((await call("followups_next_get", { threadId: THREAD })).offer, null);
  // A second press of the same button finds nothing to send.
  const again = await call("followups_next_take", {
    threadId: THREAD,
    offeredAt: read.offeredAt,
    index: 1,
  });
  assert.equal(again.outcome, "stale");
  assert.equal(sent().length, 1);
});

test("next: a press against a replaced offer is stale and sends nothing", async () => {
  const { call, offer, sent } = await host();
  await offer({ steps });
  const { offer: first } = await call("followups_next_get", { threadId: THREAD });
  // Distinct timestamps: the offer's identity is when it was made.
  await new Promise((resolve) => setTimeout(resolve, 5));
  await offer({ steps: [{ label: "Something else", prompt: "Do something else." }] });
  const result = await call("followups_next_take", {
    threadId: THREAD,
    offeredAt: first.offeredAt,
    index: 0,
  });
  assert.equal(result.outcome, "stale");
  assert.deepEqual(sent(), []);
});

test("next: a queued send says so", async () => {
  const { call, offer } = await host({ delivery: "queued" });
  await offer({ steps });
  const { offer: read } = await call("followups_next_get", { threadId: THREAD });
  const result = await call("followups_next_take", {
    threadId: THREAD,
    offeredAt: read.offeredAt,
    index: 0,
  });
  assert.equal(result.outcome, "queued");
});

test("next: a failed send puts the offer back to press again", async () => {
  const { call, offer } = await host({ sendFails: true });
  await offer({ steps });
  const { offer: read } = await call("followups_next_get", { threadId: THREAD });
  const result = await call("followups_next_take", {
    threadId: THREAD,
    offeredAt: read.offeredAt,
    index: 0,
  });
  assert.equal(result.outcome, "failed");
  assert.deepEqual((await call("followups_next_get", { threadId: THREAD })).offer, read);
});

test("next: keeping a step records it as a deferred follow-up and leaves the rest", async () => {
  const { call, offer } = await host();
  await offer({ steps });
  const { offer: read } = await call("followups_next_get", { threadId: THREAD });
  const kept = await call("followups_next_keep", {
    threadId: THREAD,
    offeredAt: read.offeredAt,
    index: 0,
  });
  assert.equal(kept.outcome, "added");
  assert.deepEqual(kept.offer.steps, [steps[1]]);
  assert.equal(kept.offer.offeredAt, read.offeredAt);
  const [row] = kept.followUps;
  assert.deepEqual(
    [row.text, row.detail, row.reason, row.createdBy],
    ["Open a PR", "Open a PR for this branch against main.", "deferred", "user"],
  );
});

test("next: a step already on the list leaves the offer anyway", async () => {
  const { call, offer } = await host();
  await call("followups_add", { threadId: THREAD, text: "Open a PR" });
  await offer({ steps });
  const { offer: read } = await call("followups_next_get", { threadId: THREAD });
  const kept = await call("followups_next_keep", {
    threadId: THREAD,
    offeredAt: read.offeredAt,
    index: 0,
  });
  assert.equal(kept.outcome, "duplicate");
  assert.deepEqual(kept.offer.steps, [steps[1]]);
  assert.equal(kept.followUps.length, 1);
});

test("next: clearing puts the offer away without sending", async () => {
  const { call, offer, sent } = await host();
  await offer({ steps });
  assert.deepEqual(await call("followups_next_clear", { threadId: THREAD }), { ok: true });
  assert.equal((await call("followups_next_get", { threadId: THREAD })).offer, null);
  assert.deepEqual(sent(), []);
});

test("next: Do hands the row over — one typed line, the record agent-only — and claims it", async () => {
  const { call, sent } = await host();
  const added = await call("followups_add", { threadId: THREAD, text: "Tidy the loader" });
  const result = await call("followups_next_do", { threadId: THREAD, id: added.id });
  assert.equal(result.outcome, "sent");
  const [message] = sent();
  assert.equal(message.mode, "auto");
  assert.deepEqual(message.input[0], {
    type: "text",
    text: 'Pick up the follow-up "Tidy the loader".',
    mentions: [],
  });
  assert.equal(message.input[1].visibility, "agent-only");
  const context = String(message.input[1].text);
  // A row a person wrote has no reason; it must not read "(null)".
  assert.match(context, /^Follow-up: Tidy the loader\n/);
  assert.match(context, new RegExp(`complete_follow_up with follow_up: "${added.id}"`));
  const { followUps } = await call("followups_list", { threadId: THREAD });
  assert.ok(followUps[0].sentAt, "the row is in progress");
});

test("next: Do on a row that is gone sends nothing", async () => {
  const { call, sent } = await host();
  assert.equal((await call("followups_next_do", { threadId: THREAD, id: "nope" })).outcome, "gone");
  assert.deepEqual(sent(), []);
});

test("next: a failed Do leaves the row unclaimed", async () => {
  const { call } = await host({ sendFails: true });
  const added = await call("followups_add", { threadId: THREAD, text: "Tidy the loader" });
  assert.equal((await call("followups_next_do", { threadId: THREAD, id: added.id })).outcome, "failed");
  const { followUps } = await call("followups_list", { threadId: THREAD });
  assert.equal(followUps[0].sentAt ?? null, null);
});

test("next: the standing rule follows its own switch, beside the capture rule", async () => {
  const { harness } = await host();
  const instructions = () =>
    harness.registrations.instructionProvider?.({ threadId: THREAD, projectId: "p" }) ?? null;
  assert.match(instructions() ?? "", /^Follow-ups: [\s\S]*\n\nNext steps: /);
  await harness.setSettings({ offerNextSteps: false });
  assert.doesNotMatch(instructions() ?? "", /Next steps:/);
  assert.match(instructions() ?? "", /^Follow-ups: /);
  await harness.setSettings({ captureRule: false });
  assert.equal(instructions(), null);
  await harness.setSettings({ offerNextSteps: true });
  assert.match(instructions() ?? "", /^Next steps: /);
});
