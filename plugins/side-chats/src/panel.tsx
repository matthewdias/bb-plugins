// The "Side chats" panel. Opened from the panel's launcher it lists the
// thread's side chats; opened on one (from the header's Open, or the list
// here) it shows that side chat, so a side chat whose tab was closed can be
// picked up again, with Promote and Archive above the conversation.
//
// The conversation is the same host `ThreadChat` the side-chat plugin's own
// panel renders, with the same "Send to main thread" action.
import { useCallback, useEffect } from "react";
import {
  experimental_Icon as Icon,
  Markdown,
  ThreadChat,
  useSdk,
  type PluginThreadPanelProps,
  type ThreadChatMessageAction,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { SideChatSummary } from "@/lib/contract";
import { cn } from "@/lib/utils";
import { StateMark, STATE_LABEL } from "./state-mark.tsx";
import { age, announce, useSideChats } from "./use-side-chats.ts";

/** Panel params naming a side chat, or null for the list. Persisted, so untrusted. */
export function parsePanelParams(params: unknown): { threadId: string; anchor: string | null } | null {
  if (typeof params !== "object" || params === null || Array.isArray(params)) return null;
  const { threadId, anchor } = params as { threadId?: unknown; anchor?: unknown };
  if (typeof threadId !== "string" || threadId === "") return null;
  return { threadId, anchor: typeof anchor === "string" && anchor !== "" ? anchor : null };
}

const BUTTON = cn(
  "inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-xs",
  "hover:bg-accent disabled:pointer-events-none disabled:opacity-50",
);

export function SideChatsPanel({ threadId, params }: PluginThreadPanelProps) {
  const target = parsePanelParams(params);
  return target === null ? (
    <SideChatList threadId={threadId} />
  ) : (
    <SideChatView mainThreadId={threadId} sideChatId={target.threadId} anchor={target.anchor} />
  );
}

type Actions = ReturnType<typeof useSideChats>;

function Actions({
  chat,
  actions,
  showOpen,
}: {
  chat: Pick<SideChatSummary, "id"> & Partial<SideChatSummary>;
  actions: Actions;
  showOpen: boolean;
}) {
  const disabled = actions.busy !== null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {showOpen && chat.preview !== undefined ? (
        <button type="button" className={BUTTON} disabled={disabled} onClick={() => actions.open(chat as SideChatSummary)}>
          Open
        </button>
      ) : null}
      <button type="button" className={BUTTON} disabled={disabled} onClick={() => void actions.promote(chat.id, "shared")}>
        <Icon name="ArrowUpRight" fallback="SideChat" className="size-3.5" aria-hidden />
        {actions.busy === chat.id ? "Working…" : "Promote to thread"}
      </button>
      <button type="button" className={BUTTON} disabled={disabled} onClick={() => void actions.promote(chat.id, "worktree")}>
        <Icon name="GitBranch" fallback="SideChat" className="size-3.5" aria-hidden />
        Into new worktree
      </button>
      <button type="button" className={BUTTON} disabled={disabled} onClick={() => void actions.archive(chat.id)}>
        <Icon name="Archive" fallback="SideChat" className="size-3.5" aria-hidden />
        Archive
      </button>
    </div>
  );
}

function SideChatList({ threadId }: { threadId: string }) {
  const actions = useSideChats(threadId);
  if (!actions.loaded) return null;
  if (actions.sideChats.length === 0) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        This thread has no side chats with messages in them. Start one with "Reply in side chat" on any
        message, or "Start side chat" here.
      </p>
    );
  }
  return (
    <ul className="h-full space-y-2 overflow-y-auto p-3">
      {actions.sideChats.map((chat) => (
        <li key={chat.id} className="space-y-2 rounded-md border border-border p-2.5">
          <div className="flex items-center gap-2 text-sm">
            <StateMark state={chat.state} />
            <span className="min-w-0 flex-1 truncate" title={chat.preview}>
              {chat.preview}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {STATE_LABEL[chat.state] ?? age(chat.updatedAt)}
            </span>
          </div>
          <Actions chat={chat} actions={actions} showOpen />
        </li>
      ))}
    </ul>
  );
}

function SideChatView({
  mainThreadId,
  sideChatId,
  anchor,
}: {
  mainThreadId: string;
  sideChatId: string;
  anchor: string | null;
}) {
  const sdk = useSdk();
  const actions = useSideChats(mainThreadId);

  // Viewing the side chat here marks it read, which raises no event; tell the
  // header once the view has settled, and again when the tab closes.
  useEffect(() => {
    const settled = setTimeout(() => announce(mainThreadId), 1500);
    return () => {
      clearTimeout(settled);
      announce(mainThreadId);
    };
  }, [mainThreadId, sideChatId]);

  // The side-chat plugin's own "Send to main thread": queue the message on the
  // main thread, labelled as coming from this side chat.
  const sendToMain = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (trimmed === "") return;
      try {
        await sdk.threads.queuedMessages.create({
          threadId: mainThreadId,
          input: [{ type: "text", text: trimmed, mentions: [] }],
          senderThreadId: sideChatId,
        });
        toast.success("Sent to main thread");
      } catch (cause) {
        toast.error(`Failed to send to main thread: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    },
    [mainThreadId, sdk, sideChatId],
  );
  const messageActions: ThreadChatMessageAction[] = [
    {
      id: "send-to-main",
      title: "Send to main thread",
      icon: "ArrowTurnBackward",
      roles: ["assistant"],
      run: (message) => sendToMain(message.text),
    },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border px-3 py-2">
        <Actions chat={{ id: sideChatId }} actions={actions} showOpen={false} />
      </div>
      <ThreadChat
        threadId={sideChatId}
        variant="compact"
        layout="contained"
        permissionPolicy="editable"
        className="min-h-0 flex-1"
        leadingContent={anchor === null ? undefined : <ReplyingTo anchor={anchor} />}
        messageActions={messageActions}
      />
    </div>
  );
}

function ReplyingTo({ anchor }: { anchor: string }) {
  return (
    <div className="mx-1 mb-2 flex flex-col items-start gap-1">
      <span className="text-xs leading-none text-muted-foreground">
        <Icon name="CornerDownRight" className="mr-1 inline-block size-3 align-middle" aria-hidden />
        Replying to
      </span>
      <div className="max-h-20 max-w-full overflow-hidden rounded-md bg-surface-recessed p-1.5 text-xs leading-5">
        <Markdown content={anchor} className="text-xs leading-5" />
      </div>
    </div>
  );
}
