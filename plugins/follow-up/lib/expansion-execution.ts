// The stored choice of model for describing a follow-up. Its own module, not
// lib/followups.ts, so the pure logic there stays free of imports.
import { z } from "zod";

/**
 * The longest tier id accepted, here and by `bb follow-up handoff
 * --service-tier`. Tier ids are a provider's own, so length is the only bound.
 */
export const SERVICE_TIER_MAX = 64;

/**
 * What the expansion helper runs on, when it is not the project's defaults.
 *
 * The shape is `ExperimentalProviderModelPickerValue` — the value bb's own
 * picker emits, documented as existing to be forwarded verbatim to
 * `threads.spawn`. Modelling it here rather than reusing the host type keeps
 * the wire validated. It also means the two can drift: SDK 0.6 widened
 * `serviceTier` from `"fast" | "default"` to any tier id a provider declares,
 * and an enum here would have refused to save a tier the picker offered.
 *
 * `model` is `min(1)` on purpose. It is the one field that can be absent while
 * a selection is half-made, and a spawn carrying an empty model would fail
 * where falling back to the project default would have worked. Refusing to
 * store it is what makes the fallback the only other outcome.
 */
export const expansionExecutionSchema = z
  .object({
    providerId: z.string().min(1).max(120),
    model: z.string().min(1).max(200),
    reasoningLevel: z.enum([
      "none",
      "low",
      "medium",
      "high",
      "xhigh",
      "ultracode",
      "max",
      "ultra",
    ]),
    serviceTier: z.string().trim().min(1).max(SERVICE_TIER_MAX).optional(),
  })
  .strict();

export type ExpansionExecution = z.infer<typeof expansionExecutionSchema>;
