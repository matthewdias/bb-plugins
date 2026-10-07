// Destinations: the user's own list of where follow-ups can be filed, and the
// rules for handing a row to one and reading back where it went.
import assert from "node:assert/strict";
import test from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../server.ts";
import {
  commandEnv,
  commandStdin,
  destinationSchema,
  DESTINATIONS_MAX,
  findDestination,
  parseDestinations,
  refFromOutput,
  REF_MAX,
  slugFor,
  type Destination,
} from "../lib/destinations.ts";
import type { FollowUp } from "../lib/followups.ts";

const gh: Destination = { id: "github", name: "GitHub", kind: "command", command: "gh issue create" };
const jira: Destination = { id: "jira-eng", name: "Jira ENG", kind: "agent", recipe: "File it in ENG." };

test("destinationSchema: a command needs a command, an agent a recipe", () => {
  assert.ok(destinationSchema.safeParse(gh).success);
  assert.ok(destinationSchema.safeParse(jira).success);
  assert.ok(!destinationSchema.safeParse({ ...gh, command: "  " }).success);
  assert.ok(!destinationSchema.safeParse({ id: "x", name: "X", kind: "agent", command: "ls" }).success);
  assert.ok(!destinationSchema.safeParse({ ...gh, id: "Not A Slug" }).success);
});

test("parseDestinations: what no longer parses is dropped; a repeated id keeps its first", () => {
  assert.deepEqual(parseDestinations("nope"), []);
  assert.deepEqual(parseDestinations([gh, { id: "bad" }, { ...jira, id: "github" }, jira]), [gh, jira]);
  const many = Array.from({ length: DESTINATIONS_MAX + 5 }, (_, n) => ({ ...gh, id: `d${n}`, name: `D${n}` }));
  assert.equal(parseDestinations(many).length, DESTINATIONS_MAX);
});

test("findDestination: by id, or by name ignoring case", () => {
  assert.equal(findDestination([gh, jira], "jira-eng"), jira);
  assert.equal(findDestination([gh, jira], " jira eng "), jira);
  assert.equal(findDestination([gh, jira], "Linear"), null);
});

test("slugFor: a name as an id", () => {
  assert.equal(slugFor("Jira ENG (main)"), "jira-eng-main");
  assert.equal(slugFor("!!!"), "destination");
});

test("refFromOutput: the first URL printed, else the last line, else nothing", () => {
  assert.equal(
    refFromOutput("Creating issue in acme/app\n\nhttps://github.com/acme/app/issues/212.\n"),
    "https://github.com/acme/app/issues/212",
  );
  assert.equal(refFromOutput("✓ Issue created\nENG-1482\n\n"), "ENG-1482");
  assert.equal(refFromOutput("   \n"), null);
  assert.equal(refFromOutput("x".repeat(REF_MAX + 50))?.length, REF_MAX);
});

test("a row reaches a command as variables and JSON, never as part of its text", () => {
  const row: FollowUp = {
    id: "a1",
    text: 'Fix $(rm -rf ~) "quotes"',
    reason: "deferred",
    file: "src/x.ts:12",
    detail: "Why.",
    createdAt: "2026-10-06T00:00:00.000Z",
  };
  assert.deepEqual(commandEnv(row, "thr_a"), {
    FOLLOWUP_ID: "a1",
    FOLLOWUP_TITLE: 'Fix $(rm -rf ~) "quotes"',
    FOLLOWUP_DETAIL: "Why.",
    FOLLOWUP_FILE: "src/x.ts:12",
    FOLLOWUP_REASON: "deferred",
    FOLLOWUP_THREAD: "thr_a",
  });
  assert.deepEqual(JSON.parse(commandStdin(row, "thr_a")), {
    id: "a1",
    title: 'Fix $(rm -rf ~) "quotes"',
    detail: "Why.",
    file: "src/x.ts:12",
    reason: "deferred",
    thread: "thr_a",
  });
});

async function host() {
  const { bb, harness } = createFakePluginHost();
  harness.sdk.stub("threads.get", (args: { threadId: string }) => ({
    id: args.threadId,
    projectId: "proj_1",
    environmentId: "env_1",
  }));
  await plugin(bb);
  const call = (method: string, input: unknown) => harness.callRpc(method, input) as Promise<any>;
  const cli = async (argv: string[]) =>
    (await harness.runCli(argv, { threadId: "thr_a" })) as { exitCode: number; stdout: string; stderr: string };
  return { call, cli };
}

test("rpc: the list saves and reads back; names must differ; ids are made unique", async () => {
  const { call } = await host();
  assert.deepEqual(await call("followups_destinations", { projectId: null }), {
    destinations: [],
    defaultId: null,
  });
  const saved = await call("followups_set_destinations", {
    destinations: [gh, { ...jira, id: "github", name: "GitHub mirror" }],
  });
  assert.equal(saved.outcome, "saved");
  assert.deepEqual(saved.destinations.map((d: Destination) => d.id), ["github", "github-2"]);
  const clash = await call("followups_set_destinations", {
    destinations: [gh, { ...jira, name: "github" }],
  });
  assert.equal(clash.outcome, "duplicate-name");
  assert.equal(clash.destinations.length, 2, "nothing was overwritten");
});

test("rpc: each project remembers its own default, and only a destination that exists", async () => {
  const { call } = await host();
  await call("followups_set_destinations", { destinations: [gh, jira] });
  assert.deepEqual(await call("followups_set_default_destination", { projectId: "p1", id: "jira-eng" }), {
    defaultId: "jira-eng",
  });
  assert.equal((await call("followups_destinations", { projectId: "p1" })).defaultId, "jira-eng");
  assert.equal((await call("followups_destinations", { projectId: "p2" })).defaultId, null);
  assert.deepEqual(await call("followups_set_default_destination", { projectId: "p1", id: "nope" }), {
    defaultId: "jira-eng",
  });
  // A default whose destination was removed is no default.
  await call("followups_set_destinations", { destinations: [gh] });
  assert.equal((await call("followups_destinations", { projectId: "p1" })).defaultId, null);
  await call("followups_set_destinations", { destinations: [gh, jira] });
  await call("followups_set_default_destination", { projectId: "p1", id: null });
  assert.equal((await call("followups_destinations", { projectId: "p1" })).defaultId, null);
});

test("bb follow-up destinations lists them, marking this project's default", async () => {
  const { call, cli } = await host();
  assert.match((await cli(["destinations"])).stdout, /No destinations yet/);
  await call("followups_set_destinations", { destinations: [gh, jira] });
  await call("followups_set_default_destination", { projectId: "proj_1", id: "github" });
  assert.equal(
    (await cli(["destinations"])).stdout,
    "GitHub    command  (default for this project)\nJira ENG  agent\n",
  );
});

test("bb follow-up filed --to names a configured destination by its id or name", async () => {
  const { call, cli } = await host();
  await call("followups_set_destinations", { destinations: [jira] });
  const { id } = await call("followups_add", { threadId: "thr_a", text: "Fix the restore" });
  await cli(["filed", id, "--to", "jira-eng", "--ref", "ENG-1"]);
  const { done } = await call("followups_list", { threadId: "thr_a" });
  assert.deepEqual(done[0].filedTo, { id: "jira-eng", name: "Jira ENG" });
});
