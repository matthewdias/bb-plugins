// Filing: a row tracked somewhere else. It is done, it says where it went, and
// its text cannot be recorded on this thread again — even after Done is
// cleared — until someone reopens it.
import assert from "node:assert/strict";
import test from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../server.ts";
import {
  addFollowUp,
  fileFollowUp,
  unfiled,
  withMarks,
  withoutMarks,
  type FollowUp,
} from "../lib/followups.ts";

const THREAD = "thr_a";
const AT = "2026-10-06T12:00:00.000Z";
const JIRA = { id: "jira-eng", name: "Jira ENG" };

const row = (id: string, text: string, extra: Partial<FollowUp> = {}): FollowUp => ({
  id,
  text,
  reason: "deferred",
  file: null,
  detail: null,
  createdAt: AT,
  ...extra,
});

test("fileFollowUp: done, with where it went, and a mark for every text it answers to", () => {
  const list = [row("a", "Fix the restore", { aliases: ["fix the graveyard restore"] }), row("b", "Other")];
  const result = fileFollowUp(list, "a", { to: JIRA, ref: " ENG-1482 ", at: AT, by: "user" });
  assert.equal(result.outcome, "filed");
  const filed = result.list[0]!;
  assert.deepEqual(
    [filed.doneAt, filed.doneBy, filed.doneNote, filed.filedAt, filed.filedTo, filed.filedRef],
    [AT, "user", "Filed to Jira ENG: ENG-1482", AT, JIRA, "ENG-1482"],
  );
  assert.deepEqual(result.marks, [
    { key: "fix the restore", to: "Jira ENG", ref: "ENG-1482" },
    { key: "fix the graveyard restore", to: "Jira ENG", ref: "ENG-1482" },
  ]);
  assert.equal(result.list[1], list[1]);
});

test("fileFollowUp: a blank ref is no ref; a filed row cannot be filed twice", () => {
  const once = fileFollowUp([row("a", "Fix it")], "a", { to: JIRA, ref: "  ", at: AT, by: "user" });
  assert.equal(once.list[0]!.filedRef, null);
  assert.equal(once.list[0]!.doneNote, "Filed to Jira ENG");
  const twice = fileFollowUp(once.list, "a", { to: JIRA, ref: "ENG-1", at: AT, by: "user" });
  assert.equal(twice.outcome, "already-filed");
  assert.deepEqual(twice.marks, []);
  assert.equal(fileFollowUp([], "a", { to: JIRA, ref: null, at: AT, by: "user" }).outcome, "not-found");
});

test("addFollowUp: a filed text is refused and says where it went; dismissal still wins", () => {
  const marks = [{ key: "fix it", to: "Jira ENG", ref: "ENG-1" }];
  const filed = addFollowUp([], row("x", "Fix it."), [], 50, marks);
  assert.equal(filed.outcome, "filed");
  assert.deepEqual(filed.filedAs, marks[0]);
  assert.equal(addFollowUp([], row("x", "Fix it"), ["fix it"], 50, marks).outcome, "dismissed");
  assert.equal(addFollowUp([], row("x", "Something else"), [], 50, marks).outcome, "added");
});

test("marks: one per key, newest wins; a reopened row's are dropped", () => {
  const a = { key: "k", to: "A", ref: null };
  const b = { key: "k", to: "B", ref: "2" };
  assert.deepEqual(withMarks([a], [b]), [b]);
  assert.deepEqual(withoutMarks([a, { key: "j", to: "A", ref: null }], ["k"]), [{ key: "j", to: "A", ref: null }]);
  const filed = fileFollowUp([row("a", "Fix it")], "a", { to: JIRA, ref: "X", at: AT, by: "user" }).list[0]!;
  assert.deepEqual([unfiled(filed).filedAt, unfiled(filed).filedTo, unfiled(filed).filedRef], [null, null, null]);
});

async function host() {
  const { bb, harness } = createFakePluginHost();
  await plugin(bb);
  const cli = async (argv: string[]) =>
    (await harness.runCli(argv, { threadId: THREAD })) as { exitCode: number; stdout: string; stderr: string };
  const call = (method: string, input: unknown) => harness.callRpc(method, input) as Promise<any>;
  const add = async (text: string) => (await call("followups_add", { threadId: THREAD, text })).id as string;
  const record = (text: string) =>
    harness.callAgentTool("record_follow_up", { text, reason: "deferred" }, { threadId: THREAD });
  return { harness, cli, call, add, record };
}

test("bb follow-up filed: the row moves to Done, saying where it went", async () => {
  const { cli, call, add } = await host();
  const id = await add("Fix the restore");
  const result = await cli(["filed", id, "--to", "Jira ENG", "--ref", "https://jira.example/ENG-1482"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "Filed to Jira ENG (https://jira.example/ENG-1482): Fix the restore\n");
  const { followUps, done } = await call("followups_list", { threadId: THREAD });
  assert.deepEqual(followUps, []);
  assert.deepEqual(
    [done[0].filedTo, done[0].filedRef, done[0].doneBy],
    [{ id: "jira-eng", name: "Jira ENG" }, "https://jira.example/ENG-1482", "user"],
  );
});

test("a filed text is not recorded again, by an agent or a person, even after Clear Done", async () => {
  const { cli, call, add, record } = await host();
  const id = await add("Fix the restore");
  await cli(["filed", id, "--to", "Jira ENG", "--ref", "ENG-1482"]);
  assert.match(String(await record("Fix the restore")), /filed to Jira ENG .*\(ENG-1482\).*not re-adding/);
  assert.equal((await call("followups_add", { threadId: THREAD, text: "fix the restore!" })).outcome, "filed");
  await call("followups_clear_done", { threadId: THREAD });
  assert.equal((await call("followups_list", { threadId: THREAD })).done.length, 0);
  assert.equal((await call("followups_add", { threadId: THREAD, text: "Fix the restore" })).outcome, "filed");
  const cliAdd = await cli(["add", "Fix", "the", "restore"]);
  assert.equal(cliAdd.exitCode, 1);
  assert.match(cliAdd.stderr, /filed elsewhere/);
});

test("reopening a filed row makes it this thread's again", async () => {
  const { cli, call, add } = await host();
  const id = await add("Fix the restore");
  await cli(["filed", id, "--to", "Jira ENG"]);
  await call("followups_done", { threadId: THREAD, id, done: false });
  const { followUps } = await call("followups_list", { threadId: THREAD });
  assert.equal(followUps[0].filedTo ?? null, null);
  // Its filed mark went with the filing: finished the ordinary way and
  // cleared from Done, its text is free to be recorded again — which a
  // lingering mark would refuse as "filed".
  await call("followups_done", { threadId: THREAD, id, done: true });
  await call("followups_clear_done", { threadId: THREAD });
  assert.equal((await call("followups_add", { threadId: THREAD, text: "Fix the restore" })).outcome, "added");
});

test("filing twice, or filing a row that is not there, says so", async () => {
  const { cli, add } = await host();
  const id = await add("Fix the restore");
  await cli(["filed", id, "--to", "Jira ENG", "--ref", "ENG-1"]);
  const again = await cli(["filed", id, "--to", "GitHub"]);
  assert.equal(again.exitCode, 1);
  assert.match(again.stderr, /Already filed to Jira ENG \(ENG-1\)/);
  const missing = await cli(["filed", "nope", "--to", "GitHub"]);
  assert.match(missing.stderr, /No follow-up with id nope/);
});

test("a filed row counts as settled for anyone drawing progress", async () => {
  const { cli, call, add } = await host();
  await add("Still open");
  await cli(["filed", await add("Filed away"), "--to", "Jira ENG"]);
  assert.deepEqual(await call("getFollowUpCountsV1", { threadIds: [THREAD] }), {
    protocolVersion: 1,
    counts: [{ threadId: THREAD, open: 1, done: 1 }],
  });
});
