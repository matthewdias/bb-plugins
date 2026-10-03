import assert from "node:assert/strict";
import test from "node:test";
import type { ComposerMention } from "@get-bb/plugin-sdk/app";
import {
  followUpMentionId,
  isFollowUpInDraft,
  isFollowUpPill,
  withoutMentions,
} from "../lib/followups.ts";

const THREAD = "thr_a";

/** A follow-up pill for `rowId`, at the first `label` found in `text`. */
function pill(text: string, label: string, rowId: string, from = text.indexOf(label)): ComposerMention {
  assert.ok(from >= 0, `"${label}" is not in "${text}"`);
  return {
    kind: "plugin",
    pluginId: "follow-up",
    provider: "follow-up",
    id: followUpMentionId(THREAD, rowId),
    label,
    from,
    to: from + label.length,
  };
}

const isRow = (rowId: string) => (mention: ComposerMention) =>
  isFollowUpPill(mention, THREAD, rowId);

/** Every mention's label read back out of the text by its range. */
function labelsAt(draft: { text: string; mentions: readonly ComposerMention[] }): string[] {
  return draft.mentions.map((mention) => draft.text.slice(mention.from, mention.to));
}

test("followUpMentionId puts the thread before the row, as resolve expects", () => {
  assert.equal(followUpMentionId("thr_a", "abc123"), "thr_a.abc123");
});

test("isFollowUpInDraft reads the pill's id, not its label", () => {
  const text = "please Fix the test";
  assert.equal(isFollowUpInDraft([pill(text, "Fix the test", "r1")], THREAD, "r1"), true);
  // An amended row's pill still carries the old label, and still counts.
  assert.equal(isFollowUpInDraft([pill(text, "Fix the test", "r1")], THREAD, "r2"), false);
  // Typed text with no mention is not a pill.
  assert.equal(isFollowUpInDraft([], THREAD, "r1"), false);
});

test("isFollowUpInDraft ignores another provider's mention and another thread's pill", () => {
  const text = "x Fix y";
  const other = { ...pill(text, "Fix", "r1"), provider: "linear" };
  const elsewhere = { ...pill(text, "Fix", "r1"), id: followUpMentionId("thr_b", "r1") };
  const path: ComposerMention = {
    kind: "path", path: "Fix", source: "workspace", entryKind: "file", label: "Fix", from: 2, to: 5,
  };
  assert.equal(isFollowUpInDraft([other, elsewhere, path], THREAD, "r1"), false);
});

test("isFollowUpPill wants a plugin mention, not just a matching provider and id", () => {
  const id = followUpMentionId(THREAD, "r1");
  assert.equal(isFollowUpPill({ kind: "plugin", provider: "follow-up", id }, THREAD, "r1"), true);
  assert.equal(isFollowUpPill({ kind: "path", provider: "follow-up", id }, THREAD, "r1"), false);
});

test("withoutMentions returns the same draft when nothing matches", () => {
  const text = "look at Fix it";
  const draft = { text, mentions: [pill(text, "Fix", "r1")], attachments: [] };
  assert.equal(withoutMentions(draft, isRow("r2")), draft);
});

test("withoutMentions removes a pill at the start, and the space after it", () => {
  const text = "Fix the test then ship";
  const draft = { text, mentions: [pill(text, "Fix the test", "r1"), pill(text, "ship", "r2")] };
  const result = withoutMentions(draft, isRow("r1"));
  assert.equal(result.text, "then ship");
  assert.deepEqual(labelsAt(result), ["ship"]);
});

test("withoutMentions removes a pill in the middle, leaving one space", () => {
  const text = "first Fix the test then ship";
  const draft = { text, mentions: [pill(text, "Fix the test", "r1"), pill(text, "ship", "r2")] };
  const result = withoutMentions(draft, isRow("r1"));
  assert.equal(result.text, "first then ship");
  assert.deepEqual(labelsAt(result), ["ship"]);
});

test("withoutMentions removes a pill at the end, and the space before it", () => {
  const text = "ship first Fix the test";
  const draft = { text, mentions: [pill(text, "ship", "r2"), pill(text, "Fix the test", "r1")] };
  const result = withoutMentions(draft, isRow("r1"));
  assert.equal(result.text, "ship first");
  assert.deepEqual(labelsAt(result), ["ship"]);
});

test("withoutMentions removes adjacent pills, together or one at a time", () => {
  const text = "go A B C now";
  const mentions = [pill(text, "A", "ra"), pill(text, "B", "rb"), pill(text, "C", "rc")];
  const both = withoutMentions({ text, mentions }, (m) => isRow("ra")(m) || isRow("rb")(m));
  assert.equal(both.text, "go C now");
  assert.deepEqual(labelsAt(both), ["C"]);
  const middle = withoutMentions({ text, mentions }, isRow("rb"));
  assert.equal(middle.text, "go A C now");
  assert.deepEqual(labelsAt(middle), ["A", "C"]);
});

test("withoutMentions counts UTF-16 units, so text before a pill keeps its emoji", () => {
  // "🧪" is two UTF-16 code units; mention ranges are UTF-16 offsets.
  const text = "🧪 test é Fix it 🚀 ship";
  const draft = { text, mentions: [pill(text, "Fix it", "r1"), pill(text, "ship", "r2")] };
  const result = withoutMentions(draft, isRow("r1"));
  assert.equal(result.text, "🧪 test é 🚀 ship");
  assert.deepEqual(labelsAt(result), ["ship"]);
});

test("withoutMentions leaves another plugin's mention in place, at its shifted range", () => {
  const text = "Fix it and LIN-42";
  const linear: ComposerMention = {
    kind: "plugin", pluginId: "linear", provider: "linear", id: "LIN-42", label: "LIN-42",
    from: text.indexOf("LIN-42"), to: text.length,
  };
  const result = withoutMentions({ text, mentions: [pill(text, "Fix it", "r1"), linear] }, isRow("r1"));
  assert.equal(result.text, "and LIN-42");
  assert.deepEqual(result.mentions, [{ ...linear, from: 4, to: 10 }]);
});

test("withoutMentions collapses only the doubled space, not other whitespace", () => {
  const text = "one\nFix it\ntwo  Fix two";
  const draft = {
    text,
    mentions: [pill(text, "Fix it", "r1"), pill(text, "Fix two", "r2", text.lastIndexOf("Fix two"))],
  };
  // Alone on its line, the pill leaves the line empty rather than eating a newline.
  assert.equal(withoutMentions(draft, isRow("r1")).text, "one\n\ntwo  Fix two");
  // A double space the writer typed before the pill keeps one of its spaces.
  assert.equal(withoutMentions(draft, isRow("r2")).text, "one\nFix it\ntwo ");
});

test("withoutMentions omits attachments, so replace keeps the draft's own", () => {
  const text = "Fix it";
  const draft = { text, mentions: [pill(text, "Fix it", "r1")], attachments: [{ name: "a.png" }] };
  const result = withoutMentions(draft, isRow("r1"));
  assert.deepEqual(result, { text: "", mentions: [] });
});
