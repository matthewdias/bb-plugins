// A row's text is a title of at most TITLE_MAX characters; its detail carries
// the rest. Agents are held to it, people are helped into it, and rows
// recorded before it existed are left as they were.
import assert from "node:assert/strict";
import test from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../server.ts";
import {
  amendFollowUp,
  DETAIL_MAX,
  headlineCut,
  TITLE_MAX,
  titleAndDetail,
  type FollowUp,
} from "../lib/followups.ts";

const THREAD = "thr_a";
const LONG =
  "Fix Graveyard restore: reinstall store plugins through the store and say what Restore will install";

async function host() {
  const { bb, harness } = createFakePluginHost();
  harness.sdk.stub("threads.send", () => ({ ok: true, delivery: "sent" }));
  await plugin(bb);
  const call = (method: string, input: unknown) => harness.callRpc(method, input) as Promise<any>;
  const record = (input: unknown) =>
    harness.callAgentTool("record_follow_up", input, { threadId: THREAD });
  const amend = (input: unknown) =>
    harness.callAgentTool("amend_follow_up", input, { threadId: THREAD });
  const cli = async (argv: string[]) =>
    (await harness.runCli(argv, { threadId: THREAD })) as {
      exitCode: number;
      stdout: string;
      stderr: string;
    };
  /** A row as one recorded before titles were capped would be stored. */
  const seedLegacy = async (text: string, by: "agent" | "user" = "agent") => {
    const row: FollowUp = {
      id: "legacy01",
      text,
      reason: "deferred",
      file: null,
      detail: "Why it matters.",
      createdAt: "2026-10-01T00:00:00.000Z",
      createdBy: by,
    };
    await bb.storage.kv.set(`items:${THREAD}`, [row]);
    return row;
  };
  return { call, record, amend, cli, seedLegacy };
}

test("headlineCut: never longer than the limit, ellipsis included", () => {
  for (const text of [
    LONG,
    "x".repeat(300),
    "word ".repeat(40),
    "Docs: " + "update ".repeat(20),
    "abcde ".repeat(30),
  ]) {
    const title = headlineCut(text, TITLE_MAX);
    assert.ok(title.length <= TITLE_MAX, `${title.length}: ${title}`);
    assert.ok(title.endsWith("…"), title);
  }
  assert.equal(headlineCut("Tidy the loader", TITLE_MAX), "Tidy the loader");
});

test("titleAndDetail: a title passes through; a long text leads the detail, whole", () => {
  assert.deepEqual(titleAndDetail("Tidy the loader", "Because."), {
    text: "Tidy the loader",
    detail: "Because.",
  });
  assert.deepEqual(titleAndDetail(LONG, null), {
    text: "Fix Graveyard restore…",
    detail: LONG,
  });
  assert.deepEqual(titleAndDetail(LONG, "It loses provenance."), {
    text: "Fix Graveyard restore…",
    detail: `${LONG}\n\nIt loses provenance.`,
  });
  assert.equal(titleAndDetail(LONG, "y".repeat(DETAIL_MAX)).detail?.length, DETAIL_MAX);
});

test("amendFollowUp: new wording over the limit is refused; old wording can stay", () => {
  const legacy: FollowUp = {
    id: "a1",
    text: LONG,
    reason: "deferred",
    file: null,
    detail: null,
    createdAt: "2026-10-01T00:00:00.000Z",
  };
  assert.equal(amendFollowUp([legacy], "a1", { text: `${LONG}!` }, "user").outcome, "too-long");
  assert.equal(amendFollowUp([legacy], "a1", { text: LONG, detail: "More." }, "user").outcome, "amended");
  assert.equal(amendFollowUp([legacy], "a1", { text: "Fix Graveyard restore" }, "user").outcome, "amended");
});

test("record_follow_up: an agent's title over the limit is refused, not cut", async () => {
  const { call, record } = await host();
  await assert.rejects(() =>
    record({ text: "x".repeat(TITLE_MAX + 1), reason: "deferred" }),
  );
  await record({ text: "x".repeat(TITLE_MAX), reason: "deferred", detail: "All the rest." });
  const { followUps } = await call("followups_list", { threadId: THREAD });
  assert.equal(followUps.length, 1);
});

test("record_follow_up: its instructions ask for a title and put the rest in detail", async () => {
  const { bb, harness } = createFakePluginHost();
  await plugin(bb);
  const tool = harness.registrations.agentTools.find((entry) => entry.name === "record_follow_up");
  assert.match(tool?.instructions ?? "", new RegExp(`title of at most ${TITLE_MAX} characters`));
  assert.match(tool?.instructions ?? "", /why, where and how in detail/);
});

test("a row you write is split, never refused: its start is the title, all of it the detail", async () => {
  const { call } = await host();
  const added = await call("followups_add", { threadId: THREAD, text: LONG, detail: "From the draft." });
  assert.equal(added.outcome, "added");
  const [row] = added.followUps;
  assert.equal(row.text, "Fix Graveyard restore…");
  assert.equal(row.detail, `${LONG}\n\nFrom the draft.`);
  assert.equal(row.createdBy, "user");
});

test("bb follow-up add splits a long text the same way and says what it recorded", async () => {
  const { call, cli } = await host();
  const result = await cli(["add", ...LONG.split(" ")]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /^Recorded [0-9a-f]{8}: Fix Graveyard restore…\n$/);
  const { followUps } = await call("followups_list", { threadId: THREAD });
  assert.equal(followUps[0].detail, LONG);
});

test("keeping a long next step as a follow-up splits it too", async () => {
  const { call, harness } = await (async () => {
    const { bb, harness } = createFakePluginHost();
    await plugin(bb);
    return {
      harness,
      call: (method: string, input: unknown) => harness.callRpc(method, input) as Promise<any>,
    };
  })();
  const step = "Open a PR against main and ask the release owner to review it";
  await harness.callAgentTool("offer_next_steps", { steps: [step] }, { threadId: THREAD });
  const { offer } = await call("followups_next_get", { threadId: THREAD });
  const kept = await call("followups_next_keep", {
    threadId: THREAD,
    offeredAt: offer.offeredAt,
    index: 0,
  });
  assert.equal(kept.outcome, "added");
  assert.equal(kept.followUps[0].text, "Open a PR against main and ask the release owner…");
  assert.equal(kept.followUps[0].detail, step);
});

test("a row recorded before titles were capped is left as written", async () => {
  const { call, seedLegacy } = await host();
  await seedLegacy(LONG);
  const { followUps } = await call("followups_list", { threadId: THREAD });
  assert.equal(followUps[0].text, LONG);
});

test("editing an old long row: detail alone is fine, new wording has to fit", async () => {
  const { call, seedLegacy } = await host();
  await seedLegacy(LONG, "user");
  const detailOnly = await call("followups_amend", {
    threadId: THREAD,
    id: "legacy01",
    detail: "Updated.",
  });
  assert.equal(detailOnly.outcome, "amended");
  const reworded = await call("followups_amend", {
    threadId: THREAD,
    id: "legacy01",
    text: `${LONG} soon`,
  });
  assert.equal(reworded.outcome, "too-long");
  assert.equal(reworded.followUps[0].text, LONG);
});

test("an agent can still find and finish an old long row by its words", async () => {
  // Lookup keeps the old bound: a row recorded at 240 characters is named by
  // up to 240 of them, so capping titles must not strand it.
  const { bb, harness } = createFakePluginHost();
  await plugin(bb);
  await bb.storage.kv.set(`items:${THREAD}`, [
    {
      id: "legacy01",
      text: LONG,
      reason: "deferred",
      file: null,
      detail: null,
      createdAt: "2026-10-01T00:00:00.000Z",
    },
  ]);
  const result = await harness.callAgentTool(
    "complete_follow_up",
    { follow_up: LONG, note: "Done." },
    { threadId: THREAD },
  );
  assert.doesNotMatch(String(result), /No follow-up|not found|ambiguous/i);
  const { done } = (await harness.callRpc("followups_list", { threadId: THREAD })) as {
    done: FollowUp[];
  };
  assert.deepEqual(done.map((row) => row.id), ["legacy01"]);
});

test("bb follow-up amend says why a long title was refused", async () => {
  const { cli, seedLegacy } = await host();
  await seedLegacy("Tidy the loader", "user");
  const result = await cli(["amend", "legacy01", "--text", "x".repeat(TITLE_MAX + 1)]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, new RegExp(`title of at most ${TITLE_MAX} characters`));
});

test("amend_follow_up: an agent's replacement title over the limit is refused", async () => {
  const { amend, seedLegacy } = await host();
  await seedLegacy("Tidy the loader");
  await assert.rejects(() => amend({ follow_up: "legacy01", text: "x".repeat(TITLE_MAX + 1) }));
  assert.match(String(await amend({ follow_up: "legacy01", text: "Tidy the config loader" })), /^Amended/);
});
