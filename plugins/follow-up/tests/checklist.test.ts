// A waiting checklist as a card reads it, and what each state can be told to do.
import assert from "node:assert/strict";
import test from "node:test";
import { CHECKLIST_NOTE_MAX, checklistCall, checklistOffers, checklistSummary, waitingLabel } from "../lib/checklist.ts";

const step = (position: number, title: string, checked: boolean) => ({ id: `s${position}`, position, title, checked, note: null });
const checklist = (extra: Record<string, unknown> = {}) => ({
  checklist: {
    id: "cl_1",
    threadId: "thr_a",
    name: "Ship issue",
    status: "paused",
    continuationMode: "automatic",
    lastError: null,
    // Not in order as they arrive: the next step is the first unchecked by position.
    steps: [step(3, "Open the PR", false), step(0, "Read the issue", true), step(2, "Mutation-test the guard", false), step(1, "Plan", true)],
    notes: [
      { id: "n1", stepId: null, content: "Started.", createdAt: 10 },
      { id: "n3", stepId: "s1", content: "A note on one step.", createdAt: 99 },
      { id: "n2", stepId: null, content: " Should expired tokens retry?\nThe issue doesn't say. ", createdAt: 50 },
    ],
    ...extra,
  },
});

test("checklistSummary: progress, the next step in order, and the newest note on the checklist itself", () => {
  assert.deepEqual(checklistSummary(checklist()), {
    id: "cl_1",
    name: "Ship issue",
    status: "paused",
    done: 2,
    total: 4,
    next: "Mutation-test the guard",
    note: "Should expired tokens retry?\nThe issue doesn't say.",
    noteCut: false,
    error: null,
  });
});

test("checklistSummary: only a checklist waiting on a person is one", () => {
  for (const status of ["awaiting_approval", "paused", "limit_reached"]) {
    assert.equal(checklistSummary(checklist({ status }))?.status, status);
  }
  for (const status of ["active", "completed", "closed", "orphaned", "something-new", 7]) {
    assert.equal(checklistSummary(checklist({ status })), null, String(status));
  }
  assert.equal(checklistSummary({ checklist: null }), null, "a thread with none");
  assert.equal(checklistSummary(null), null);
  assert.equal(checklistSummary({ checklist: { status: "paused" } }), null, "no id, nothing to act on");
});

test("checklistSummary: shows what it can of a checklist it half understands", () => {
  const bare = checklistSummary({ checklist: { id: "cl_2", status: "limit_reached" } });
  assert.deepEqual(bare, { id: "cl_2", name: "Checklist", status: "limit_reached", done: 0, total: 0, next: null, note: null, noteCut: false, error: null });
  const done = checklistSummary(checklist({ steps: [step(0, "Only", true)], notes: [], lastError: " Provider is down " }));
  assert.deepEqual([done?.next, done?.note, done?.error], [null, null, "Provider is down"]);
});

test("checklistSummary: a long note is cut and says so; unseen characters show as their code", () => {
  const long = checklistSummary(checklist({ notes: [{ stepId: null, content: "x".repeat(CHECKLIST_NOTE_MAX + 1), createdAt: 1 }] }));
  assert.equal(long?.note?.length, CHECKLIST_NOTE_MAX);
  assert.equal(long?.noteCut, true);
  const sly = checklistSummary(checklist({ name: "Ship​ it", steps: [step(0, "Run‮ this", false)], notes: [{ stepId: null, content: "Say​ yes", createdAt: 1 }], lastError: "Bad​" }));
  assert.deepEqual([sly?.name, sly?.next, sly?.note, sly?.error], ["Ship⟦U+200B⟧ it", "Run⟦U+202E⟧ this", "Say⟦U+200B⟧ yes", "Bad⟦U+200B⟧"]);
});

test("checklistOffers and checklistCall: each state does what Agent Checklists' own control does", () => {
  assert.deepEqual(checklistOffers("awaiting_approval"), { action: "continue", reply: false });
  assert.deepEqual(checklistOffers("paused"), { action: "resume", reply: true });
  assert.deepEqual(checklistOffers("limit_reached"), { action: "resume", reply: false });
  assert.deepEqual(checklistCall({ id: "cl_1", status: "awaiting_approval" }, "continue"), { method: "continue", input: { checklistId: "cl_1" } });
  assert.deepEqual(checklistCall({ id: "cl_1", status: "paused" }, "resume"), { method: "updateSettings", input: { checklistId: "cl_1", status: "active" } });
  assert.deepEqual(checklistCall({ id: "cl_1", status: "limit_reached" }, "resume"), { method: "resume", input: { checklistId: "cl_1" } });
  // An action its state does not offer is nothing to call.
  assert.equal(checklistCall({ id: "cl_1", status: "awaiting_approval" }, "resume"), null);
  assert.equal(checklistCall({ id: "cl_1", status: "paused" }, "continue"), null);
  assert.equal(checklistCall({ id: "cl_1", status: "limit_reached" }, "continue"), null);
  assert.deepEqual(["awaiting_approval", "paused", "limit_reached"].map((s) => waitingLabel(s as never)), ["waiting for your go-ahead", "paused", "out of continuations"]);
});
