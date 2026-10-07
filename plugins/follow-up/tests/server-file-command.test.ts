// Filing through a command destination, end to end: the server finds the
// thread's host and checkout, the host entry runs the user's command there (a
// real shell, through the SDK's host harness), and the row is filed with the
// ref its output gave — or left open saying why.
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
  // What `gh issue create` prints: a line of chatter, then the issue's URL.
  command: 'echo "Creating issue for $FOLLOWUP_TITLE"; echo "https://github.com/acme/app/issues/$FOLLOWUP_ID"',
};
const broken: Destination = {
  id: "broken",
  name: "Broken",
  kind: "command",
  command: "echo 'gh: not logged in' >&2; exit 4",
};

async function host(options: { environmentId?: string | null } = {}) {
  const hostEntry = experimental_createHostEntryHarness(entry);
  const { bb, harness } = createFakePluginHost({
    experimental_callHostRpc: (call) =>
      hostEntry.experimental_call(call.method as "run_command", call.input as never),
  });
  harness.sdk.stub("threads.get", (args: { threadId: string }) => ({
    id: args.threadId,
    projectId: "proj_1",
    environmentId: options.environmentId === undefined ? "env_1" : options.environmentId,
  }));
  harness.sdk.stub("environments.get", () => ({ id: "env_1", hostId: "host_remote", path: checkout }));
  await plugin(bb);
  const call = (method: string, input: unknown) => harness.callRpc(method, input) as Promise<any>;
  await call("followups_set_destinations", { destinations: [gh, broken] });
  const add = async (text: string) => (await call("followups_add", { threadId: THREAD, text })).id as string;
  /** Wait for the background filing to land: no row says "filing…" any more. */
  const settled = async () => {
    for (let tries = 0; tries < 100; tries += 1) {
      const lists = await call("followups_list", { threadId: THREAD });
      if (![...lists.followUps, ...lists.done].some((row: any) => row.filingSince)) return lists;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    throw new Error("filing never settled");
  };
  const cli = async (argv: string[]) =>
    (await harness.runCli(argv, { threadId: THREAD })) as { exitCode: number; stdout: string; stderr: string };
  return { harness, call, add, settled, cli };
}

test("file: the command runs on the thread's own host, and the row is filed with its URL", async () => {
  const { harness, call, add, settled } = await host();
  const id = await add("Fix the restore");
  const started = await call("followups_file", { threadId: THREAD, ids: [id], destinationId: "github" });
  assert.deepEqual(started, { outcome: "started", destinationId: "github", count: 1 });
  const { followUps, done } = await settled();
  assert.deepEqual(followUps, []);
  assert.deepEqual(
    [done[0].filedTo, done[0].filedRef],
    [{ id: "github", name: "GitHub" }, `https://github.com/acme/app/issues/${id}`],
  );
  assert.deepEqual(
    harness.experimental_hostRpcCalls.map((c) => [c.method, c.hostId, (c.input as any).cwd]),
    [["run_command", "host_remote", checkout]],
  );
});

test("file: rows say they are being filed as soon as the answer comes back", async () => {
  const { call, add, settled } = await host();
  const id = await add("Fix the restore");
  await call("followups_file", { threadId: THREAD, ids: [id], destinationId: "github" });
  const { followUps } = await call("followups_list", { threadId: THREAD });
  const row = followUps.find((entry: any) => entry.id === id);
  // Either still on its way, or already filed: never back to plain open.
  assert.ok(row === undefined || typeof row.filingSince === "string");
  await settled();
});

test("file: the first destination picked in a project becomes its default; File all uses it", async () => {
  const { call, add, settled } = await host();
  assert.equal(
    (await call("followups_file", { threadId: THREAD, ids: null, destinationId: null })).outcome,
    "nothing-to-file",
  );
  await add("One");
  assert.equal(
    (await call("followups_file", { threadId: THREAD, ids: null, destinationId: null })).outcome,
    "no-destination",
  );
  await call("followups_file", { threadId: THREAD, ids: null, destinationId: "github" });
  await settled();
  assert.equal((await call("followups_destinations", { projectId: "proj_1" })).defaultId, "github");
  await add("Two");
  await add("Three");
  const all = await call("followups_file", { threadId: THREAD, ids: null, destinationId: null });
  assert.deepEqual([all.outcome, all.destinationId, all.count], ["started", "github", 2]);
  const { followUps, done } = await settled();
  assert.deepEqual([followUps.length, done.length], [0, 3]);
});

test("file: picking another destination later does not move the default", async () => {
  const { call, add, settled } = await host();
  await add("One");
  await call("followups_file", { threadId: THREAD, ids: null, destinationId: "github" });
  await settled();
  await add("Two");
  await call("followups_file", { threadId: THREAD, ids: null, destinationId: "broken" });
  await settled();
  assert.equal((await call("followups_destinations", { projectId: "proj_1" })).defaultId, "github");
});

test("file: a failing command leaves the row open, saying what it said", async () => {
  const { call, add, settled } = await host();
  const id = await add("Fix the restore");
  await call("followups_file", { threadId: THREAD, ids: [id], destinationId: "broken" });
  const { followUps, done } = await settled();
  assert.deepEqual(done, []);
  assert.equal(followUps[0].filingNote, "Broken exited 4: gh: not logged in");
  // And a later success clears the note.
  await call("followups_file", { threadId: THREAD, ids: [id], destinationId: "github" });
  const after = await settled();
  assert.equal(after.done[0].filingNote ?? null, null);
});

test("file: a thread with no checkout cannot run a command, and says so", async () => {
  const { call, add, settled, harness } = await host({ environmentId: null });
  const id = await add("Fix the restore");
  await call("followups_file", { threadId: THREAD, ids: [id], destinationId: "github" });
  const { followUps } = await settled();
  assert.equal(followUps[0].filingNote, "This thread has no checkout to run the command in.");
  assert.deepEqual(harness.experimental_hostRpcCalls, []);
});

test("file: a row already on its way is not filed a second time", async () => {
  const { call, add, settled, harness } = await host();
  await call("followups_set_destinations", {
    destinations: [gh, { ...gh, id: "slow", name: "Slow", command: "sleep 1; echo SLOW-1" }],
  });
  const id = await add("Fix the restore");
  await call("followups_file", { threadId: THREAD, ids: [id], destinationId: "slow" });
  const again = await call("followups_file", { threadId: THREAD, ids: [id], destinationId: "github" });
  assert.equal(again.outcome, "nothing-to-file");
  const { done } = await settled();
  assert.equal(done[0].filedRef, "SLOW-1");
  assert.equal(harness.experimental_hostRpcCalls.length, 1);
});

test("file: an unknown destination is refused, and nothing runs", async () => {
  const { call, add, harness } = await host();
  await add("One");
  assert.equal(
    (await call("followups_file", { threadId: THREAD, ids: null, destinationId: "linear" })).outcome,
    "unknown-destination",
  );
  assert.deepEqual(harness.experimental_hostRpcCalls, []);
});

test("bb follow-up file waits and reports each row, failing when one did not file", async () => {
  const { cli, add } = await host();
  const one = await add("Fix the restore");
  const ok = await cli(["file", one, "--to", "GitHub"]);
  assert.equal(ok.exitCode, 0, ok.stderr);
  assert.equal(ok.stdout, `Filed (https://github.com/acme/app/issues/${one}): Fix the restore\n`);
  await add("Rate-limit the export");
  const bad = await cli(["file", "--all", "--to", "broken"]);
  assert.equal(bad.exitCode, 1);
  assert.equal(bad.stdout, "Not filed: Rate-limit the export — Broken exited 4: gh: not logged in\n");
  assert.match((await cli(["file"])).stderr, /Name the follow-ups to file, or pass --all/);
});
