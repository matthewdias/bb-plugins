// A thread's checklist, when it is waiting on the user.
//
// Pure, like page.ts: no plugin API. The checklist is Agent Checklists'
// (patleeman/bb-plugins), read through that plugin's own RPC; nothing here is
// stored by Follow Up. Without that plugin installed there is simply nothing
// to read, and no card.
//
// A checklist drives a thread through its steps, waking the agent when it
// goes idle with steps left. Three of its states stop and wait for a person:
//
// - awaiting approval: its mode asks before each continuation;
// - paused: the agent paused it, usually with a note saying what it needs;
// - limit reached: it has woken the agent as often as it is allowed to.
//
// Those, and only those, are a card. What the card can do is what Agent
// Checklists' own controls do, by the same calls.
import { z } from "zod";
import { reveal } from "./unseen.ts";

/** Agent Checklists' plugin id, as bb installs it. */
export const CHECKLISTS_PLUGIN = "agent-checklists";

export const WAITING_STATES = ["awaiting_approval", "paused", "limit_reached"] as const;
export type WaitingState = (typeof WAITING_STATES)[number];

/** The most of a note a card carries; the thread has the rest. */
export const CHECKLIST_NOTE_MAX = 600;

export const checklistSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(WAITING_STATES),
  done: z.number(),
  total: z.number(),
  /** The first step not yet checked. */
  next: z.string().nullable(),
  /** The newest note on the checklist itself: on a paused one, why it paused. */
  note: z.string().nullable(),
  /** Whether `note` was cut to fit. */
  noteCut: z.boolean(),
  /** What went wrong the last time it tried to continue, if anything. */
  error: z.string().nullable(),
});
export type ChecklistSummary = z.infer<typeof checklistSchema>;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function line(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text === "" ? null : reveal(text);
}

/**
 * What `getForThread` answered, as a card reads it, or null when the thread
 * has no checklist or it is not waiting on anyone. Everything shown is the
 * agent's or the checklist author's text, so each piece goes through `reveal`.
 */
export function checklistSummary(response: unknown): ChecklistSummary | null {
  const checklist = record(record(response)?.checklist);
  if (checklist === null || typeof checklist.id !== "string" || checklist.id === "") return null;
  const status = checklist.status;
  if (typeof status !== "string" || !(WAITING_STATES as readonly string[]).includes(status)) return null;

  const steps = (Array.isArray(checklist.steps) ? checklist.steps : [])
    .map(record)
    .filter((step): step is Record<string, unknown> => step !== null)
    .sort((a, b) => (typeof a.position === "number" ? a.position : 0) - (typeof b.position === "number" ? b.position : 0));
  const next = steps.find((step) => step.checked !== true);

  // Notes on the checklist as a whole, not on one step: that is where a pause says why.
  const notes = (Array.isArray(checklist.notes) ? checklist.notes : [])
    .map(record)
    .filter((note): note is Record<string, unknown> => note !== null && (note.stepId === null || note.stepId === undefined))
    .sort((a, b) => (typeof b.createdAt === "number" ? b.createdAt : 0) - (typeof a.createdAt === "number" ? a.createdAt : 0));
  const newest = typeof notes[0]?.content === "string" ? notes[0].content.trim() : "";
  const shown = reveal(newest);

  return {
    id: checklist.id,
    name: line(checklist.name) ?? "Checklist",
    status: status as WaitingState,
    done: steps.filter((step) => step.checked === true).length,
    total: steps.length,
    next: next === undefined ? null : line(next.title),
    note: shown === "" ? null : shown.slice(0, CHECKLIST_NOTE_MAX),
    noteCut: shown.length > CHECKLIST_NOTE_MAX,
    error: line(checklist.lastError),
  };
}

export const CHECKLIST_ACTIONS = ["continue", "resume"] as const;
export type ChecklistAction = (typeof CHECKLIST_ACTIONS)[number];

/**
 * What a waiting checklist can be told to do, as Agent Checklists' own
 * controls do it: approve the continuation it is waiting on, or resume one
 * that paused or ran out. A reply goes with resuming a paused one only, since
 * that is the state in which the agent has asked something.
 */
export function checklistOffers(status: WaitingState): { action: ChecklistAction; reply: boolean } {
  if (status === "awaiting_approval") return { action: "continue", reply: false };
  return { action: "resume", reply: status === "paused" };
}

/**
 * The call that carries an action out: the method on Agent Checklists' RPC
 * and its input. A paused checklist resumes by being set active; `resume` is
 * its method for one that hit its limit, and refuses any other.
 */
export function checklistCall(
  checklist: Pick<ChecklistSummary, "id" | "status">,
  action: ChecklistAction,
): { method: string; input: Record<string, unknown> } | null {
  if (checklistOffers(checklist.status).action !== action) return null;
  if (action === "continue") return { method: "continue", input: { checklistId: checklist.id } };
  return checklist.status === "limit_reached"
    ? { method: "resume", input: { checklistId: checklist.id } }
    : { method: "updateSettings", input: { checklistId: checklist.id, status: "active" } };
}

/** How each state reads on a card. */
export function waitingLabel(status: WaitingState): string {
  switch (status) {
    case "awaiting_approval":
      return "waiting for your go-ahead";
    case "paused":
      return "paused";
    case "limit_reached":
      return "out of continuations";
  }
}
