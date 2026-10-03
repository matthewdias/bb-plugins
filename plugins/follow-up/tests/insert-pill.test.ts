import assert from "node:assert/strict";
import test from "node:test";
import { insertPill, stripPill } from "../src/insert-pill.ts";

const pill = { provider: "follow-up", id: "thr_x.abc123", label: "Fix the flaky test" };

/** A composer whose `insert` throws for the placements listed in `fails`. */
function fakeComposer(fails: ReadonlyArray<"cursor" | "end"> = []) {
  const calls: Array<{ part: unknown; at: "cursor" | "end" }> = [];
  return {
    calls,
    insert(part: unknown, options?: { at?: "cursor" | "end" }) {
      const at = options?.at ?? "cursor";
      calls.push({ part, at });
      if (fails.includes(at)) throw new Error(`cannot insert at ${at}`);
    },
  };
}

test("a pill goes in at the cursor when the composer is on screen", () => {
  const composer = fakeComposer();
  insertPill(composer, pill);
  assert.deepEqual(composer.calls, [{ part: pill, at: "cursor" }]);
});

test("a pill goes at the end when the composer has no cursor to insert at", () => {
  // SDK 0.6 throws for a cursor insert into a composer that is not on screen.
  const composer = fakeComposer(["cursor"]);
  insertPill(composer, pill);
  assert.deepEqual(composer.calls, [
    { part: pill, at: "cursor" },
    { part: pill, at: "end" },
  ]);
});

test("a composer that is gone altogether still fails loudly", () => {
  const composer = fakeComposer(["cursor", "end"]);
  assert.throws(() => insertPill(composer, pill), /cannot insert at end/);
});

test("stripPill replaces the draft without the row's pill", () => {
  const text = "go Fix it now";
  const draft = {
    text,
    mentions: [
      { kind: "plugin", pluginId: "follow-up", provider: "follow-up", id: "thr_x.abc123", label: "Fix it", from: 3, to: 9 },
    ],
    attachments: [],
  };
  let next: unknown = null;
  stripPill(
    { replace: (update: unknown) => void (next = (update as (d: typeof draft) => unknown)(draft)) } as never,
    "thr_x",
    "abc123",
  );
  assert.deepEqual(next, { text: "go now", mentions: [] });
});

test("stripPill swallows a composer that has gone away", () => {
  const gone = { replace: () => { throw new Error("This composer is no longer available"); } };
  assert.doesNotThrow(() => stripPill(gone as never, "thr_x", "abc123"));
});
