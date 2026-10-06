// The stored read point's schema. Server-side only: the app imports the type
// alone, so zod stays out of the frontend bundle.
import { z } from "zod";

export const THREAD_ID_MAX = 200;
export const MESSAGE_ID_MAX = 500;

export const readPointSchema = z
  .object({
    threadId: z.string().min(1).max(THREAD_ID_MAX),
    messageId: z.string().min(1).max(MESSAGE_ID_MAX),
    role: z.enum(["user", "assistant"]),
    /**
     * The last source event the message covers. Null when the point was set by
     * clicking an agent message, whose row id does not carry it.
     */
    sourceSeqEnd: z.number().int().nonnegative().nullable(),
    /** Epoch ms. A visit that starts after this has seen the point. */
    setAt: z.number().int().nonnegative(),
  })
  .strict();

export type ReadPoint = z.infer<typeof readPointSchema>;
