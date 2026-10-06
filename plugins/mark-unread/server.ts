// Mark Unread — server entry.
//
// Keeps one read point per thread and flips bb's own read state to match.
// bb draws a thread's "New" divider from `lastReadAt`, which the public API
// sets only to now or null, so the position lives here and the app draws the
// divider; the sidebar's unread dot is bb's, set with `markUnread`.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { DEFAULT_MODIFIER, MODIFIER_OPTIONS, POINT_CHANGED } from "./lib/read-point";
import { MESSAGE_ID_MAX, type ReadPoint, readPointSchema, THREAD_ID_MAX } from "./lib/schema";

const threadId = z.string().min(1).max(THREAD_ID_MAX);

export const rpcContract = defineRpcContract({
  points_get: {
    input: z.object({ threadId }).strict(),
    output: z.object({ point: readPointSchema.nullable() }).strict(),
  },
  /** Mark the thread unread from this message on, replacing any earlier point. */
  points_set: {
    input: z
      .object({
        threadId,
        messageId: z.string().min(1).max(MESSAGE_ID_MAX),
        role: z.enum(["user", "assistant"]),
        sourceSeqEnd: z.number().int().nonnegative().nullable(),
      })
      .strict(),
    output: z.object({ point: readPointSchema }).strict(),
  },
  points_clear: {
    input: z
      .object({
        threadId,
        /**
         * Clear only a point set before this time: one the caller's visit has
         * seen. A point another window set since then survives.
         */
        setBefore: z.number().int().nonnegative().optional(),
        /** Also mark the thread read: Undo, putting things back as they were. */
        markRead: z.boolean().optional(),
      })
      .strict(),
    output: z.object({ cleared: z.boolean() }).strict(),
  },
});

const pointKey = (id: string) => `point:${id}`;

export default async function plugin(bb: BbPluginApi) {
  bb.settings.define({
    modifier: {
      type: "select",
      label: "Click a message to mark it unread while holding",
      description:
        "Hold this key and click a message to mark the thread unread from there, as Option-click does in Slack. Option is Alt outside macOS. Clicks on links, buttons and selected text are left alone. The message's action bar works either way.",
      options: [...MODIFIER_OPTIONS],
      default: DEFAULT_MODIFIER,
    },
  });

  async function read(id: string): Promise<ReadPoint | null> {
    const parsed = readPointSchema.safeParse(await bb.storage.kv.get<unknown>(pointKey(id)));
    return parsed.success ? parsed.data : null;
  }

  async function remove(id: string): Promise<void> {
    await bb.storage.kv.delete(pointKey(id));
    bb.realtime.publish(POINT_CHANGED, { threadId: id });
  }

  bb.rpc.register(rpcContract, {
    points_get: async ({ threadId }) => ({ point: await read(threadId) }),

    points_set: async ({ threadId, messageId, role, sourceSeqEnd }) => {
      // Row ids lead with their thread's; one that does not names a message
      // somewhere else.
      if (!messageId.startsWith(`${threadId}:`)) {
        throw new Error(`Message ${messageId} is not in thread ${threadId}`);
      }
      // Unread first: if the thread is gone this throws, and nothing is stored.
      await bb.sdk.threads.markUnread({ threadId });
      const point: ReadPoint = { threadId, messageId, role, sourceSeqEnd, setAt: Date.now() };
      await bb.storage.kv.set(pointKey(threadId), point);
      bb.realtime.publish(POINT_CHANGED, { threadId });
      return { point };
    },

    points_clear: async ({ threadId, setBefore, markRead }) => {
      const point = await read(threadId);
      const cleared = point !== null && (setBefore === undefined || point.setAt < setBefore);
      if (cleared) await remove(threadId);
      if (markRead) await bb.sdk.threads.markRead({ threadId });
      return { cleared };
    },
  });

  bb.events.on("thread.deleted", async ({ thread }) => {
    if (await read(thread.id)) await remove(thread.id);
  });
}
