// The RPC surface between the Triage page and the server. Inputs are checked
// at the wire; outputs are this plugin's own values, typed for the page.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { Decision, NewCard } from "./new-deck.ts";
import type { Job } from "./queue.ts";
import type { SourceSummary } from "./source.ts";

const entryRef = { entryId: z.string().min(1), marketplace: z.string().min(1) };

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
});
