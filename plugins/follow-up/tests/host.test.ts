// The host entry: runs a command destination on the thread's host, in its
// checkout, with the row in its environment and on stdin. These run a real
// shell, through the SDK's host harness, with the daemon's validation and size
// boundaries.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import entry from "../host.ts";
import { OUTPUT_MAX } from "../lib/host-contract.ts";

const cwd = realpathSync(mkdtempSync(join(tmpdir(), "followup-host-")));

// A plain login shell with an empty home, so a developer's own profile cannot
// print into the output these tests read. In production the profile is the
// point: it is what puts `gh` on PATH. Its chatter lands in stderr, of which a
// row's note keeps only the command's last line.
process.env.SHELL = "/bin/sh";
process.env.HOME = realpathSync(mkdtempSync(join(tmpdir(), "followup-home-")));
const host = experimental_createHostEntryHarness(entry);
const run = (command: string, extra: { env?: Record<string, string>; stdin?: string; timeoutMs?: number } = {}) =>
  host.experimental_call("run_command", {
    command,
    cwd,
    env: extra.env ?? {},
    stdin: extra.stdin ?? "",
    timeoutMs: extra.timeoutMs ?? 10_000,
  });

test("host: the row arrives as variables, and is never parsed as shell", async () => {
  const result = await run('printf "%s|%s" "$FOLLOWUP_TITLE" "$FOLLOWUP_ID"', {
    env: { FOLLOWUP_TITLE: 'Fix $(echo pwned) `id` "it"', FOLLOWUP_ID: "a1" },
  });
  assert.deepEqual(result, {
    exitCode: 0,
    stdout: 'Fix $(echo pwned) `id` "it"|a1',
    stderr: "",
    timedOut: false,
  });
});

test("host: and as JSON on stdin", async () => {
  const stdin = `${JSON.stringify({ id: "a1", title: "Fix it" })}\n`;
  assert.equal((await run("cat", { stdin })).stdout, stdin);
});

test("host: in the thread's checkout", async () => {
  assert.equal((await run("pwd")).stdout.trim(), cwd);
});

test("host: a failure comes back with its exit code and what it said", async () => {
  const result = await run("echo partial; echo 'gh: not logged in' >&2; exit 4");
  assert.deepEqual(result, {
    exitCode: 4,
    stdout: "partial\n",
    stderr: "gh: not logged in\n",
    timedOut: false,
  });
});

test("host: a command that hangs is stopped on time, even with the shell between", async () => {
  // Two commands, so every shell forks `sleep` rather than becoming it. Killing
  // the shell alone used to leave `sleep` holding the output open: CI's Linux
  // runner waited out all 20 seconds, while macOS's sh happened to exec.
  const started = Date.now();
  const result = await run("sleep 20; echo never", { timeoutMs: 1000 });
  assert.equal(result.timedOut, true);
  assert.equal(result.exitCode, null);
  assert.equal(result.stdout, "");
  assert.ok(Date.now() - started < 8000, `took ${Date.now() - started}ms`);
});

test("host: a stopped command takes what it started with it", async () => {
  const pidFile = join(cwd, "child.pid");
  await run(`sh -c 'echo $$ > "${pidFile}"; exec sleep 30' & sleep 30`, { timeoutMs: 1000 });
  const pid = Number(readFileSync(pidFile, "utf8").trim());
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.throws(() => process.kill(pid, 0), /ESRCH/, `process ${pid} outlived its command`);
});

test("host: something left running in the background does not hold the answer", async () => {
  const started = Date.now();
  const result = await run("sleep 20 & echo started");
  assert.deepEqual([result.exitCode, result.stdout, result.timedOut], [0, "started\n", false]);
  assert.ok(Date.now() - started < 5000, `took ${Date.now() - started}ms`);
});

test("host: output is bounded — the start of stdout, the end of stderr", async () => {
  const result = await run(`head -c 50000 /dev/zero | tr '\\0' a; head -c 50000 /dev/zero | tr '\\0' b >&2; echo END >&2`);
  assert.equal(result.stdout.length, OUTPUT_MAX);
  assert.equal(result.stderr.length, OUTPUT_MAX);
  assert.ok(result.stderr.endsWith("END\n"));
});

test("host: a checkout that is not there is a failure, not a crash", async () => {
  const result = await host.experimental_call("run_command", {
    command: "true",
    cwd: join(cwd, "missing"),
    env: {},
    stdin: "",
    timeoutMs: 5000,
  });
  assert.equal(result.exitCode, null);
  assert.match(result.stderr, /ENOENT|no such file/i);
});
