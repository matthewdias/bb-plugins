// Wrap up, end to end on the server: each open row carried out as decided,
// then the thread archived — only once every filing has landed, and not at all
// when one did not.
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
import type { Disposition } from "../lib/wrap-up.ts";

process.env.SHELL = "/bin/sh";
process.env.HOME = realpathSync(mkdtempSync(join(tmpdir(), "followup-home-")));

const THREAD = "thr_a";
const checkout = realpathSync(mkdtempSync(join(tmpdir(), "followup-checkout-")));
const gh: Destination = {
  id: "github",
  name: "GitHub",
  kind: "command",
  // Long enough that the wrap-up answers before it lands.
  command: 'sleep 0.3; echo "https://github.com/acme/app/issues/$FOLLOWUP_ID"',
};
const broken: Destination = {
  id: "broken",
  name: "Broken",
  kind: "command",
  command: "sleep 0.2; echo 'gh: not logged in' >&2; exit 4",
};
const jira: Destination = { id: "jira", name: "Jira ENG", kind: "agent", recipe: "Create an ENG issue." };

const GIT_WORKTREE = {
  id: "env_1",
  hostId: "host_1",
  path: checkout,
  isGitRepo: true,
  environmentProviderId: "git-worktree",
  environmentProviderSelection: {
    machine: { type: "existing", hostId: "host_1" },
    inputs: { branch: { kind: "default" } },
  },
};

async function host(
  options: {
    status?: string;
    environment?: Record<string, unknown>;
    spawnFails?: boolean;
    children?: { status: string }[];
  } = {},
) {
  const hostEntry = experimental_createHostEntryHarness(entry);
  const { bb, harness } = createFakePluginHost({
    experimental_callHostRpc: (call) =>
      hostEntry.experimental_call(call.method as "run_command", call.input as never),
  });
  let status = options.status ?? "idle";
  harness.sdk.stub("threads.get", (args: { threadId: string }) => ({
    id: args.threadId,
    projectId: "proj_1",
    environmentId: "env_1",
    status,
  }));
  harness.sdk.stub("environments.get", () => options.environment ?? GIT_WORKTREE);
  harness.sdk.stub("threads.archive", (args: { threadId: string }) => ({
    ok: true,
    archivedThreadIds: [args.threadId],
  }));
  let spawned = 0;
  harness.sdk.stub("threads.spawn", () => {
    if (options.spawnFails === true) throw new Error("no provider");
    return { id: `thr_new${++spawned}` };
  });
  harness.sdk.stub("threads.list", () => options.children ?? []);
  await plugin(bb);
  const call = (method: string, input: unknown) => harness.callRpc(method, input) as Promise<any>;
  await call("followups_set_destinations", { destinations: [gh, broken, jira] });
  const add = async (text: string) => (await call("followups_add", { threadId: THREAD, text })).id as string;
  const lists = () => call("followups_list", { threadId: THREAD });
  const wrapUp = (plan: [string, Disposition][], archive = true) =>
    call("followups_wrap_up", {
      threadId: THREAD,
      plan: plan.map(([id, disposition]) => ({ id, disposition })),
      archive,
    });
  const archived = () => harness.sdk.callsTo("threads.archive").map((args) => (args[0] as any).threadId);
  const spawns = () => harness.sdk.callsTo("threads.spawn").map((args) => args[0] as Record<string, any>);
  /** Until the wrap-up stops waiting: archived, held, or gone. */
  const settled = async () => {
    for (let tries = 0; tries < 150; tries += 1) {
      const { state } = await call("followups_wrap_up_get", { threadId: THREAD });
      if (state === null || state.status === "held") return state;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    throw new Error("wrap-up never settled");
  };
  /**
   * The stored record, read without asking the server — whose own reads
   * settle a wrap-up, and would hide a filing that never asked.
   */
  const raw = async () => (await bb.storage.kv.get<any>(`wrap-up:${THREAD}`)) ?? null;
  const until = async (done: () => Promise<boolean> | boolean, what: string) => {
    for (let tries = 0; tries < 150; tries += 1) {
      if (await done()) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`never: ${what}`);
  };
  return {
    harness,
    raw,
    until,
    call,
    add,
    lists,
    wrapUp,
    archived,
    spawns,
    settled,
    setStatus: (next: string) => {
      status = next;
    },
  };
}

test("wrap up: done, dismissed and kept rows need no waiting; the thread is archived at once", async () => {
  const { add, lists, wrapUp, archived, call } = await host();
  const a = await add("Fix the restore");
  const b = await add("Remove the legacy flag");
  const c = await add("Port the exporter");
  const result = await wrapUp([
    [a, { kind: "done" }],
    [b, { kind: "dismiss" }],
    [c, { kind: "keep" }],
  ]);
  assert.deepEqual(result, { outcome: "archived", message: null });
  assert.deepEqual(archived(), [THREAD]);
  const { followUps, done } = await lists();
  assert.deepEqual(followUps.map((row: any) => row.id), [c]);
  assert.deepEqual([done.map((row: any) => row.id), done[0].doneBy], [[a], "user"]);
  // Dismissed means dismissed: the text does not come back.
  assert.equal((await add("Remove the legacy flag")) ?? null, null);
  assert.equal((await call("followups_wrap_up_get", { threadId: THREAD })).state, null);
});

test("wrap up: the archive waits for a filing to land, then happens", async () => {
  const { add, lists, wrapUp, archived, until } = await host();
  const a = await add("Rate-limit the export");
  const result = await wrapUp([[a, { kind: "file", destinationId: "github" }]]);
  assert.equal(result.outcome, "waiting");
  assert.deepEqual(archived(), [], "not while the command still runs");
  // The filing landing is what archives, with nobody asking.
  await until(() => archived().length > 0, "archived");
  assert.deepEqual(archived(), [THREAD]);
  const { done } = await lists();
  assert.equal(done[0].filedRef, `https://github.com/acme/app/issues/${a}`);
});

test("wrap up: a filing that fails holds the archive, saying why, until let go of", async () => {
  const { add, lists, wrapUp, archived, settled, call, raw, until } = await host();
  // Quick, so the failure is the last thing to land and has to settle it.
  await call("followups_set_destinations", {
    destinations: [{ ...gh, command: 'echo "https://github.com/acme/app/issues/$FOLLOWUP_ID"' }, broken],
  });
  const a = await add("Rate-limit the export");
  const b = await add("Fix the restore");
  await wrapUp([
    [a, { kind: "file", destinationId: "broken" }],
    [b, { kind: "file", destinationId: "github" }],
  ]);
  // Held by the filings settling, with nobody asking.
  await until(async () => (await raw())?.held != null, "held");
  const state = await settled();
  assert.equal(state.status, "held");
  assert.equal(state.held, "1 follow-up didn't go where you sent it, so this thread was not archived.");
  assert.deepEqual(state.failed, [{ id: a, note: "Broken exited 4: gh: not logged in" }]);
  assert.deepEqual(archived(), []);
  // The other one still filed; the failed one is open, saying why.
  const { followUps, done } = await lists();
  assert.deepEqual([followUps[0].id, done[0].id], [a, b]);
  assert.deepEqual(await call("followups_wrap_up_forget", { threadId: THREAD }), { forgotten: true });
  assert.equal((await call("followups_wrap_up_get", { threadId: THREAD })).state, null);
});

test("wrap up: a held wrap-up can be wrapped up again, and then archives", async () => {
  const { add, wrapUp, archived, settled } = await host();
  const a = await add("Rate-limit the export");
  await wrapUp([[a, { kind: "file", destinationId: "broken" }]]);
  assert.equal((await settled()).status, "held");
  const again = await wrapUp([[a, { kind: "keep" }]]);
  assert.equal(again.outcome, "archived");
  assert.deepEqual(archived(), [THREAD]);
});

test("wrap up: rows already being filed when it started hold the archive too", async () => {
  const { add, call, wrapUp, archived, settled } = await host();
  const a = await add("Rate-limit the export");
  const b = await add("Fix the restore");
  await call("followups_file", { threadId: THREAD, ids: [a], destinationId: "broken" });
  // `a` is filing, so it is not the popup's to decide about.
  const result = await wrapUp([[b, { kind: "done" }]]);
  assert.equal(result.outcome, "waiting");
  assert.equal((await settled()).status, "held");
  assert.deepEqual(archived(), []);
});

test("wrap up: a row that arrived while deciding refuses the lot, and nothing happens", async () => {
  const { add, lists, wrapUp, archived } = await host();
  const a = await add("Fix the restore");
  await add("Something the agent noticed just now");
  const result = await wrapUp([[a, { kind: "done" }]]);
  assert.equal(result.outcome, "changed");
  assert.deepEqual(archived(), []);
  assert.equal((await lists()).followUps.length, 2);
});

test("wrap up: a plan naming a row twice, or one that is not open, refuses the lot", async () => {
  const { add, wrapUp, archived, lists } = await host();
  const a = await add("Fix the restore");
  assert.equal((await wrapUp([[a, { kind: "done" }], [a, { kind: "keep" }]])).outcome, "changed");
  // Every open row decided, and one more that is not open: still refused.
  assert.equal((await wrapUp([[a, { kind: "done" }], ["nope", { kind: "done" }]])).outcome, "changed");
  await add("Rate-limit the export");
  assert.equal((await wrapUp([[a, { kind: "done" }], ["nope", { kind: "done" }]])).outcome, "changed");
  assert.deepEqual(archived(), []);
  assert.equal((await lists()).done.length, 0);
});

test("wrap up: a destination that is no longer set up refuses the lot", async () => {
  const { add, wrapUp, archived, lists } = await host();
  const a = await add("Fix the restore");
  const b = await add("Rate-limit the export");
  const result = await wrapUp([
    [a, { kind: "done" }],
    [b, { kind: "file", destinationId: "linear" }],
  ]);
  assert.deepEqual(result, { outcome: "changed", message: "A destination you picked is no longer set up." });
  assert.deepEqual(archived(), []);
  assert.equal((await lists()).done.length, 0);
});

test("wrap up: not while the agent is working", async () => {
  const { add, wrapUp, archived } = await host({ status: "active" });
  const a = await add("Fix the restore");
  assert.equal((await wrapUp([[a, { kind: "done" }]])).outcome, "running");
  assert.deepEqual(archived(), []);
});

test("wrap up: leaving the thread open files and closes rows, and archives nothing", async () => {
  const { add, wrapUp, archived, lists, call } = await host();
  const a = await add("Fix the restore");
  const b = await add("Rate-limit the export");
  const result = await wrapUp(
    [
      [a, { kind: "done" }],
      [b, { kind: "file", destinationId: "github" }],
    ],
    false,
  );
  assert.deepEqual(result, { outcome: "finished", message: null });
  assert.equal((await call("followups_wrap_up_get", { threadId: THREAD })).state, null);
  for (let tries = 0; tries < 100 && (await lists()).done.length < 2; tries += 1) {
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  assert.equal((await lists()).done.length, 2);
  assert.deepEqual(archived(), []);
});

test("wrap up: a turn starting while it waits calls the archive off", async () => {
  const { harness, add, wrapUp, archived, settled } = await host();
  const a = await add("Rate-limit the export");
  assert.equal((await wrapUp([[a, { kind: "file", destinationId: "github" }]])).outcome, "waiting");
  await harness.emitThreadEvent("thread.active", { thread: { id: THREAD } } as never);
  const state = await settled();
  assert.equal(state.held, "A new turn started, so this thread was not archived.");
  // The filing itself still lands; only the archive is off.
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.deepEqual(archived(), []);
});

test("wrap up: hand-offs are independent threads, here or in a new worktree like this one", async () => {
  const { add, wrapUp, spawns, lists, archived } = await host();
  const a = await add("Port the exporter");
  const b = await add("Split the queue worker");
  const result = await wrapUp([
    [a, { kind: "handoff", where: "here" }],
    [b, { kind: "handoff", where: "new-worktree" }],
  ]);
  assert.equal(result.outcome, "archived");
  assert.deepEqual(archived(), [THREAD]);
  const [here, worktree] = spawns();
  // Never children: the archive would take them with it.
  assert.equal("parentThreadId" in here!, false);
  assert.equal("parentThreadId" in worktree!, false);
  assert.deepEqual(here!.environment, { type: "reuse", environmentId: "env_1" });
  assert.deepEqual(worktree!.environment, {
    environmentProviderId: "git-worktree",
    inputs: { branch: { kind: "default" } },
    machine: { type: "existing", hostId: "host_1" },
  });
  assert.match(here!.prompt, /^Port the exporter/);
  const { done } = await lists();
  assert.deepEqual(
    done.map((row: any) => row.doneNote).sort(),
    ["handed off to thr_new1", "handed off to thr_new2"],
  );
});

test("wrap up: a hand-off that cannot start holds the archive, and the row stays open", async () => {
  const { add, wrapUp, archived, lists, call } = await host({ spawnFails: true });
  const a = await add("Port the exporter");
  const result = await wrapUp([[a, { kind: "handoff", where: "here" }]]);
  assert.equal(result.outcome, "held");
  assert.deepEqual(archived(), []);
  assert.equal((await lists()).followUps[0].id, a);
  const { state } = await call("followups_wrap_up_get", { threadId: THREAD });
  assert.deepEqual(state.failed, [{ id: a, note: "The new thread could not be started." }]);
});

test("wrap up: with no worktree possible, a new-worktree hand-off refuses before anything happens", async () => {
  const { add, wrapUp, spawns, lists } = await host({
    environment: { ...GIT_WORKTREE, isGitRepo: false },
  });
  const a = await add("Fix the restore");
  const b = await add("Port the exporter");
  const result = await wrapUp([
    [a, { kind: "done" }],
    [b, { kind: "handoff", where: "new-worktree" }],
  ]);
  assert.equal(result.outcome, "failed");
  assert.deepEqual(spawns(), []);
  assert.equal((await lists()).done.length, 0);
});

test("wrap up: an agent destination's helper reports, and then the thread is archived", async () => {
  const { harness, add, wrapUp, archived, spawns } = await host();
  const a = await add("Rate-limit the export");
  assert.equal((await wrapUp([[a, { kind: "file", destinationId: "jira" }]])).outcome, "waiting");
  for (let tries = 0; tries < 50 && spawns().length === 0; tries += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.deepEqual(archived(), []);
  const reported = (await harness.runCli(
    ["filed", a, "--thread", THREAD, "--to", "Jira ENG", "--ref", "ENG-9"],
    { threadId: "thr_new1" },
  )) as { exitCode: number; stderr: string };
  assert.equal(reported.exitCode, 0, reported.stderr);
  for (let tries = 0; tries < 50 && archived().length === 0; tries += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.deepEqual(archived(), [THREAD]);
});

test("wrap up: a second wrap-up while one waits is refused, and it cannot be let go of", async () => {
  const { add, wrapUp, settled, call } = await host();
  const a = await add("Rate-limit the export");
  await wrapUp([[a, { kind: "file", destinationId: "github" }]]);
  assert.equal((await wrapUp([])).outcome, "busy");
  assert.deepEqual(await call("followups_wrap_up_forget", { threadId: THREAD }), { forgotten: false });
  assert.equal((await call("followups_wrap_up_get", { threadId: THREAD })).state.status, "running");
  await settled();
});

test("wrap up: a filing landing while it is still being carried out does not archive early", async () => {
  // A row already on its way lands while a hand-off is still starting; the
  // wrap-up has more to do, and a later filing of it fails.
  const { harness, add, call, wrapUp, archived, settled } = await host();
  harness.sdk.stub("threads.spawn", async () => {
    await new Promise((resolve) => setTimeout(resolve, 600));
    return { id: "thr_slow" };
  });
  const a = await add("Fix the restore");
  const b = await add("Port the exporter");
  const c = await add("Rate-limit the export");
  await call("followups_set_destinations", {
    destinations: [{ ...gh, id: "quick", name: "Quick", command: "echo QUICK-1" }, broken],
  });
  await call("followups_file", { threadId: THREAD, ids: [a], destinationId: "quick" });
  await wrapUp([
    [b, { kind: "handoff", where: "here" }],
    [c, { kind: "file", destinationId: "broken" }],
  ]);
  assert.equal((await settled()).status, "held");
  assert.deepEqual(archived(), []);
});

test("wrap up state: counts down the filings still on their way", async () => {
  const { add, call, wrapUp, lists, until, settled } = await host();
  await call("followups_set_destinations", {
    destinations: [gh, { ...gh, id: "quick", name: "Quick", command: "echo QUICK-1" }],
  });
  const a = await add("Fix the restore");
  const b = await add("Rate-limit the export");
  await wrapUp([
    [a, { kind: "file", destinationId: "quick" }],
    [b, { kind: "file", destinationId: "github" }],
  ]);
  await until(async () => (await lists()).done.length === 1, "the quick one filed");
  const { state } = await call("followups_wrap_up_state", { threadId: THREAD });
  assert.deepEqual([state.status, state.waitingOn], ["running", 1]);
  await settled();
});

test("wrap up: the first destination picked becomes the project's default", async () => {
  const { add, wrapUp, settled, call } = await host();
  const a = await add("Rate-limit the export");
  await wrapUp([[a, { kind: "file", destinationId: "github" }]]);
  await settled();
  assert.equal((await call("followups_destinations", { projectId: "proj_1" })).defaultId, "github");
});

test("wrap up state: whether a new worktree is possible, and the children an archive takes", async () => {
  const git = await host({ children: [{ status: "active" }, { status: "idle" }] });
  assert.deepEqual(await git.call("followups_wrap_up_get", { threadId: THREAD }), {
    state: null,
    newWorktree: true,
    children: { open: 2, running: 1 },
  });
  const plain = await host({ environment: { ...GIT_WORKTREE, isGitRepo: false } });
  assert.equal((await plain.call("followups_wrap_up_get", { threadId: THREAD })).newWorktree, false);
});
