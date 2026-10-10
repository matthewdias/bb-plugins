// Reviewing a pull request on its card: shaping bb's diff answers, reading a
// patch's lines, and the message Request changes starts from.
import assert from "node:assert/strict";
import test from "node:test";
import {
  lineAt,
  orderComments,
  patchLines,
  REVIEW_FILES_MAX,
  REVIEW_PATCH_MAX,
  reviewDiff,
  reviewFileList,
  reviewMessage,
  reviewPatches,
  type LineComment,
} from "../lib/review.ts";

const fileRow = (path: string, extra: Record<string, unknown> = {}) => ({ path, previousPath: null, changeKind: "modified", additions: 2, deletions: 1, binary: false, loadMode: "auto", origin: "tracked", ...extra });

test("reviewFileList: bb's files in its order, capped, and nothing when it has none to give", () => {
  const list = reviewFileList({ outcome: "available", files: [fileRow("src/a.ts"), fileRow("old.png", { binary: true, changeKind: "deleted" }), fileRow("src/new.ts", { previousPath: "src/old.ts", changeKind: "renamed" }), { nope: 1 }, fileRow("")] });
  assert.deepEqual(list, {
    files: [
      { path: "src/a.ts", previousPath: null, change: "modified", additions: 2, deletions: 1, binary: false },
      { path: "old.png", previousPath: null, change: "deleted", additions: 2, deletions: 1, binary: true },
      { path: "src/new.ts", previousPath: "src/old.ts", change: "renamed", additions: 2, deletions: 1, binary: false },
    ],
    more: 0,
  });
  const many = reviewFileList({ outcome: "available", files: Array.from({ length: REVIEW_FILES_MAX + 3 }, (_, n) => fileRow(`f${n}.ts`)) });
  assert.deepEqual([many?.files.length, many?.more, many?.files.at(-1)?.path], [REVIEW_FILES_MAX, 3, `f${REVIEW_FILES_MAX - 1}.ts`]);
  for (const response of [{ outcome: "not_applicable" }, { outcome: "unavailable", failure: {} }, { outcome: "available" }, null]) {
    assert.equal(reviewFileList(response), null, JSON.stringify(response));
  }
});

test("reviewPatches: each file's patch by path", () => {
  const patches = reviewPatches({ outcome: "available", patches: [{ path: "a.ts", patch: "@@ -1 +1 @@\n-a\n+b\n", truncated: false }, { path: "b.ts", patch: "+x", truncated: true }, { path: 7, patch: "x" }] });
  assert.deepEqual([...patches], [["a.ts", { patch: "@@ -1 +1 @@\n-a\n+b\n", truncated: false }], ["b.ts", { patch: "+x", truncated: true }]]);
  assert.equal(reviewPatches({ outcome: "unavailable" }).size, 0);
});

test("reviewDiff: a long patch is cut on a line, and says so; so does one bb cut or could not give", () => {
  const list = reviewFileList({ outcome: "available", files: [fileRow("big.ts"), fileRow("cut.ts"), fileRow("missing.ts"), fileRow("img.png", { binary: true }), fileRow("ok.ts")] });
  if (list === null) throw new Error("no list");
  const line = `+${"x".repeat(99)}\n`;
  const big = `@@ -0,0 +1,500 @@\n${line.repeat(500)}`;
  const diff = reviewDiff(
    list,
    new Map([
      ["big.ts", { patch: big, truncated: false }],
      ["cut.ts", { patch: "+a\n", truncated: true }],
      ["ok.ts", { patch: "+ok​\n", truncated: false }],
    ]),
    "main",
  );
  const by = new Map(diff.files.map((file) => [file.path, file]));
  const shown = by.get("big.ts")!;
  assert.ok(shown.patch.length <= REVIEW_PATCH_MAX && shown.patch.length > REVIEW_PATCH_MAX - 200);
  assert.ok(shown.patch.endsWith("\n"), "whole lines only");
  assert.equal(shown.cut, true);
  assert.deepEqual([by.get("cut.ts")?.cut, by.get("cut.ts")?.patch], [true, "+a\n"]);
  assert.deepEqual([by.get("missing.ts")?.cut, by.get("missing.ts")?.patch], [true, ""], "a file with no patch to show says the rest is elsewhere");
  assert.deepEqual([by.get("img.png")?.cut, by.get("img.png")?.patch], [false, ""], "a binary file has none to miss");
  assert.deepEqual([by.get("ok.ts")?.cut, by.get("ok.ts")?.patch], [false, "+ok⟦U+200B⟧\n"], "a character that draws nothing is shown");
  assert.deepEqual([diff.base, diff.more], ["main", 0]);
});

const PATCH = ["diff --git a/src/queue.ts b/src/queue.ts", "--- a/src/queue.ts", "+++ b/src/queue.ts", "@@ -12,3 +12,4 @@ function run() {", "   const max = 5;", "-  retry(job);", "+  retry(job, { backoff: true });", "+  log(job);", "   return job;", "\\ No newline at end of file", "@@ -40 +41,0 @@", "-gone();"].join("\n");

test("patchLines: every line with its number either side", () => {
  assert.deepEqual(patchLines(PATCH), [
    { kind: "context", old: 12, new: 12, text: "  const max = 5;" },
    { kind: "del", old: 13, new: null, text: "  retry(job);" },
    { kind: "add", old: null, new: 13, text: "  retry(job, { backoff: true });" },
    { kind: "add", old: null, new: 14, text: "  log(job);" },
    { kind: "context", old: 14, new: 15, text: "  return job;" },
    { kind: "del", old: 40, new: null, text: "gone();" },
  ]);
  assert.deepEqual(patchLines("--- a/x\n+++ b/x\n"), [], "headers are not lines of the file");
});

test("lineAt: a line of the new file, or of the old, as the patch shows it", () => {
  assert.equal(lineAt(PATCH, "new", 13)?.text, "  retry(job, { backoff: true });");
  assert.equal(lineAt(PATCH, "new", 15)?.text, "  return job;");
  assert.equal(lineAt(PATCH, "old", 13)?.text, "  retry(job);");
  assert.equal(lineAt(PATCH, "old", 40)?.text, "gone();");
  assert.equal(lineAt(PATCH, "new", 40), null, "line 40 of the new file is not in the changes shown");
  assert.equal(lineAt(PATCH, "new", 99), null);
});

const comment = (id: string, path: string, line: number, extra: Partial<LineComment> = {}): LineComment => ({ id, path, side: "new", line, text: `line ${line}`, body: `Fix ${id}`, ...extra });

test("orderComments: as the diff shows them, by file then line, a removed line before the one that replaced it", () => {
  const ordered = orderComments(
    [comment("d", "b.ts", 3), comment("c", "a.ts", 13), comment("b", "a.ts", 13, { side: "old" }), comment("a", "a.ts", 2), comment("e", "gone.ts", 1)],
    ["a.ts", "b.ts"],
  );
  assert.deepEqual(ordered.map((entry) => entry.id), ["a", "b", "c", "d", "e"]);
});

test("reviewMessage: each comment with its file, line and the line it is about", () => {
  const message = reviewMessage({ number: 71, title: "Add the offline queue" }, [
    comment("a", "src/queue.ts", 13, { text: "  retry(job, { backoff: true });", body: " Cap the backoff at an hour.\nAs we agreed. " }),
    comment("b", "src/queue.ts", 40, { side: "old", text: "gone();", body: "Why remove this?" }),
    comment("c", "README.md", 3, { text: "   ", body: "Add a line here." }),
  ]);
  assert.equal(
    message,
    [
      "I reviewed PR #71 (Add the offline queue) and want changes before it merges.",
      "",
      "1. src/queue.ts:13",
      "   > retry(job, { backoff: true });",
      "   Cap the backoff at an hour.",
      "   As we agreed.",
      "",
      "2. src/queue.ts:40 (removed line)",
      "   > gone();",
      "   Why remove this?",
      "",
      "3. README.md:3",
      "   > (blank line)",
      "   Add a line here.",
      "",
      "Address each one, then push.",
    ].join("\n"),
  );
  assert.equal(reviewMessage({ number: 71, title: "T" }, []), "I reviewed PR #71 (T) and want changes before it merges.");
});
