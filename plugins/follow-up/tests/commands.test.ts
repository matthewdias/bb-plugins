import assert from "node:assert/strict";
import test from "node:test";
import type {
  PluginCommandContext,
  PluginTargetedPanelActionOpenOptions,
} from "@get-bb/plugin-sdk/app";
import { commands } from "../src/commands.ts";
import { peekFollowUpState, setCollapsed, setRows } from "../src/store.ts";
import type { FollowUp } from "../lib/followups.ts";

const row = (id: string): FollowUp => ({
  id,
  text: `Follow-up ${id}`,
  reason: null,
  file: null,
  detail: null,
  createdAt: "2026-10-01T00:00:00.000Z",
});

function command(id: string) {
  const found = commands.find((entry) => entry.id === id);
  assert.ok(found, `no command ${id}`);
  return found;
}

/** A palette context for `threadId`, recording what `openPanel` was asked for. */
function context(threadId: string | null) {
  const opened: PluginTargetedPanelActionOpenOptions[] = [];
  const ctx: PluginCommandContext = {
    threadId,
    projectId: threadId === null ? null : "proj_1",
    openPanel: (options) => {
      opened.push(options);
      return true;
    },
  };
  return { ctx, opened };
}

const toggle = command("toggle-followups");
const panel = command("open-followups-panel");
const handoff = command("open-handoff-panel");

test("commands: three, with distinct ids and no default shortcut", () => {
  assert.deepEqual(
    commands.map((entry) => [entry.id, entry.title]),
    [
      ["toggle-followups", "Follow-ups: show or hide the list"],
      ["open-followups-panel", "Follow-ups: open panel"],
      ["open-handoff-panel", "Follow-ups: hand off…"],
    ],
  );
  assert.ok(commands.every((entry) => entry.defaultShortcut === undefined));
});

test("commands: none is offered on a surface with no thread", () => {
  const { ctx } = context(null);
  for (const entry of commands) assert.equal(entry.isAvailable?.(ctx), false, entry.id);
});

test("commands: a thread with no rows has nothing to show or hide, but the panels open", () => {
  const { ctx } = context("thr_empty");
  setRows("thr_empty", [], [row("done1")]);
  assert.equal(toggle.isAvailable?.(ctx), false);
  assert.equal(panel.isAvailable?.(ctx), true);
  // The hand-off panel needs no row: opened bare, it composes a new thread.
  assert.equal(handoff.isAvailable?.(ctx), true);
});

test("commands: show or hide flips the banner whichever way it is", async () => {
  const { ctx } = context("thr_rows");
  setRows("thr_rows", [row("r1")]);
  assert.equal(toggle.isAvailable?.(ctx), true);
  setCollapsed("thr_rows", true);
  await toggle.run(ctx);
  assert.equal(peekFollowUpState("thr_rows").collapsed, false);
  await toggle.run(ctx);
  assert.equal(peekFollowUpState("thr_rows").collapsed, true);
  // Another thread's banner is untouched.
  setRows("thr_other", [row("r2")]);
  setCollapsed("thr_other", false);
  await toggle.run(ctx);
  assert.equal(peekFollowUpState("thr_other").collapsed, false);
});

test("commands: the panel commands open this plugin's own tabs, with no row", async () => {
  const followups = context("thr_a");
  await panel.run(followups.ctx);
  assert.deepEqual(followups.opened, [{ actionId: "followups" }]);
  const handing = context("thr_a");
  await handoff.run(handing.ctx);
  assert.deepEqual(handing.opened, [{ actionId: "handoff" }]);
});
