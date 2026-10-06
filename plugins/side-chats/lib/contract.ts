// The RPC contract between the header control, the panel, and the server.
// Shared so the frontend's calls are typed against the same schemas the server
// validates.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

/** At most this many side chats are listed for one thread. */
export const LIST_LIMIT = 50;

const threadId = z.string().trim().min(1);

export const sideChatSummarySchema = z
  .object({
    id: z.string(),
    /** What the user first asked. One line. */
    preview: z.string(),
    /** The main-thread message the side chat replies to, possibly shortened by bb. */
    anchor: z.string().nullable(),
    /** Replying now, a reply not yet looked at, or neither. */
    state: z.enum(["working", "unread", "read"]),
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

export const archiveSchema = z.object({ sideChatThreadId: z.string() }).strict();

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
  archiveSideChat: {
    input: z.object({ sideChatThreadId: threadId }).strict(),
    output: archiveSchema,
  },
  unarchiveSideChat: {
    input: z.object({ sideChatThreadId: threadId }).strict(),
    output: archiveSchema,
  },
});

export type SideChatSummary = z.infer<typeof sideChatSummarySchema>;
export type Promotion = z.infer<typeof promotionSchema>;
export type Archive = z.infer<typeof archiveSchema>;
export type EnvironmentChoice = "shared" | "worktree";
