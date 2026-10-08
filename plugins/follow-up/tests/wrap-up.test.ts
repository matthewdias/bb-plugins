import assert from "node:assert/strict";
import test from "node:test";
import {
  checkWrapUp,
  defaultDisposition,
  dispositionFromKey,
  dispositionKey,
  failedMessage,
  newWorktreeEnvironment,
  wrapUpSummary,
  type Disposition,
  type WrapUpRecord,
} from "../lib/wrap-up.ts";
import { FILING_STALE_MS, type FollowUp } from "../lib/followups.ts";

const AT = "2026-10-08T12:00:00.000Z";
const row = (id: string, extra: Partial<FollowUp> = {}): FollowUp => ({
  id,
  text: `Row ${id}`,
  reason: "deferred",
  file: null,
  detail: null,
  createdAt: AT,
  ...extra,
});
const record = (extra: Partial<WrapUpRecord> = {}): WrapUpRecord => ({
  startedAt: AT,
  archive: true,
  waitingOn: [],
  failures: [],
  dispatched: true,
  held: null,
  ...extra,
});

test("defaultDisposition: the project's destination, else keep", () => {
  assert.deepEqual(defaultDisposition("github"), { kind: "file", destinationId: "github" });
  assert.deepEqual(defaultDisposition(null), { kind: "keep" });
});

test("dispositionKey round-trips every disposition, and refuses anything else", () => {
  const all: Disposition[] = [
    { kind: "file", destinationId: "jira:eng" },
    { kind: "handoff", where: "here" },
    { kind: "handoff", where: "new-worktree" },
    { kind: "done" },
    { kind: "dismiss" },
    { kind: "keep" },
  ];
  for (const disposition of all) {
    assert.deepEqual(dispositionFromKey(dispositionKey(disposition)), disposition);
  }
  for (const key of ["file:", "handoff:there", "archive", ""]) {
    assert.equal(dispositionFromKey(key), null, key);
  }
});

test("wrapUpSummary: what the button does, in order, without the rows it keeps", () => {
  const name = (id: string) => ({ github: "GitHub", jira: "Jira ENG" })[id] ?? id;
  assert.equal(
    wrapUpSummary(
      [
        { kind: "file", destinationId: "github" },
        { kind: "file", destinationId: "jira" },
        { kind: "file", destinationId: "github" },
        { kind: "handoff", where: "here" },
        { kind: "dismiss" },
        { kind: "keep" },
      ],
      name,
      true,
    ),
    "Files 2 to GitHub, files 1 to Jira ENG, hands off 1 and dismisses 1, then archives this thread.",
  );
  assert.equal(wrapUpSummary([{ kind: "done" }], name, false), "Marks 1 done, then leaves this thread open.");
  assert.equal(wrapUpSummary([{ kind: "keep" }], name, true), "Archives this thread.");
});

test("checkWrapUp: waiting while anything it sent is still filing", () => {
  const now = Date.parse(AT) + 1000;
  const rows = [row("a", { filingSince: AT }), row("b", { filedAt: AT, doneAt: AT })];
  assert.deepEqual(checkWrapUp(record({ waitingOn: ["a", "b"] }), rows, now), { outcome: "waiting" });
});

test("checkWrapUp: landed once all of it filed, or went away", () => {
  const rows = [row("b", { filedAt: AT, doneAt: AT })];
  assert.deepEqual(checkWrapUp(record({ waitingOn: ["a", "b"] }), rows), { outcome: "landed" });
});

test("checkWrapUp: held by a filing that failed, or one that went quiet, or a failure at the start", () => {
  const quiet = Date.parse(AT) + FILING_STALE_MS + 1;
  const rows = [row("a", { filingNote: "GitHub exited 1." }), row("b", { filingSince: AT })];
  const check = checkWrapUp(
    record({ waitingOn: ["a", "b"], failures: [{ id: "c", text: "Row c", note: "The new thread could not be started." }] }),
    rows,
    quiet,
  );
  assert.deepEqual(check, {
    outcome: "held",
    failed: [
      { id: "c", text: "Row c", note: "The new thread could not be started." },
      { id: "a", text: "Row a", note: "GitHub exited 1." },
      { id: "b", text: "Row b", note: "Its filing never reported back." },
    ],
  });
});

test("failedMessage: one or several, held or not", () => {
  assert.equal(
    failedMessage([{ note: "x" }], true),
    "1 follow-up didn't go where you sent it, so this thread was not archived.",
  );
  assert.equal(failedMessage([{ note: "x" }, { note: "y" }], false), "2 follow-ups didn't go where you sent them.");
});

const gitWorktree = (inputs: unknown) => ({
  hostId: "host_1",
  isGitRepo: true,
  environmentProviderId: "git-worktree",
  environmentProviderSelection: { inputs },
});
const fresh = (branch: unknown) => ({
  environmentProviderId: "git-worktree",
  inputs: { branch },
  machine: { type: "existing", hostId: "host_1" },
});

test("newWorktreeEnvironment: a git-worktree thread's hand-off branches from where it did", () => {
  assert.deepEqual(newWorktreeEnvironment(gitWorktree({ branch: { kind: "default" } })), fresh({ kind: "default" }));
  assert.deepEqual(
    newWorktreeEnvironment(gitWorktree({ branch: { kind: "named", name: "origin/epic/6" } })),
    fresh({ kind: "named", name: "origin/epic/6" }),
  );
});

test("newWorktreeEnvironment: never back into a checkout that already exists", () => {
  // git-worktree's "reuse an existing worktree", a project checkout, and a
  // branch it cannot read all start a new worktree from the default branch.
  for (const environment of [
    gitWorktree({ kind: "existing", path: "/w/thr_a" }),
    gitWorktree({ branch: { kind: "named", name: "" } }),
    gitWorktree(null),
    { ...gitWorktree({ path: "/Users/me/app" }), environmentProviderId: "project-checkout" },
    { ...gitWorktree({ branch: { kind: "named", name: "x" } }), environmentProviderId: "someone-else" },
    { ...gitWorktree(null), environmentProviderId: null, environmentProviderSelection: null },
  ]) {
    assert.deepEqual(newWorktreeEnvironment(environment), fresh({ kind: "default" }), JSON.stringify(environment));
  }
});

test("newWorktreeEnvironment: none outside git", () => {
  assert.equal(newWorktreeEnvironment({ ...gitWorktree({ branch: { kind: "default" } }), isGitRepo: false }), null);
});
