import assert from "node:assert/strict";
import test from "node:test";

import {
  addFollowUp,
  amendFollowUp,
  applyTombstones,
  applyOrder,
  formatList,
  formatListForAgent,
  moveFollowUp,
  orderFollowUps,
  selectionToFollowUp,
  TEXT_MAX,
  matchFollowUp,
  MAX_PER_THREAD,
  normalizeKey,
  doneFollowUps,
  openFollowUps,
  rollupByReason,
  formatRollup,
  handoffPrompt,
  carriedFromChild,
  hasRunningHandoff,
  isCleared,
  markHandoffState,
  needsReview,
  type FollowUp,
} from "../lib/followups.ts";
import { takeValueFlags } from "../lib/argv.ts";
import { backfillRequest, expansionPrompt, fileMentionOf, isExpanding, expansionGaveUp, contextAround, rowsEqual, houseStyleBlock, EXPANSION_TURNS, EXPANSION_WORD_CAP, CAP_CEILING } from "../lib/followups.ts";

function row(text: string, overrides: Partial<FollowUp> = {}): FollowUp {
  return {
    id: text.slice(0, 8),
    text,
    reason: "deferred",
    file: null,
    detail: null,
    createdAt: "2026-09-05T00:00:00.000Z",
    ...overrides,
  };
}

test("normalizeKey ignores case and punctuation so near-identical wording collides", () => {
  assert.equal(normalizeKey("Fix the flaky test."), normalizeKey("fix the flaky test"));
  assert.equal(normalizeKey("Fix  the   flaky test!"), "fix the flaky test");
  assert.notEqual(normalizeKey("fix the flaky test"), normalizeKey("fix the other test"));
});

test("a follow-up is added to an empty list", () => {
  const { list, outcome } = addFollowUp([], row("Fix the flaky test"), []);
  assert.equal(outcome, "added");
  assert.equal(list.length, 1);
});

test("re-recording the same text does not duplicate it", () => {
  const first = addFollowUp([], row("Fix the flaky test"), []);
  const second = addFollowUp(first.list, row("fix the FLAKY test."), []);
  assert.equal(second.outcome, "duplicate");
  assert.equal(second.list.length, 1);
});

test("a dismissed follow-up is not re-added when an agent notices it again", () => {
  const tombstones = [normalizeKey("Fix the flaky test")];
  const { list, outcome } = addFollowUp([], row("Fix the flaky test."), tombstones);
  assert.equal(outcome, "dismissed");
  assert.deepEqual(list, []);
});

test("dismissal beats recording even when the list already holds other rows", () => {
  const existing = [row("Rename the helper")];
  const tombstones = [normalizeKey("Fix the flaky test")];
  const { list, outcome } = addFollowUp(existing, row("Fix the flaky test"), tombstones);
  assert.equal(outcome, "dismissed");
  assert.equal(list.length, 1);
});

test("the per-thread cap refuses further rows instead of evicting old ones", () => {
  const full = Array.from({ length: MAX_PER_THREAD }, (_, i) => row(`Item number ${i}`));
  const { list, outcome } = addFollowUp(full, row("One more thing"), []);
  assert.equal(outcome, "full");
  assert.equal(list.length, MAX_PER_THREAD);
  assert.ok(!list.some((entry) => entry.text === "One more thing"));
});

test("blank or punctuation-only text is rejected rather than stored", () => {
  const { list, outcome } = addFollowUp([], row("..."), []);
  assert.equal(outcome, "duplicate");
  assert.deepEqual(list, []);
});

test("applyTombstones removes rows dismissed after they were stored", () => {
  const stored = [row("Fix the flaky test"), row("Rename the helper")];
  const live = applyTombstones(stored, [normalizeKey("fix the flaky test")]);
  assert.equal(live.length, 1);
  assert.equal(live[0]?.text, "Rename the helper");
});

test("applyTombstones with no dismissals preserves the list", () => {
  const stored = [row("Fix the flaky test")];
  assert.deepEqual(applyTombstones(stored, []), stored);
});

test("formatList reports emptiness rather than printing nothing", () => {
  assert.match(formatList([]), /No follow-ups/);
});

test("formatList shows the reason and the file anchor when present", () => {
  const text = formatList([row("Fix the flaky test", { reason: "risk", file: "auth.ts:42" })]);
  assert.match(text, /\[risk\]/);
  assert.match(text, /Fix the flaky test/);
  assert.match(text, /auth\.ts:42/);
});

test("openFollowUps keeps sent rows — sending is in progress, not done", () => {
  const list = [row("Fix the flaky test"), row("Rename the helper", { sentAt: "2026-09-06T00:00:00Z" })];
  const open = openFollowUps(list, []);
  assert.equal(open.length, 2);
  // Untouched first: a sent row is not what to pick up next.
  assert.equal(open[0]?.text, "Fix the flaky test");
});

test("a sent row is not dismissed — applyTombstones still returns it", () => {
  const list = [row("Rename the helper", { sentAt: "2026-09-06T00:00:00Z" })];
  assert.equal(applyTombstones(list, []).length, 1);
});

test("openFollowUps still hides dismissed rows", () => {
  const list = [row("Fix the flaky test"), row("Rename the helper", { sentAt: "2026-09-06T00:00:00Z" })];
  const open = openFollowUps(list, [normalizeKey("Fix the flaky test")]);
  assert.deepEqual(
    open.map((entry) => entry.text),
    ["Rename the helper"],
  );
});

test("a null sentAt still counts as open", () => {
  assert.equal(openFollowUps([row("Fix the flaky test", { sentAt: null })], []).length, 1);
});

test("verbose formatting reveals detail and the id; plain formatting does not", () => {
  const entry = row("Fix the flaky test", { detail: "It fails only under parallel runs." });
  const plain = formatList([entry]);
  const loud = formatList([entry], true);
  assert.ok(!plain.includes("parallel runs"));
  assert.match(loud, /parallel runs/);
  assert.match(loud, new RegExp(`id: ${entry.id}`));
});

test("sent rows are marked in progress in formatted output", () => {
  const text = formatList([row("Rename the helper", { sentAt: "2026-09-06T00:00:00Z" })]);
  assert.match(text, /\[in progress\]/);
});

test("rollupByReason counts each reason it reports", () => {
  const list = [
    row("a", { reason: "blocked" }),
    row("b", { reason: "blocked" }),
    row("c", { reason: "risk" }),
  ];
  assert.deepEqual(rollupByReason(list), [
    { reason: "blocked", count: 2 },
    { reason: "risk", count: 1 },
  ]);
});

test("rollupByReason leads with the dominant reason it reports", () => {
  const list = [
    row("a", { reason: "risk" }),
    row("b", { reason: "cleanup" }),
    row("c", { reason: "cleanup" }),
  ];
  assert.equal(rollupByReason(list)[0]?.reason, "cleanup");
});

test("equal counts fall back to declared order, not insertion order", () => {
  const list = [row("a", { reason: "cleanup" }), row("b", { reason: "blocked" })];
  assert.deepEqual(
    rollupByReason(list).map((entry) => entry.reason),
    ["blocked", "cleanup"],
  );
});

test("rollup of an empty list is empty", () => {
  assert.deepEqual(rollupByReason([]), []);
  assert.equal(formatRollup([]), "");
});

test("formatRollup reads as a summary line", () => {
  const list = [
    row("a", { reason: "blocked" }),
    row("b", { reason: "blocked" }),
    row("c", { reason: "risk" }),
  ];
  assert.equal(formatRollup(list), "2 blocked, 1 risk");
});

test("in-progress rows stay listed instead of vanishing", () => {
  const list = [row("a"), row("b", { sentAt: "2026-09-06T01:00:00Z" })];
  assert.equal(openFollowUps(list, []).length, 2);
});

test("in-progress rows sort below untouched ones", () => {
  const list = [row("sent", { sentAt: "2026-09-06T01:00:00Z" }), row("fresh")];
  assert.deepEqual(
    openFollowUps(list, []).map((entry) => entry.text),
    ["fresh", "sent"],
  );
});

test("done rows leave the open list", () => {
  const list = [row("a"), row("b", { doneAt: "2026-09-06T02:00:00Z" })];
  const open = openFollowUps(list, []);
  assert.equal(open.length, 1);
  assert.equal(open[0]?.text, "a");
});

test("done beats in progress — a sent row marked done is not still open", () => {
  const list = [row("a", { sentAt: "2026-09-06T01:00:00Z", doneAt: "2026-09-06T02:00:00Z" })];
  assert.deepEqual(openFollowUps(list, []), []);
});

test("doneFollowUps returns finished rows newest first", () => {
  const list = [
    row("older", { doneAt: "2026-09-06T01:00:00Z" }),
    row("newer", { doneAt: "2026-09-06T03:00:00Z" }),
    row("open"),
  ];
  assert.deepEqual(
    doneFollowUps(list, []).map((entry) => entry.text),
    ["newer", "older"],
  );
});

test("a done row still blocks re-recording — Done is the soft tombstone", () => {
  const done = [row("Fix the flaky test", { doneAt: "2026-09-06T02:00:00Z" })];
  const { outcome } = addFollowUp(done, row("fix the flaky test."), []);
  assert.equal(outcome, "duplicate");
});

test("dismissing a done row keeps it out of both lists", () => {
  const list = [row("a", { doneAt: "2026-09-06T02:00:00Z" })];
  const tombstones = [normalizeKey("a")];
  assert.deepEqual(doneFollowUps(list, tombstones), []);
  assert.deepEqual(openFollowUps(list, tombstones), []);
});

test("formatted output distinguishes done from in progress", () => {
  assert.match(formatList([row("a", { doneAt: "2026-09-06T02:00:00Z" })]), /\[done\]/);
  assert.match(formatList([row("b", { sentAt: "2026-09-06T01:00:00Z" })]), /\[in progress\]/);
});

test("an agent-closed row says so, so its claim can be checked", () => {
  const closed = row("a", { doneAt: "2026-09-06T02:00:00Z", doneBy: "agent" as const });
  assert.match(formatList([closed]), /\[done by agent\]/);
  assert.match(formatList([row("b", { doneAt: "2026-09-06T02:00:00Z" })]), /\[done\]/);
  assert.doesNotMatch(
    formatList([row("b", { doneAt: "2026-09-06T02:00:00Z" })]),
    /by agent/,
  );
});

test("the closing note is surfaced in verbose output", () => {
  const closed = row("a", {
    doneAt: "2026-09-06T02:00:00Z",
    doneBy: "agent" as const,
    doneNote: "Added the null guard in auth.ts:88",
  });
  assert.match(formatList([closed], true), /closed: Added the null guard in auth\.ts:88/);
});

test("a follow-up can be matched by id", () => {
  const list = [row("Fix the flaky test", { id: "abc12345" })];
  const result = matchFollowUp(list, "abc12345");
  assert.equal(result.kind, "found");
  assert.equal(result.kind === "found" && result.row.id, "abc12345");
});

test("a follow-up can be matched by re-worded text", () => {
  const list = [row("Fix the flaky auth test")];
  const result = matchFollowUp(list, "fix the flaky auth test.");
  assert.equal(result.kind, "found");
});

test("a substring identifies a follow-up when only one row contains it", () => {
  const list = [row("Fix the flaky auth test"), row("Rename the config module")];
  const result = matchFollowUp(list, "flaky auth");
  assert.equal(result.kind, "found");
  assert.equal(result.kind === "found" && result.row.text, "Fix the flaky auth test");
});

test("an ambiguous match closes nothing — a wrong close is a false completion", () => {
  const list = [row("Fix the flaky auth test"), row("Fix the flaky billing test")];
  const result = matchFollowUp(list, "fix the flaky");
  assert.equal(result.kind, "ambiguous");
  assert.equal(result.kind === "ambiguous" && result.rows.length, 2);
});

test("an unmatched needle reports none rather than picking the nearest row", () => {
  const list = [row("Fix the flaky auth test")];
  assert.equal(matchFollowUp(list, "rewrite the parser").kind, "none");
  assert.equal(matchFollowUp(list, "   ").kind, "none");
});

test("the agent-facing list leads with the id it must act on", () => {
  const list = [row("Fix the flaky test", { id: "abc12345" })];
  assert.match(formatListForAgent(list), /^- abc12345 \[deferred\] Fix the flaky test$/m);
});

test("an unordered thread keeps insertion order with in-progress last", () => {
  const list = [
    row("a"),
    row("b", { sentAt: "2026-09-06T01:00:00Z" }),
    row("c"),
  ];
  assert.deepEqual(
    openFollowUps(list, []).map((entry) => entry.text),
    ["a", "c", "b"],
  );
});

test("placed rows lead, in the order they were placed", () => {
  const list = [row("a"), row("b", { rank: 1 }), row("c", { rank: 0 })];
  assert.deepEqual(
    openFollowUps(list, []).map((entry) => entry.text),
    ["c", "b", "a"],
  );
});

test("a placed row stays put when it goes in progress", () => {
  const list = [
    row("a", { rank: 0, sentAt: "2026-09-06T01:00:00Z" }),
    row("b", { rank: 1 }),
  ];
  assert.deepEqual(
    openFollowUps(list, []).map((entry) => entry.text),
    ["a", "b"],
  );
});

test("applyOrder ranks ids into the given order", () => {
  const list = [row("a", { id: "a" }), row("b", { id: "b" }), row("c", { id: "c" })];
  const next = applyOrder(list, ["c", "a", "b"], "user", ["c"]);
  assert.deepEqual(
    orderFollowUps(next).map((entry) => entry.id),
    ["c", "a", "b"],
  );
});

test("applyOrder attributes only the row that moved", () => {
  const list = [row("a", { id: "a" }), row("b", { id: "b" })];
  const next = applyOrder(list, ["b", "a"], "user", ["b"]);
  assert.equal(next.find((entry) => entry.id === "b")?.rankBy, "user");
  assert.equal(next.find((entry) => entry.id === "a")?.rankBy, null);
});

test("applyOrder keeps a placed row that was not in the order behind the ones that were", () => {
  const list = [
    row("a", { id: "a" }),
    row("done", { id: "done", rank: 0, doneAt: "2026-09-06T02:00:00Z" }),
  ];
  const next = applyOrder(list, ["a"], "user");
  assert.equal(next.find((entry) => entry.id === "a")?.rank, 0);
  assert.equal(next.find((entry) => entry.id === "done")?.rank, 1);
});

test("a user move to the top puts the row first", () => {
  const list = [row("a", { id: "a" }), row("b", { id: "b" }), row("c", { id: "c" })];
  const { list: next } = moveFollowUp(list, "c", "top", "user");
  assert.deepEqual(
    orderFollowUps(next).map((entry) => entry.id),
    ["c", "a", "b"],
  );
});

test("an agent move to the top stops below the rows the user placed", () => {
  const list = [
    row("a", { id: "a", rank: 0, rankBy: "user" as const }),
    row("b", { id: "b", rank: 1 }),
    row("c", { id: "c", rank: 2 }),
  ];
  const { list: next, blockedBy } = moveFollowUp(list, "c", "top", "agent");
  assert.equal(blockedBy, 1);
  assert.deepEqual(
    orderFollowUps(next).map((entry) => entry.id),
    ["a", "c", "b"],
  );
});

test("a user move to the top ignores the clamp that binds agents", () => {
  const list = [
    row("a", { id: "a", rank: 0, rankBy: "user" as const }),
    row("b", { id: "b", rank: 1 }),
  ];
  const { list: next, blockedBy } = moveFollowUp(list, "b", "top", "user");
  assert.equal(blockedBy, 0);
  assert.deepEqual(
    orderFollowUps(next).map((entry) => entry.id),
    ["b", "a"],
  );
});

test("a row the user dragged to the bottom does not close the top to agents", () => {
  const list = [
    row("a", { id: "a", rank: 0 }),
    row("b", { id: "b", rank: 1 }),
    row("sunk", { id: "sunk", rank: 2, rankBy: "user" as const }),
  ];
  const { list: next, blockedBy } = moveFollowUp(list, "b", "top", "agent");
  assert.equal(blockedBy, 0);
  assert.deepEqual(
    orderFollowUps(next).map((entry) => entry.id),
    ["b", "a", "sunk"],
  );
});

test("a row with no reason prints without an empty bracket", () => {
  const text = formatList([row("Ask about the caching layer", { reason: null })]);
  assert.match(text, /Ask about the caching layer/);
  assert.doesNotMatch(text, /\[\]/);
  assert.doesNotMatch(text, /\[null\]/);
});

test("the agent-facing list omits the reason when there is none", () => {
  const text = formatListForAgent([row("a", { id: "abc12345", reason: null })]);
  assert.match(text, /^- abc12345 a$/m);
});

test("reasonless rows are absent from the rollup, not a category in it", () => {
  const list = [
    row("a", { reason: "risk" }),
    row("b", { reason: null }),
    row("c", { reason: null }),
  ];
  assert.deepEqual(rollupByReason(list), [{ reason: "risk", count: 1 }]);
  assert.equal(formatRollup(list), "1 risk");
});

test("a list of only reasonless rows rolls up to nothing", () => {
  assert.equal(formatRollup([row("a", { reason: null })]), "");
});

test("a newly recorded row can be placed at the front on the way in", () => {
  // The record-time priority path: the new row is unranked, and the rows it
  // jumps have never been placed by anyone.
  const list = [row("a", { id: "a" }), row("b", { id: "b" }), row("new", { id: "new" })];
  const { list: next, blockedBy } = moveFollowUp(list, "new", "top", "agent");
  assert.equal(blockedBy, 0);
  assert.deepEqual(
    orderFollowUps(next).map((entry) => entry.id),
    ["new", "a", "b"],
  );
});

test("moving to the bottom is never clamped", () => {
  // A user-placed row stays ahead of the moved one, so a clamp wrongly applied
  // to downward moves would report it as an obstacle.
  const list = [
    row("a", { id: "a", rank: 0, rankBy: "user" as const }),
    row("b", { id: "b", rank: 1 }),
  ];
  const { list: next, blockedBy } = moveFollowUp(list, "b", "bottom", "agent");
  // Nothing blocked it, so the tool must not claim rows stood in its way.
  assert.equal(blockedBy, 0);
  assert.deepEqual(
    orderFollowUps(next).map((entry) => entry.id),
    ["a", "b"],
  );
});

test("moving a row that is not open changes nothing", () => {
  const list = [row("a", { id: "a" })];
  const { list: next } = moveFollowUp(list, "missing", "top", "user");
  assert.deepEqual(next, list);
});

test("the agent-facing list marks rows already sent to the agent", () => {
  const sent = [row("a", { id: "id1", sentAt: "2026-09-06T01:00:00Z" })];
  assert.match(formatListForAgent(sent), /in progress, sent to you/);
  assert.equal(formatListForAgent([]), "No follow-ups on this thread.");
});

test("a short selection becomes the follow-up text with no detail", () => {
  const captured = selectionToFollowUp("  Check the retry budget here.  ");
  assert.deepEqual(captured, { text: "Check the retry budget here." });
});

test("a selection spanning lines is collapsed into one line", () => {
  const captured = selectionToFollowUp("Check the\n\n  retry budget");
  assert.equal(captured?.text, "Check the retry budget");
});

test("a long selection is truncated for the row and kept whole as detail", () => {
  const selection = `${"word ".repeat(80)}end`;
  const captured = selectionToFollowUp(selection);
  assert.ok(captured !== null);
  assert.ok(captured.text.length <= TEXT_MAX);
  assert.match(captured.text, /\u2026$/);
  // The point of capturing a selection is not losing it.
  assert.equal(captured.detail, selection.trim());
});

test("truncation does not cut a word in half", () => {
  // The word length matters: with a 7-character cycle the hard cut at
  // TEXT_MAX lands one character into a word, so a version that ignored word
  // boundaries would end "\u2026a\u2026" here. An earlier fixture used a length that
  // divided evenly and passed either way, proving nothing.
  const captured = selectionToFollowUp("abcdef ".repeat(60));
  assert.ok(captured !== null);
  assert.match(captured.text, /abcdef\u2026$/);
});

test("an unbroken run is cut hard rather than losing everything", () => {
  const captured = selectionToFollowUp("x".repeat(400));
  assert.ok(captured !== null);
  assert.equal(captured.text.length, TEXT_MAX);
});

test("a blank selection captures nothing", () => {
  assert.equal(selectionToFollowUp("   \n  "), null);
});

test("amending keeps the row's identity instead of replacing it", () => {
  const original = row("Fix the flaky test", {
    id: "a1",
    sentAt: "2026-09-06T01:00:00Z",
    rank: 3,
  });
  const { list, outcome } = amendFollowUp([original], "a1", {
    text: "Fix the flaky auth test",
  }, "user");
  assert.equal(outcome, "amended");
  const amended = list[0];
  assert.equal(amended?.text, "Fix the flaky auth test");
  // The things dismiss-plus-re-record destroyed.
  assert.equal(amended?.createdAt, original.createdAt);
  assert.equal(amended?.sentAt, original.sentAt);
  assert.equal(amended?.rank, 3);
});

test("an amended row still answers to what it used to say", () => {
  const { list } = amendFollowUp([row("Fix the flaky test", { id: "a1" })], "a1", {
    text: "Fix the flaky auth test under parallel runs",
  }, "user");
  // The whole point: the original wording cannot come back as a second row.
  const { outcome } = addFollowUp(list, row("fix the FLAKY test"), []);
  assert.equal(outcome, "duplicate");
});

test("amending onto another row's text is refused", () => {
  const list = [row("a", { id: "a1" }), row("b", { id: "b1" })];
  const { outcome, list: next } = amendFollowUp(list, "a1", { text: "b" }, "user");
  assert.equal(outcome, "duplicate");
  assert.deepEqual(next, list);
});

test("amending onto a dismissed wording is refused", () => {
  const list = [row("a", { id: "a1" })];
  const { outcome } = amendFollowUp(list, "a1", { text: "Gone" }, "user", [
    normalizeKey("gone"),
  ]);
  assert.equal(outcome, "dismissed");
});

test("an agent may not reword a row the user wrote", () => {
  const list = [row("My own note", { id: "a1", createdBy: "user", reason: null })];
  const { outcome, list: next } = amendFollowUp(list, "a1", { text: "Reworded" }, "agent");
  assert.equal(outcome, "forbidden");
  assert.deepEqual(next, list);
});

test("an agent may still attach what it learned to the user's row", () => {
  const list = [row("My own note", { id: "a1", createdBy: "user", reason: null })];
  const { outcome, row: amended } = amendFollowUp(
    list,
    "a1",
    { detail: "The retry budget is set in config.ts:20." },
    "agent",
  );
  assert.equal(outcome, "amended");
  assert.match(amended?.detail ?? "", /config\.ts:20/);
});

test("the user may reword their own row, and an agent may reword its own", () => {
  const mine = [row("My own note", { id: "a1", createdBy: "user", reason: null })];
  assert.equal(amendFollowUp(mine, "a1", { text: "Better" }, "user").outcome, "amended");
  const theirs = [row("Agent note", { id: "b1", createdBy: "agent" })];
  assert.equal(amendFollowUp(theirs, "b1", { text: "Better" }, "agent").outcome, "amended");
});

test("a legacy row with no author counts as the agent's", () => {
  const list = [row("Old row", { id: "a1" })];
  assert.equal(amendFollowUp(list, "a1", { text: "Reworded" }, "agent").outcome, "amended");
});

test("an amendment that changes nothing reports so rather than rewriting", () => {
  const list = [row("a", { id: "a1", file: null })];
  assert.equal(amendFollowUp(list, "a1", { text: "a" }, "user").outcome, "unchanged");
  assert.equal(amendFollowUp(list, "a1", {}, "user").outcome, "unchanged");
});

test("amending a row that is not there changes nothing", () => {
  const list = [row("a", { id: "a1" })];
  const { outcome, list: next } = amendFollowUp(list, "nope", { text: "x" }, "user");
  assert.equal(outcome, "not-found");
  assert.deepEqual(next, list);
});

test("reason and file can be amended, including back to nothing", () => {
  const list = [row("a", { id: "a1", reason: "risk", file: "x.ts" })];
  const { row: amended, outcome } = amendFollowUp(
    list,
    "a1",
    { reason: null, file: null },
    "user",
  );
  assert.equal(outcome, "amended");
  assert.equal(amended?.reason, null);
  assert.equal(amended?.file, null);
});

test("the handoff prompt invokes the skill and carries the row's own record", () => {
  const prompt = handoffPrompt(
    "file-issue",
    row("Fix the flaky auth test", {
      file: "auth.ts:88",
      detail: "Fails only under load.",
    }),
  );
  assert.ok(prompt.startsWith("/file-issue Fix the flaky auth test"));
  assert.ok(prompt.includes("auth.ts:88"));
  assert.ok(prompt.includes("Fails only under load."));
});

test("a row with no anchor or detail still produces a clean invocation", () => {
  assert.equal(
    handoffPrompt("ship-issue", row("Do the thing", { file: null, detail: null })),
    "/ship-issue Do the thing",
  );
});

test("no skill means the prompt is just the follow-up, with no stray slash", () => {
  const prompt = handoffPrompt(
    null,
    row("Do the thing", { file: "a.ts:1", detail: "Because." }),
  );
  assert.ok(prompt.startsWith("Do the thing"));
  assert.ok(!prompt.includes("/"), `unexpected slash in ${JSON.stringify(prompt)}`);
  assert.ok(prompt.includes("Because."));
});

test("a child going idle marks the row that sent it, and nothing else", () => {
  const list = [
    row("sent there", { handoffThreadId: "thr_a", handoffState: "running" }),
    row("sent elsewhere", { handoffThreadId: "thr_b", handoffState: "running" }),
    row("never handed off"),
  ];
  const { list: next, changed } = markHandoffState(list, "thr_a", "finished");
  assert.equal(changed, true);
  assert.equal(next[0]?.handoffState, "finished");
  assert.equal(next[1]?.handoffState, "running");
  assert.equal(next[2]?.handoffState, undefined);
});

test("a late event about a done row's child does not reopen the question", () => {
  const list = [
    row("already closed", {
      handoffThreadId: "thr_a",
      handoffState: "running",
      doneAt: "2026-09-07T00:00:00.000Z",
    }),
  ];
  const { list: next, changed } = markHandoffState(list, "thr_a", "finished");
  assert.equal(changed, false);
  assert.equal(next[0]?.handoffState, "running");
});

test("repeating a state the row already has reports no change", () => {
  const list = [row("x", { handoffThreadId: "thr_a", handoffState: "finished" })];
  assert.equal(markHandoffState(list, "thr_a", "finished").changed, false);
});

test("a returned handoff needs review; a running or finished-and-closed one does not", () => {
  assert.equal(
    needsReview(row("a", { handoffThreadId: "t", handoffState: "finished" })),
    true,
  );
  assert.equal(
    needsReview(row("b", { handoffThreadId: "t", handoffState: "failed" })),
    true,
  );
  assert.equal(
    needsReview(row("c", { handoffThreadId: "t", handoffState: "running" })),
    false,
  );
  assert.equal(
    needsReview(
      row("d", {
        handoffThreadId: "t",
        handoffState: "finished",
        doneAt: "2026-09-07T00:00:00.000Z",
      }),
    ),
    false,
  );
});

test("the rollup names the exception, not the default", () => {
  const list = [
    row("a", { reason: "deferred" }),
    row("b", { reason: "deferred" }),
    row("c", { reason: "risk" }),
    row("d", { reason: null }),
  ];
  assert.equal(formatRollup(list), "1 risk");
});

test("a list of nothing but deferred and user rows has no rollup at all", () => {
  const list = [row("a", { reason: "deferred" }), row("b", { reason: null })];
  assert.equal(formatRollup(list), "");
});

test("every reason other than the hidden one still counts", () => {
  const list = [
    row("a", { reason: "blocked" }),
    row("b", { reason: "risk" }),
    row("c", { reason: "cleanup" }),
    row("d", { reason: "out-of-scope" }),
  ];
  const named = formatRollup(list);
  for (const reason of ["blocked", "risk", "cleanup", "out-of-scope"]) {
    assert.ok(named.includes(reason), `${reason} missing from ${named}`);
  }
});

test("a thread with no open rows is cleared once it has recorded something", () => {
  assert.equal(isCleared([], true), true);
});

// The term the whole gate exists for. Drop `everRecorded` from isCleared and
// this goes red: every thread in bb that never touched the plugin has no open
// rows, and would get the card.
test("a thread that never recorded a follow-up is not cleared, however empty", () => {
  assert.equal(isCleared([], false), false);
});

test("open rows are not cleared, whatever the flag says", () => {
  assert.equal(isCleared([row("a")], true), false);
  assert.equal(isCleared([row("a")], false), false);
});

test("a running handoff is what blocks a quiet archive", () => {
  assert.equal(hasRunningHandoff([row("a", { handoffState: "running" })]), true);
});

// Match "finished" or "failed" instead of "running" and this goes red. Those
// two are reports that have already come back; only "running" names a child
// that archiving would take down mid-turn.
test("a settled handoff does not block archiving", () => {
  assert.equal(
    hasRunningHandoff([
      row("a", { handoffState: "finished" }),
      row("b", { handoffState: "failed" }),
      row("c"),
    ]),
    false,
  );
});

test("no rows at all is nothing to lose", () => {
  assert.equal(hasRunningHandoff([]), false);
});

test("a row carried up from a child keeps what the observation was", () => {
  const carried = carriedFromChild(
    row("Give the handoff tab a title for fresh-start mode", {
      reason: "out-of-scope",
      file: "app.tsx:99",
      detail: "It says Hand off even with no row.",
    }),
    "thr_child",
    "new-id",
    "2026-09-07T00:00:00.000Z",
  );
  assert.equal(carried.text, "Give the handoff tab a title for fresh-start mode");
  assert.equal(carried.reason, "out-of-scope");
  assert.equal(carried.file, "app.tsx:99");
  assert.equal(carried.detail, "It says Hand off even with no row.");
  assert.equal(carried.inheritedFrom, "thr_child");
  assert.equal(carried.id, "new-id");
  assert.equal(carried.createdAt, "2026-09-07T00:00:00.000Z");
});

test("a carried row drops everything that belonged to the child's own life", () => {
  const carried = carriedFromChild(
    row("Something noticed", {
      sentAt: "2026-01-01T00:00:00.000Z",
      handoffThreadId: "thr_grandchild",
      handoffState: "finished",
      rank: 3,
      rankBy: "user",
      aliases: ["something else"],
    }),
    "thr_child",
    "new-id",
    "2026-09-07T00:00:00.000Z",
  );
  // Each of these would have the parent's copy claim a history it never had.
  assert.equal(carried.sentAt, undefined);
  assert.equal(carried.handoffThreadId, undefined);
  assert.equal(carried.handoffState, undefined);
  assert.equal(carried.rank, undefined);
  assert.equal(carried.rankBy, undefined);
  assert.equal(carried.aliases, undefined);
});

test("a carried row is an agent's, whoever wrote it on the child", () => {
  const carried = carriedFromChild(
    row("A row the user typed on the child", { createdBy: "user" }),
    "thr_child",
    "new-id",
    "2026-09-07T00:00:00.000Z",
  );
  // Authorship governs who may reword a row, and on the parent nobody has
  // written this yet. Claiming the user did would freeze it against amendment.
  assert.equal(carried.createdBy, "agent");
});

test("carrying goes through the same gate as recording: dismissed stays dismissed", () => {
  const carried = carriedFromChild(
    row("Already rejected here"),
    "thr_child",
    "new-id",
    "2026-09-07T00:00:00.000Z",
  );
  const { list, outcome } = addFollowUp([], carried, [
    normalizeKey("Already rejected here"),
  ]);
  assert.equal(outcome, "dismissed");
  assert.equal(list.length, 0);
});

test("carrying the same child row twice adds it once", () => {
  const first = carriedFromChild(row("Noticed once"), "thr_child", "a", "2026-09-07T00:00:00.000Z");
  const second = carriedFromChild(row("Noticed once"), "thr_child", "b", "2026-09-07T00:01:00.000Z");
  const one = addFollowUp([], first, []);
  assert.equal(one.outcome, "added");
  // thread.idle fires on every idle, not once, so this is the real guard.
  const two = addFollowUp(one.list, second, []);
  assert.equal(two.outcome, "duplicate");
  assert.equal(two.list.length, 1);
});

test("a value flag takes the token after it, and both leave the positionals", () => {
  const { values, rest, missing } = takeValueFlags(
    ["handoff", "abc123", "file-issue", "--model", "claude-opus-5"],
    ["model", "thread"],
  );
  assert.deepEqual(values, { model: "claude-opus-5" });
  // The regression this file exists for: the skill must still be the skill.
  assert.deepEqual(rest, ["handoff", "abc123", "file-issue"]);
  assert.equal(missing, null);
});

test("a flag with nothing after it is reported, not silently dropped", () => {
  const { values, missing } = takeValueFlags(["handoff", "abc", "--model"], ["model"]);
  assert.deepEqual(values, {});
  assert.equal(missing, "model");
});

test("the token after a flag is its value even when it looks like a flag", () => {
  const { values, rest } = takeValueFlags(["--model", "--json"], ["model"]);
  assert.deepEqual(values, { model: "--json" });
  assert.deepEqual(rest, []);
});

test("a repeated flag keeps the last value", () => {
  const { values } = takeValueFlags(["--model", "a", "--model", "b"], ["model"]);
  assert.deepEqual(values, { model: "b" });
});

test("unknown flags are left alone for whoever does know them", () => {
  const { values, rest } = takeValueFlags(["amend", "id", "--text", "hi"], ["model"]);
  assert.deepEqual(values, {});
  assert.deepEqual(rest, ["amend", "id", "--text", "hi"]);
});

const mention = (provider: string, id: string) => ({ provider, id, label: id });

test("a file mention in the note becomes the row's anchor", () => {
  assert.equal(
    fileMentionOf([mention("path", "src/record-draft.tsx")]),
    "src/record-draft.tsx",
  );
});

test("mentions that are not files are not anchors", () => {
  // A follow-up pill, a thread and a project all ride in the same list.
  assert.equal(
    fileMentionOf([
      mention("follow-up", "thr_x.abc123"),
      mention("thread", "thr_y"),
      mention("project", "proj_z"),
    ]),
    null,
  );
});

test("the first file mentioned wins", () => {
  assert.equal(
    fileMentionOf([mention("path", "a.ts"), mention("path", "b.ts")]),
    "a.ts",
  );
});

test("a note with no mentions has no anchor", () => {
  assert.equal(fileMentionOf([]), null);
});

test("a file mention with a blank path is not an anchor", () => {
  assert.equal(fileMentionOf([mention("path", "   ")]), null);
});

test("a thin user note asks for both the anchor and the context", () => {
  const ask = backfillRequest(
    row("toast messages?", { createdBy: "user", file: null, detail: null }),
  );
  assert.ok(ask !== null);
  assert.match(ask, /file or path/);
  assert.match(ask, /future reader/);
  assert.match(ask, /amend_follow_up/);
});

test("only the missing half is asked for", () => {
  const noFile = backfillRequest(
    row("a note", { createdBy: "user", file: null, detail: "already explained" }),
  );
  assert.ok(noFile !== null);
  assert.match(noFile, /file or path/);
  // Asking for context it already has is how a row gets padded.
  assert.doesNotMatch(noFile, /future reader/);

  const noDetail = backfillRequest(
    row("a note", { createdBy: "user", file: "server.ts", detail: null }),
  );
  assert.ok(noDetail !== null);
  assert.doesNotMatch(noDetail, /file or path/);
  assert.match(noDetail, /future reader/);
});

test("a complete user row is not asked about", () => {
  assert.equal(
    backfillRequest(
      row("a note", { createdBy: "user", file: "server.ts", detail: "why" }),
    ),
    null,
  );
});

test("an agent's own thin row is not asked about", () => {
  // The tool that recorded it already asked for these; leaving them out was a
  // decision, not an omission.
  assert.equal(
    backfillRequest(row("agent row", { createdBy: "agent", file: null, detail: null })),
    null,
  );
  // Rows predating createdBy are agents' too.
  assert.equal(backfillRequest(row("old row", { file: null, detail: null })), null);
});

test("the ask defends the user's wording, since it lands when rewriting tempts", () => {
  const ask = backfillRequest(row("note", { createdBy: "user", file: null, detail: null }));
  assert.ok(ask !== null);
  assert.match(ask, /file and detail only/);
});

test("the expansion prompt carries the note, the row and the parent", () => {
  const prompt = expansionPrompt(
    row("creating a test follow up", { id: "abc123" }),
    "thr_parent",
  );
  // The note never became a message, so it cannot be read from any transcript.
  assert.match(prompt, /creating a test follow up/);
  assert.match(prompt, /bb follow-up amend abc123 --thread thr_parent/);
});

test("the expansion prompt forbids doing the work, and rewording", () => {
  const prompt = expansionPrompt(row("rewrite the parser"), "thr_p");
  // Without this an agent told to expand a note about X goes and does X.
  assert.match(prompt, /Do not do the work/);
  assert.match(prompt, /Do not change its text/);
});

test("the expansion prompt bounds how much context it reads", () => {
  // A fork inheriting the whole conversation died on "Prompt is too long".
  const prompt = expansionPrompt(row("note"), "thr_parent");
  assert.match(prompt, /bb thread log thr_parent --limit \d+/);
  assert.match(prompt, /Do not page further back/);
});

test("the expansion prompt says to write nothing rather than guess", () => {
  assert.match(expansionPrompt(row("note"), "thr_p"), /amend nothing and stop/);
});

test("the expansion prompt tells the helper to clean itself up", () => {
  assert.match(expansionPrompt(row("note"), "thr_p"), /bb thread archive --self/);
});

test("a row with a helper working on it reads as expanding", () => {
  assert.equal(
    isExpanding(row("note", { expandingSince: "2026-09-07T00:00:00.000Z" })),
    true,
  );
  assert.equal(isExpanding(row("note")), false);
  assert.equal(isExpanding(row("note", { expandingSince: null })), false);
});

test("a finished row is never shown as expanding", () => {
  // Closing a row while a helper is mid-flight should not leave a spinner on it
  // in the Done section.
  assert.equal(
    isExpanding(
      row("note", {
        expandingSince: "2026-09-07T00:00:00.000Z",
        doneAt: "2026-09-07T01:00:00.000Z",
      }),
    ),
    false,
  );
});

test("identical lists compare equal, different lengths do not", () => {
  const one = [row("a", { id: "1" })];
  assert.equal(rowsEqual(one, [row("a", { id: "1" })]), true);
  assert.equal(rowsEqual(one, []), false);
  assert.equal(rowsEqual([], []), true);
});

test("a change to ANY field is detected, including ones added later", () => {
  // Self-maintaining on purpose. The bug this replaces was a hand-written list
  // of three fields that silently ignored every other one, so this walks the
  // row rather than naming what to check: a field added to FollowUp is covered
  // here the day it exists.
  const base: Record<string, unknown> = {
    id: "1",
    text: "a note",
    reason: "risk",
    file: "server.ts",
    detail: "why",
    createdAt: "2026-01-01T00:00:00.000Z",
    sentAt: "2026-01-02T00:00:00.000Z",
    handoffThreadId: "thr_x",
    handoffState: "running",
    doneAt: null,
    doneBy: null,
    doneNote: null,
    rank: 1,
    rankBy: "user",
    createdBy: "user",
    inheritedFrom: "thr_child",
    expandingSince: "2026-01-03T00:00:00.000Z",
  };
  for (const key of Object.keys(base)) {
    const changed = { ...base, [key]: "CHANGED" };
    assert.equal(
      rowsEqual([base as never], [changed as never]),
      false,
      `a change to "${key}" was not detected`,
    );
  }
});

test("a row a helper gave up on says so, once it has stopped", () => {
  assert.equal(expansionGaveUp(row("n", { expandOutcome: "unresolved" })), true);
  // Not while it is still going: one state at a time.
  assert.equal(
    expansionGaveUp(
      row("n", { expandOutcome: "unresolved", expandingSince: "2026-01-01T00:00:00.000Z" }),
    ),
    false,
  );
  assert.equal(expansionGaveUp(row("n", { expandOutcome: "described" })), false);
  assert.equal(expansionGaveUp(row("n")), false);
});

test("a finished row never advertises a failed expansion", () => {
  assert.equal(
    expansionGaveUp(row("n", { expandOutcome: "unresolved", doneAt: "2026-01-02T00:00:00.000Z" })),
    false,
  );
});

test("a highlighted sentence keeps the prose around it", () => {
  const message = "Before it. The bit you highlighted. After it.";
  const context = contextAround(message, "The bit you highlighted.");
  assert.ok(context !== null);
  assert.match(context, /Before it/);
  assert.match(context, /After it/);
});

test("highlighting the whole message adds nothing", () => {
  // The row already says everything the message did.
  assert.equal(contextAround("All of it.", "All of it."), null);
});

test("a selection that is not in the message adds nothing", () => {
  // The visible text can differ from what was highlighted; a guess is worse
  // than an empty detail.
  assert.equal(contextAround("Some message.", "not in here"), null);
});

test("the context is bounded and marked where it was cut", () => {
  const long = `${"a".repeat(2000)} NEEDLE ${"b".repeat(2000)}`;
  const context = contextAround(long, "NEEDLE");
  assert.ok(context !== null);
  assert.ok(context.length <= 1000, "must not exceed DETAIL_MAX");
  // An excerpt that does not say it is an excerpt reads as the whole message.
  assert.ok(context.startsWith("…"));
  assert.ok(context.endsWith("…"));
});

test("empty inputs add nothing", () => {
  assert.equal(contextAround("", "x"), null);
  assert.equal(contextAround("something", "   "), null);
});

test("the expansion prompt uses the configured turns and word cap", () => {
  const prompt = expansionPrompt(row("note"), "thr_p", { turns: 3, wordCap: 90 });
  assert.match(prompt, /bb thread log thr_p --limit 3/);
  assert.match(prompt, /Under 90 words/);
  // The shipped defaults must not leak through when a caller overrode them.
  assert.doesNotMatch(prompt, new RegExp(`--limit ${EXPANSION_TURNS}\\b`));
  assert.doesNotMatch(prompt, new RegExp(`Under ${EXPANSION_WORD_CAP} words`));
});

test("the expansion prompt falls back to the shipped defaults", () => {
  const prompt = expansionPrompt(row("note"), "thr_p");
  assert.match(prompt, new RegExp(`--limit ${EXPANSION_TURNS}\\b`));
  assert.match(prompt, new RegExp(`Under ${EXPANSION_WORD_CAP} words`));
});

test("house style is absent unless there is something to say", () => {
  assert.equal(houseStyleBlock(""), null);
  assert.equal(houseStyleBlock("   \n  "), null);
  assert.equal(houseStyleBlock(null), null);
  assert.equal(houseStyleBlock(undefined), null);
});

test("house style names whose voice it is, and how far it reaches", () => {
  const block = houseStyleBlock("  Always name the file.  ");
  assert.notEqual(block, null);
  const text = (block ?? []).join("\n");
  assert.match(text, /The user's own guidance/);
  // The whole safety property: it steers the advice, never the commands.
  assert.match(text, /never the commands/);
  // Trimmed, so leading whitespace cannot push it out of the block.
  assert.match(text, /^Always name the file\.$/m);
});

test("house style reaches the expansion prompt without displacing the command", () => {
  const prompt = expansionPrompt(row("note", { id: "r1" }), "thr_p", {
    houseStyle: "Write in the second person.",
  });
  assert.match(prompt, /Write in the second person\./);
  // It sits between the writing advice and the command, so an agent reading in
  // order sees the override before it acts, and the command after it.
  assert.ok(
    prompt.indexOf("Write in the second person.") <
      prompt.indexOf("bb follow-up amend r1"),
  );
  assert.ok(
    prompt.indexOf("Under") < prompt.indexOf("Write in the second person."),
  );
});

test("an empty house style leaves the prompt exactly as it was", () => {
  const bare = expansionPrompt(row("note"), "thr_p");
  assert.equal(expansionPrompt(row("note"), "thr_p", { houseStyle: "" }), bare);
  assert.equal(expansionPrompt(row("note"), "thr_p", { houseStyle: "  " }), bare);
});

test("the per-thread cap can be lowered and raised", () => {
  const three = [row("one"), row("two"), row("three")];
  assert.equal(addFollowUp(three, row("four"), [], 3).outcome, "full");
  assert.equal(addFollowUp(three, row("four"), [], 4).outcome, "added");
  // Omitting it keeps the cap that has always applied.
  assert.equal(addFollowUp(three, row("four"), []).outcome, "added");
});

test("a lowered cap refuses without discarding what is already there", () => {
  const three = [row("one"), row("two"), row("three")];
  const result = addFollowUp(three, row("four"), [], 1);
  assert.equal(result.outcome, "full");
  assert.equal(result.list.length, 3);
});

test("dismissal still beats a cap that would have allowed the row", () => {
  // Order matters: checking the cap first would report "full" for a row that
  // was actually refused for a reason the user chose.
  assert.equal(
    addFollowUp([row("one")], row("gone"), [normalizeKey("gone")], 50).outcome,
    "dismissed",
  );
});

test("the cap ceiling is above the shipped default", () => {
  // Otherwise the setting could only ever narrow, which is not what it is for.
  assert.ok(CAP_CEILING > MAX_PER_THREAD);
});
