// The server entry, run whole against the SDK's fake host.
//
// These pin what `bb follow-up` prints, byte for byte, including the help and
// usage errors defineCli renders from server.ts's declarations: agents and the
// describe helper drive this CLI, and its wording is part of their contract.
// A golden that has to move should move in its own reviewed hunk.
import assert from "node:assert/strict";
import test from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../server.ts";

const THREAD = "thr_a";

type Cli = { exitCode: number; stdout: string; stderr: string };

async function host() {
  const { bb, harness } = createFakePluginHost();
  // `handoff` and `describe` look the thread up for its project and checkout.
  harness.sdk.stub("threads.get", (args: { threadId: string }) => ({
    id: args.threadId,
    projectId: "proj_1",
    environmentId: "env_1",
  }));
  let spawned = 0;
  harness.sdk.stub("threads.spawn", () => ({ id: `thr_spawned${++spawned}` }));
  await plugin(bb);
  const cli = async (argv: string[], ctx: { threadId?: string } = { threadId: THREAD }) =>
    (await harness.runCli(argv, ctx)) as Cli;
  // Row ids are random, so every test learns them from `add --json`.
  const add = async (...argv: string[]): Promise<string> => {
    const result = await cli(["add", ...argv, "--json"]);
    assert.equal(result.exitCode, 0, result.stderr);
    const parsed = JSON.parse(result.stdout) as { outcome: string; id: string };
    assert.equal(parsed.outcome, "added");
    return parsed.id;
  };
  const spawns = () =>
    harness.sdk.callsTo("threads.spawn").map((args) => args[0] as Record<string, unknown>);
  return { harness, cli, add, spawns };
}

const ok = (stdout: string): Cli => ({ exitCode: 0, stdout, stderr: "" });
const fail = (stderr: string): Cli => ({ exitCode: 1, stdout: "", stderr });

// What `bb follow-up help` and `--help` print, rendered by defineCli from the
// declarations in server.ts.
const HELP = [
  "bb follow-up — Read and reset the follow-ups agents recorded on a thread",
  "",
  "Usage:",
  "  bb follow-up [--thread <id>] [--json] [--all] [--verbose] [--include-done]",
  "  bb follow-up <command> [options]",
  "",
  "Commands:",
  "  bb follow-up add         Record a follow-up yourself, the same row the composer records",
  "  bb follow-up show        Show open follow-ups (-v for detail, --include-done to list finished ones too)",
  "  bb follow-up move        Place a follow-up at the front or the back of the list",
  "  bb follow-up amend       Change a follow-up in place, keeping its id, age and position",
  "  bb follow-up done        Mark a follow-up finished; it moves to Done",
  "  bb follow-up reopen      Move a finished follow-up back to the open list",
  "  bb follow-up filed       Record that a follow-up was filed somewhere else; it moves to Done and is not recorded here again",
  "  bb follow-up clear-done  Empty Done, so those follow-ups can be recorded again if they recur",
  "  bb follow-up describe    Have a short-lived helper read the thread and write a follow-up's detail",
  "  bb follow-up dismiss     Dismiss one follow-up so it is never recorded on this thread again",
  "  bb follow-up handoff     Send a follow-up to a new thread, optionally invoking a skill on it (a child of this one unless --new)",
  "  bb follow-up clear       Drop the follow-ups recorded on a thread",
  "  bb follow-up forget      Drop the dismissal record, so dismissed follow-ups can be recorded again",
  "",
  "Options:",
  "  --thread <id>   The thread to act on; defaults to the thread this runs in",
  "  --json          Print the result as JSON",
  "  --all           List every thread that has open follow-ups, with a count for each",
  "  --verbose       Add each follow-up's id and detail",
  "  --include-done  Also list finished follow-ups",
  "  --help, -h      Show this help and exit",
  "",
  "Run `bb follow-up <command> --help` for a command's arguments and options.",
  "",
].join("\n");

/** The command list an unknown command prints under its error. */
const COMMANDS = HELP.slice(HELP.indexOf("Commands:"), HELP.indexOf("\n\nOptions:") + 1);

/** Each command's usage line, as a usage error prints it. */
const USAGE = {
  add: "bb follow-up add <text...> [--thread <id>] [--json] [--reason <out-of-scope|blocked|deferred|risk|cleanup>] [--detail <value>] [--file <path>]",
  amend: "bb follow-up amend <id> [--thread <id>] [--json] [--text <value>] [--detail <value>] [--file <path>] [--reason <out-of-scope|blocked|deferred|risk|cleanup>]",
  describe: "bb follow-up describe <id> [--thread <id>] [--json]",
  done: "bb follow-up done <id> [--thread <id>] [--json]",
  handoff: "bb follow-up handoff <id> [<skill>] [--thread <id>] [--json] [--new] [--provider <id>] [--model <model>] [--reasoning-level <low|medium|high|xhigh|max>] [--service-tier <tier>] [--permission-mode <accept-edits|auto|full>]",
} as const;

/** A usage error: the message, then the command's usage line. */
const usageError = (message: string, command: keyof typeof USAGE): Cli =>
  fail(`${message}\n\nUsage:\n  ${USAGE[command]}\n`);

const REASON_CHOICES =
  "Expected one of: out-of-scope, blocked, deferred, risk, cleanup";

test("cli: help and --help print the help; an unknown command names itself", async () => {
  const { cli } = await host();
  assert.deepEqual(await cli(["help"]), ok(HELP));
  assert.deepEqual(await cli(["--help"]), ok(HELP));
  assert.deepEqual(await cli(["bogus"]), fail(`unknown command 'bogus'\n\n${COMMANDS}`));
});

test("cli: add records a row and reports each refusal", async () => {
  const { cli } = await host();
  const added = await cli(["add", "first", "one"]);
  assert.equal(added.exitCode, 0);
  assert.match(added.stdout, /^Recorded [0-9a-f]{8}: first one\n$/);
  assert.deepEqual(await cli(["add", "first one"]), fail("This thread already has that follow-up.\n"));
  assert.deepEqual(await cli(["add"]), usageError("missing required arguments: <text>", "add"));
  assert.deepEqual(await cli(["add", "  "]), fail("add needs the follow-up text.\n"));
  assert.deepEqual(
    await cli(["add", "x", "--reason", "bogus"]),
    usageError(`invalid value 'bogus' for --reason. ${REASON_CHOICES}`, "add"),
  );
  assert.deepEqual(
    await cli(["add", "x", "--reason"]),
    usageError(
      "--reason requires a value (Write --reason=<value> when the value is itself an option name.)",
      "add",
    ),
  );
});

test("cli: add rejects a misspelt flag instead of folding it into the text", async () => {
  const { cli } = await host();
  assert.deepEqual(
    await cli(["add", "x", "--resaon", "risk"]),
    usageError("unknown option '--resaon' (Did you mean --reason?)", "add"),
  );
  assert.deepEqual(await cli(["show"]), ok("No follow-ups recorded for this thread.\n"));
});

test("cli: add takes its flags before or after the text", async () => {
  const { cli, add } = await host();
  const first = await add("--reason", "risk", "flags", "first");
  const second = await add("text", "first", "--file", "f.ts", "--detail", "why");
  assert.deepEqual(
    await cli(["show", "-v"]),
    ok(
      [
        " 1. [risk] flags first",
        `      id: ${first}`,
        "",
        " 2. text first  (f.ts)",
        `      id: ${second}`,
        "      why",
        "",
      ].join("\n"),
    ),
  );
});

test("cli: a bare invocation shows the list, as show does", async () => {
  const { cli, add } = await host();
  await add("first one");
  await add("second one", "--reason", "risk", "--file", "f.ts");
  const expected = ok(" 1. first one\n 2. [risk] second one  (f.ts)\n");
  assert.deepEqual(await cli([]), expected);
  assert.deepEqual(await cli(["show"]), expected);
});

test("cli: show --json lists the open rows", async () => {
  const { cli, add } = await host();
  const id = await add("first one", "--reason", "risk", "--detail", "d", "--file", "f.ts");
  const result = await cli(["show", "--json"]);
  assert.equal(result.exitCode, 0);
  const [row, ...rest] = JSON.parse(result.stdout) as Record<string, unknown>[];
  assert.deepEqual(rest, []);
  const { createdAt, ...stable } = row ?? {};
  assert.equal(typeof createdAt, "string");
  assert.deepEqual(stable, {
    id,
    text: "first one",
    reason: "risk",
    file: "f.ts",
    detail: "d",
    createdBy: "user",
  });
});

test("cli: show --all counts every thread with open rows", async () => {
  const { cli, add } = await host();
  await add("one");
  await add("two");
  // A thread whose only row is done has storage but nothing open, so it is left out.
  const elsewhere = await cli(["add", "finished elsewhere", "--json"], { threadId: "thr_b" });
  const { id } = JSON.parse(elsewhere.stdout) as { id: string };
  await cli(["done", id], { threadId: "thr_b" });
  assert.deepEqual(await cli(["show", "--all"]), ok(`${THREAD}  2\n`));
  assert.deepEqual(
    await cli(["show", "--all", "--json"]),
    ok(`${JSON.stringify([{ threadId: THREAD, count: 2 }])}\n`),
  );
});

test("cli: --thread stands in for a missing thread context", async () => {
  const { cli, add } = await host();
  await add("one");
  assert.deepEqual(await cli(["show"], {}), fail("No thread in context — pass --thread <id>.\n"));
  assert.deepEqual(await cli(["show", "--thread", THREAD], {}), ok(" 1. one\n"));
});

test("cli: --include-done, its old --sent spelling, and --done", async () => {
  const { cli, add } = await host();
  const first = await add("first");
  await add("second");
  assert.deepEqual(await cli(["done", first]), ok("Done: first\n"));
  const withDone = ok(" 1. first  [done]\n 2. second\n");
  assert.deepEqual(await cli(["show", "--include-done"]), withDone);
  assert.deepEqual(await cli(["show", "--sent"]), withDone);
  assert.deepEqual(await cli(["show", "--done"]), ok(" 1. first  [done]\n"));
  assert.deepEqual(await cli(["show"]), ok(" 1. second\n"));
});

test("cli: done, reopen and clear-done", async () => {
  const { cli, add } = await host();
  const id = await add("first");
  assert.deepEqual(await cli(["done"]), usageError("missing required arguments: <id>", "done"));
  assert.deepEqual(await cli(["done", "nope"]), fail(`No follow-up with id nope on ${THREAD}.\n`));
  assert.deepEqual(await cli(["done", id]), ok("Done: first\n"));
  assert.deepEqual(await cli(["reopen", id]), ok("Reopened: first\n"));
  assert.deepEqual(await cli(["show"]), ok(" 1. first\n"));
  assert.deepEqual(await cli(["done", id]), ok("Done: first\n"));
  assert.deepEqual(
    await cli(["clear-done"]),
    ok("Cleared 1 finished follow-up. They can be recorded again if they recur.\n"),
  );
  // Clearing Done releases the text, so it can be recorded again.
  await add("first");
});

test("cli: move places a row and rejects a bad position or id", async () => {
  const { cli, add } = await host();
  await add("first");
  const second = await add("second");
  assert.deepEqual(await cli(["move", second, "top"]), ok("Moved to the top: second\n"));
  assert.deepEqual(await cli(["show"]), ok(" 1. second\n 2. first\n"));
  assert.deepEqual(await cli(["move", second, "bottom"]), ok("Moved to the bottom: second\n"));
  assert.deepEqual(await cli(["show"]), ok(" 1. first\n 2. second\n"));
  assert.deepEqual(
    await cli(["move", second, "sideways"]),
    fail("move needs a follow-up id and top or bottom.\n"),
  );
  assert.deepEqual(await cli(["move", "nope", "top"]), fail(`No open follow-up with id nope on ${THREAD}.\n`));
});

test("cli: amend changes a row in place and reports what is missing", async () => {
  const { cli, add } = await host();
  const id = await add("first");
  assert.deepEqual(await cli(["amend"]), usageError("missing required arguments: <id>", "amend"));
  assert.deepEqual(
    await cli(["amend", id]),
    usageError("missing required options: one of --text, --detail, --file, --reason", "amend"),
  );
  assert.deepEqual(
    await cli(["amend", id, "--detail"]),
    usageError(`--detail requires a value (Write --detail=<value> when the value is itself an option name.)`, "amend"),
  );
  assert.deepEqual(
    await cli(["amend", id, "--reason", "bad"]),
    usageError(`invalid value 'bad' for --reason. ${REASON_CHOICES}`, "amend"),
  );
  assert.deepEqual(await cli(["amend", id, "--text", "first amended"]), ok("Amended: first amended\n"));
  assert.deepEqual(await cli(["show"]), ok(" 1. first amended\n"));
});

test("cli: dismiss tombstones the text until forget releases it", async () => {
  const { cli, add } = await host();
  const id = await add("first");
  assert.deepEqual(await cli(["dismiss", "nope"]), fail(`No follow-up with id nope on ${THREAD}.\n`));
  assert.deepEqual(
    await cli(["dismiss", id]),
    ok("Dismissed: first\nIt will not be recorded again on this thread.\n"),
  );
  assert.deepEqual(
    await cli(["add", "first"]),
    fail(
      "That follow-up was dismissed on this thread and will not come back. " +
        "`bb follow-up forget` releases dismissed texts.\n",
    ),
  );
  assert.deepEqual(await cli(["forget"]), ok(`Forgot 1 dismissal on ${THREAD}.\n`));
  await add("first");
  assert.deepEqual(await cli(["clear"]), ok(`Cleared 1 follow-up from ${THREAD}.\n`));
  assert.deepEqual(await cli(["show"]), ok("No follow-ups recorded for this thread.\n"));
});

test("cli: describe starts a hidden helper on the row", async () => {
  const { cli, add, spawns } = await host();
  const id = await add("first");
  assert.deepEqual(
    await cli(["describe"]),
    usageError("missing required arguments: <id>", "describe"),
  );
  assert.deepEqual(
    await cli(["describe", id]),
    ok(
      `Describing ${id} in thr_spawned1.\n` +
        "It writes the detail onto the row and archives itself; " +
        "`bb follow-up show -v` when it settles.\n",
    ),
  );
  assert.equal(spawns()[0]?.visibility, "hidden");
});

test("cli: the amend line in the describe helper's prompt runs as written", async () => {
  const { cli, add, spawns } = await host();
  const id = await add("first");
  await cli(["describe", id]);
  const prompt = String(spawns()[0]?.prompt);
  const line = prompt.split("\n").find((entry) => entry.trim().startsWith("bb follow-up amend"));
  assert.equal(line?.trim(), `bb follow-up amend ${id} --thread ${THREAD} --detail "<what you wrote>"`);
  // The helper runs in its own thread, so only --thread points it back here.
  const argv = ["amend", id, "--thread", THREAD, "--detail", "what the helper wrote"];
  assert.deepEqual(await cli(argv, { threadId: "thr_helper" }), ok("Amended: first\n"));
  assert.match((await cli(["show", "-v"])).stdout, /\n {6}what the helper wrote\n$/);
});

test("cli: handoff spawns a child, or an independent thread with --new", async () => {
  const { cli, add, spawns } = await host();
  const child = await add("child work");
  assert.deepEqual(
    await cli(["handoff", child, "review"]),
    ok("Handed off to thr_spawned1 as /review (child of this thread)\n"),
  );
  const independent = await add("independent work");
  assert.deepEqual(
    await cli(["handoff", independent, "--new", "--json"]),
    ok(
      `${JSON.stringify({ outcome: "spawned", prompt: "independent work", spawnedThreadId: "thr_spawned2" })}\n`,
    ),
  );
  const [first, second] = spawns();
  assert.equal(first?.parentThreadId, THREAD);
  assert.equal(first?.prompt, "/review child work");
  // `--new` is a flag, not a skill: it once became the prompt "/--new …".
  assert.equal(second?.parentThreadId, undefined);
  assert.equal(second?.prompt, "independent work");
});

test("cli: handoff forwards execution flags with explicit provenance", async () => {
  const { cli, add, spawns } = await host();
  const id = await add("work");
  const argv = [
    "handoff", id, "--provider", "p1", "--model", "m1", "--reasoning-level", "high",
    "--service-tier", "fast", "--permission-mode", "auto",
  ];
  assert.equal((await cli(argv)).exitCode, 0);
  const spawn = spawns()[0] ?? {};
  assert.deepEqual(
    {
      providerId: spawn.providerId,
      model: spawn.model,
      reasoningLevel: spawn.reasoningLevel,
      serviceTier: spawn.serviceTier,
      permissionMode: spawn.permissionMode,
      executionInputSources: spawn.executionInputSources,
    },
    {
      providerId: "p1",
      model: "m1",
      reasoningLevel: "high",
      serviceTier: "fast",
      permissionMode: "auto",
      executionInputSources: {
        providerId: "explicit",
        model: "explicit",
        reasoningLevel: "explicit",
        serviceTier: "explicit",
        permissionMode: "explicit",
      },
    },
  );
});

test("cli: handoff passes any tier id the provider lists, trimmed, as explicit", async () => {
  const { cli, add, spawns } = await host();
  // Tiers are per provider since SDK 0.6, so the CLI leaves judging them to bb.
  const id = await add("work");
  assert.equal((await cli(["handoff", id, "--service-tier", "priority"])).exitCode, 0);
  const other = await add("other work");
  assert.equal((await cli(["handoff", other, "--service-tier", "  flex  "])).exitCode, 0);
  const [first, second] = spawns();
  assert.equal(first?.serviceTier, "priority");
  assert.deepEqual(first?.executionInputSources, { serviceTier: "explicit" });
  assert.equal(second?.serviceTier, "flex");
});

test("cli: handoff refuses a blank or overlong tier", async () => {
  const { cli, add, spawns } = await host();
  const id = await add("work");
  assert.deepEqual(
    await cli(["handoff", id, "--service-tier", "   "]),
    fail("--service-tier needs a value.\n"),
  );
  assert.deepEqual(
    await cli(["handoff", id, "--service-tier", "t".repeat(65)]),
    fail("--service-tier must be 64 characters or fewer.\n"),
  );
  assert.equal((await cli(["handoff", id, "--service-tier", "t".repeat(64)])).exitCode, 0);
  assert.equal(spawns().length, 1);
});

test("cli: handoff with no execution flags leaves the project defaults alone", async () => {
  const { cli, add, spawns } = await host();
  const id = await add("work");
  await cli(["handoff", id]);
  assert.deepEqual(Object.keys(spawns()[0] ?? {}).sort(), [
    "environment",
    "origin",
    "originPluginId",
    "parentThreadId",
    "projectId",
    "prompt",
  ]);
});

test("cli: handoff refusals", async () => {
  const { cli, add } = await host();
  const id = await add("work");
  assert.deepEqual(await cli(["handoff"]), usageError("missing required arguments: <id>", "handoff"));
  assert.deepEqual(
    await cli(["handoff", id, "--model"]),
    usageError(`--model requires a value (Write --model=<value> when the value is itself an option name.)`, "handoff"),
  );
  assert.deepEqual(
    await cli(["handoff", id, "--reasoning-level", "bogus"]),
    usageError(
      "invalid value 'bogus' for --reasoning-level. Expected one of: low, medium, high, xhigh, max",
      "handoff",
    ),
  );
  assert.deepEqual(
    await cli(["handoff", id, "--permission-mode", "bogus"]),
    usageError(
      "invalid value 'bogus' for --permission-mode. Expected one of: accept-edits, auto, full",
      "handoff",
    ),
  );
  assert.deepEqual(await cli(["handoff", "nope", "--json"]).then((r) => JSON.parse(r.stdout)), {
    outcome: "not-found",
    prompt: "",
    spawnedThreadId: null,
  });
  assert.deepEqual(await cli(["handoff", "nope"]), fail("Handoff failed: not-found\n"));
});

test("cli: a value flag refuses an option name as its value, and takes one value once", async () => {
  const { cli, add, spawns } = await host();
  const id = await add("work");
  const modelNeedsValue = usageError(`--model requires a value (Write --model=<value> when the value is itself an option name.)`, "handoff");
  // `--json` is an option this command declares, so it is not taken as the
  // model, and asking for JSON also prints the error envelope on stdout.
  const asJson = await cli(["handoff", id, "--model", "--json"]);
  assert.deepEqual({ ...asJson, stdout: "" }, modelNeedsValue);
  assert.deepEqual(JSON.parse(asJson.stdout), {
    ok: false,
    error: {
      code: "invalid_value",
      message: "--model requires a value",
      hint: "Write --model=<value> when the value is itself an option name.",
    },
  });
  assert.deepEqual(await cli(["handoff", id, "--model", "--new"]), modelNeedsValue);
  // Any declared option name, not only a switch: `--provider` was taken as the
  // model before defineCli.
  assert.deepEqual(await cli(["handoff", id, "--model", "--provider"]), modelNeedsValue);
  // Written with `=`, or not an option of this command, a dash-led token is the value.
  assert.equal((await cli(["handoff", id, "--model=--provider"])).exitCode, 0);
  assert.equal(spawns()[0]?.model, "--provider");
  assert.equal(spawns()[0]?.providerId, undefined);
  const second = await add("more work");
  assert.equal((await cli(["handoff", second, "--model", "--not-an-option"])).exitCode, 0);
  assert.equal(spawns()[1]?.model, "--not-an-option");
  // A single-value flag given twice is refused rather than the last one winning.
  const third = await add("third work");
  assert.deepEqual(
    await cli(["handoff", third, "--model", "m1", "--model", "m2"]),
    usageError("--model was given more than once; it takes a single value", "handoff"),
  );
  assert.equal(spawns().length, 2);
});

test("cli: every command answers --help with its own usage", async () => {
  const { cli } = await host();
  const commands = [
    "add", "show", "move", "amend", "done", "reopen", "clear-done",
    "describe", "dismiss", "handoff", "clear", "forget",
  ];
  for (const command of commands) {
    const result = await cli([command, "--help"]);
    assert.equal(result.exitCode, 0, command);
    assert.match(result.stdout, new RegExp(`^bb follow-up ${command} — .+\\n\\nUsage:\\n  bb follow-up ${command} `), command);
  }
  // `-v` and the old `--sent` spelling still work, though help names neither.
  assert.match((await cli(["show", "--help"])).stdout, /--verbose/);
});

test("cli: with --json, a failure prints the error envelope on stdout", async () => {
  const { cli } = await host();
  const result = await cli(["done", "nope", "--json"]);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr, `No follow-up with id nope on ${THREAD}.\n`);
  assert.deepEqual(JSON.parse(result.stdout), {
    ok: false,
    error: { code: "command_failed", message: `No follow-up with id nope on ${THREAD}.` },
  });
});

test("rpc: followups_add reports added, duplicate and dismissed", async () => {
  const { harness } = await host();
  const call = (method: string, input: unknown) => harness.callRpc(method, input) as Promise<any>;
  const added = await call("followups_add", { threadId: THREAD, text: "first" });
  assert.equal(added.outcome, "added");
  assert.match(added.id, /^[0-9a-f]{8}$/);
  assert.deepEqual(added.followUps.map((row: { text: string }) => row.text), ["first"]);
  assert.deepEqual(added.done, []);
  const duplicate = await call("followups_add", { threadId: THREAD, text: "first" });
  assert.deepEqual([duplicate.outcome, duplicate.id], ["duplicate", null]);
  await call("followups_dismiss", { threadId: THREAD, id: added.id });
  const dismissed = await call("followups_add", { threadId: THREAD, text: "first" });
  assert.deepEqual([dismissed.outcome, dismissed.id], ["dismissed", null]);
});

test("rpc: getFollowUpCountsV1 answers every thread once, in first-seen order", async () => {
  const { harness, add, cli } = await host();
  await add("open");
  await cli(["done", await add("finished")]);
  assert.deepEqual(
    await harness.callRpc("getFollowUpCountsV1", { threadIds: ["thr_b", THREAD, "thr_b"] }),
    {
      protocolVersion: 1,
      counts: [
        { threadId: "thr_b", open: 0, done: 0 },
        { threadId: THREAD, open: 1, done: 1 },
      ],
    },
  );
});
