// Mark Unread — app entry.
//
// Three ways in: the message action bar, a modifier-click on a message, and a
// palette command to clear the point. The overlay does the rest; see
// src/overlay.tsx.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { clearPoint, getRpc, knownPoint, markFromHere } from "./src/actions";
import { MarkUnreadOverlay } from "./src/overlay";

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "mark-unread", component: MarkUnreadOverlay });

  app.slots.messageAction({
    id: "mark-unread-from-here",
    title: "Mark unread from here",
    icon: "MessageSquareDot",
    run: ({ threadId, message }) =>
      markFromHere(getRpc(), {
        threadId,
        messageId: message.id,
        role: message.role,
        sourceSeqEnd: message.sourceSeqEnd,
      }),
  });

  app.commands.register({
    id: "clear-read-point",
    title: "Mark Unread: clear this thread's read point",
    isAvailable: ({ threadId }) => threadId !== null && knownPoint(threadId) !== null,
    run: ({ threadId }) => {
      const rpc = getRpc();
      if (threadId && rpc) return clearPoint(rpc, threadId);
    },
  });
});
