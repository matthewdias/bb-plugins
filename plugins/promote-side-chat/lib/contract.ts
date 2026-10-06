// The RPC contract between the header control and the server. Shared so the
// frontend's calls are typed against the same schemas the server validates.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

/** At most this many side chats are listed for one thread. */
export const LIST_LIMIT = 50;

const threadId = z.string().trim().min(1);

export const sideChatSummarySchema = z
  .object({
    id: z.string(),
    /** What the user asked, else what they replied to. One line. */
    preview: z.string(),
    updatedAt: z.number(),
  })
  .strict();

export const promotionSchema = z
  .object({
    threadId: z.string(),
    title: z.string(),
    /** True when this side chat had already been promoted to `threadId`. */
    alreadyPromoted: z.boolean(),
    /** Steps after the fork that did not land. The new thread stands regardless. */
    warnings: z.array(z.string()),
  })
  .strict();

export const rpcContract = defineRpcContract({
  listSideChats: {
    input: z.object({ threadId }).strict(),
    output: z.object({ sideChats: z.array(sideChatSummarySchema) }).strict(),
  },
  promoteSideChat: {
    input: z
      .object({
        sideChatThreadId: threadId,
        environment: z.enum(["shared", "worktree"]),
        title: z.string().trim().min(1).max(200).optional(),
      })
      .strict(),
    output: promotionSchema,
  },
});

export type SideChatSummary = z.infer<typeof sideChatSummarySchema>;
export type Promotion = z.infer<typeof promotionSchema>;
export type EnvironmentChoice = "shared" | "worktree";
