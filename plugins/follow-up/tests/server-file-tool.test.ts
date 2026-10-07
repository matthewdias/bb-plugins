// file_follow_ups: an agent files rows to a destination the user set up — and,
// unless the user said otherwise, only after they confirm it with one tap.
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import plugin from "../server.ts";
import entry from "../host.ts";
import type { Destination } from "../lib/destinations.ts";

process.env.SHELL = "/bin/sh";
process.env.HOME = realpathSync(mkdtempSync(join(tmpdir(), "followup-home-")));

const THREAD = "thr_a";
const checkout = realpathSync(mkdtempSync(join(tmpdir(), "followup-checkout-")));
const gh: Destination = {
  id: "github",
  name: "GitHub",
  kind: "command",
  command: 'echo "https://github.com/acme/app/issues/$FOLLOWUP_ID"',
};

async function host(options: { destinations?: Destination[]; withoutAsking?: boolean } = {}) {
  const hostEntry = experimental_createHostEntryHarness(entry);
  const { bb, harness } = createFakePluginHost({
    experimental_callHostRpc: (call) =>
      hostEntry.experimental_call(call.method as "run_command", call.input as never),
    ...(options.withoutAsking === true ? { settings: { agentFileWithoutAsking: true } } : {}),
  });
  harness.sdk.stub("threads.get", (args: { threadId: string }) => ({
    id: args.threadId,
    projectId: "proj_1",
    environmentId: "env_1",
  }));
  harness.sdk.stub("environments.get", () => ({ id: "env_1", hostId: "host_1", path: checkout }));
  await plugin(bb);
  const call = (method: string, input: unknown) => harness.callRpc(method, input) as Promise<any>;
  await call("followups_set_destinations", { destinations: options.destinations ?? [gh] });
  const add = async (text: string) => (await call("followups_add", { threadId: THREAD, text })).id as string;
  const tool = (input: unknown) =>
    harness.callAgentTool("file_follow_ups", input, { threadId: THREAD }) as Promise<unknown>;
  const asked = async () => {
    for (let tries = 0; tries < 100 && harness.pendingInteractions.length === 0; tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return harness.pendingInteractions[0];
  };
  return { harness, call, add, tool, asked };
}

test("file_follow_ups: asks first, naming where and what; files once the user says so", async () => {
  const { harness, call, add, tool, asked } = await host();
  const id = await add("Fix the restore");
  const pending = tool({ follow_ups: ["Fix the restore"], destination: "GitHub" });
  const question = await asked();
  assert.equal(question?.rendererId, "confirm-filing");
  assert.equal(question?.title, "File 1 follow-up to GitHub?");
  assert.deepEqual(question?.payload, {
    destination: "GitHub",
    kind: "command",
    rows: [{ id, text: "Fix the restore" }],
  });
  harness.submitInteraction(question!.id, { file: true });
  assert.equal(String(await pending), `Filed (https://github.com/acme/app/issues/${id}): Fix the restore`);
  const { done } = await call("followups_list", { threadId: THREAD });
  assert.deepEqual([done[0].filedTo.name, done[0].doneBy], ["GitHub", "agent"]);
});

test("file_follow_ups: a declined request files nothing", async () => {
  const { harness, call, add, tool, asked } = await host();
  await add("Fix the restore");
  const pending = tool({ all: true });
  // No default yet and no destination named: refused before anything is asked.
  assert.match(String(await pending), /no default destination.*Destinations set up: "GitHub"/s);
  const second = tool({ all: true, destination: "github" });
  harness.submitInteraction((await asked())!.id, { file: false });
  assert.match(String(await second), /did not confirm.*Nothing was filed/);
  assert.equal((await call("followups_list", { threadId: THREAD })).followUps.length, 1);
  assert.deepEqual(harness.experimental_hostRpcCalls, []);
});

test("file_follow_ups: with asking switched off, it files straight away", async () => {
  const { harness, add, tool } = await host({ withoutAsking: true });
  await add("Fix the restore");
  assert.match(String(await tool({ all: true, destination: "GitHub" })), /^Filed \(https:/);
  assert.deepEqual(harness.pendingInteractions, []);
});

test("file_follow_ups: rows filed while the user decided are not filed again", async () => {
  const { harness, call, add, tool, asked } = await host();
  const id = await add("Fix the restore");
  const pending = tool({ follow_ups: [id], destination: "GitHub" });
  const question = await asked();
  await call("followups_done", { threadId: THREAD, id, done: true });
  harness.submitInteraction(question!.id, { file: true });
  assert.match(String(await pending), /Nothing to file any more/);
  assert.deepEqual(harness.experimental_hostRpcCalls, []);
});

test("file_follow_ups: a name that matches nothing, or several, files nothing", async () => {
  const { add, tool } = await host();
  await add("Fix the restore");
  await add("Fix the export");
  assert.match(String(await tool({ follow_ups: ["Rename the flag"], destination: "GitHub" })), /No open follow-up matches "Rename the flag"/);
  assert.match(String(await tool({ follow_ups: ["Fix"], destination: "GitHub" })), /matches 2 follow-ups\. Nothing was filed/);
  assert.match(String(await tool({ all: true, destination: "Linear" })), /No destination called "Linear"\. Nothing was filed\. Destinations set up: "GitHub"/);
  assert.match(String(await tool({})), /Name the follow-ups to file, or pass all: true/);
});

test("file_follow_ups: with nothing set up, it says where the user would set it up", async () => {
  const { add, tool } = await host({ destinations: [] });
  await add("Fix the restore");
  assert.match(String(await tool({ all: true })), /has not set up anywhere to file follow-ups yet/);
});
