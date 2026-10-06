// The RPC surface between the Triage page and the server. Inputs are checked
// at the wire; outputs are this plugin's own values, typed for the page.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { Decision, NewCard } from "./new-deck.ts";
import type { Job, UpdateJob } from "./queue.ts";
import type { Unavailable, UpdateCard, UpdateDecision } from "./updates-deck.ts";
import type { SourceSummary } from "./source.ts";

const entryRef = { entryId: z.string().min(1), marketplace: z.string().min(1) };
const versionLabel = z.object({ version: z.string(), display: z.string() });
const updateDecision = z.discriminatedUnion("action", [
  z.object({ action: z.literal("queue"), version: z.string(), at: z.number() }),
  z.object({ action: z.literal("skip"), version: z.string(), at: z.number() }),
  z.object({ action: z.literal("snooze"), version: z.string(), at: z.number(), until: z.number() }),
]);

export const rpcContract = defineRpcContract({
  deck_new: {
    input: z.object({ includeIncompatible: z.boolean().optional() }),
    output: z.custom<{ cards: NewCard[]; cutoff: number }>(() => true),
  },
  deck_saved: {
    input: z.object({}),
    output: z.custom<{ cards: NewCard[] }>(() => true),
  },
  entry_plan: {
    input: z.object(entryRef),
    output: z.custom<{
      summary: SourceSummary | null;
      /** Echoed back with an install so bb refuses if the listing moved. */
      confirmedSource: unknown;
      compatible: boolean;
      incompatibleReason: string | null;
    }>(() => true),
  },
  decide: {
    input: z.object({
      ...entryRef,
      key: z.string().min(1),
      pluginId: z.string().min(1),
      displayName: z.string().min(1),
      action: z.enum(["install", "dismiss", "save"]),
      confirmedSource: z.unknown().optional(),
    }),
    /** `previous` is what undo restores: a save the install replaced, say. */
    output: z.custom<{ job: Job | null; previous: Decision | null }>(() => true),
  },
  undo: {
    input: z.object({
      key: z.string().min(1),
      restore: z
        .object({ action: z.enum(["install", "dismiss", "save"]), at: z.number() })
        .nullable()
        .optional(),
    }),
    output: z.custom<{ undone: boolean; reason: string | null }>(() => true),
  },
  jobs_list: {
    input: z.object({}),
    output: z.custom<{ jobs: Job[] }>(() => true),
  },
  updates_deck: {
    input: z.object({}),
    output: z.custom<{
      cards: UpdateCard[];
      unavailable: Unavailable[];
      /** Updates queued or under way, in the order they will run. */
      queued: UpdateJob[];
      /** Whether a batch is under way. */
      running: boolean;
      /** Finished updates, newest first. */
      history: UpdateJob[];
    }>(() => true),
  },
  update_decide: {
    input: z.object({
      pluginId: z.string().min(1),
      displayName: z.string().min(1),
      action: z.enum(["queue", "skip", "snooze"]),
      from: versionLabel,
      to: versionLabel,
    }),
    output: z.custom<{ previous: UpdateDecision | null }>(() => true),
  },
  update_undo: {
    input: z.object({ pluginId: z.string().min(1), restore: updateDecision.nullable().optional() }),
    output: z.custom<{ undone: boolean; reason: string | null }>(() => true),
  },
  updates_start: {
    input: z.object({}),
    output: z.custom<{ started: number }>(() => true),
  },
  updates_check: {
    input: z.object({ pluginId: z.string().min(1).optional() }),
    output: z.custom<{ checked: number }>(() => true),
  },
});
