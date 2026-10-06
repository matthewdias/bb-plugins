// A thread's side chats, kept current, and what can be done to one. Shared by
// the header control and the panel, so both show the same list and act the
// same way.
import { useCallback, useEffect, useRef, useState } from "react";
import { useBbNavigate, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { EnvironmentChoice, rpcContract, SideChatSummary } from "@/lib/contract";
import { oneLine, SIDE_CHATS_CHANGED } from "@/lib/promotion";

/** The `threadPanelAction` that lists side chats, or shows one. */
export const PANEL_ACTION = "side-chats";

/** How often to look again while an unread reply is showing. */
const UNREAD_POLL_MS = 20_000;

// Every list of one thread's side chats in this window, the header's and any
// panel's. Each is its own hook instance, so a change seen by one (a side chat
// read in the panel) reaches the others through here; the bundle shares module
// scope across them.
const listeners = new Map<string, Set<() => void>>();

/** Ask every list of `threadId`'s side chats in this window to refetch. */
export function announce(threadId: string): void {
  for (const listener of listeners.get(threadId) ?? []) listener();
}

const describe = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

export function useSideChats(threadId: string) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [sideChats, setSideChats] = useState<SideChatSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const refetch = useCallback(() => {
    rpc.call("listSideChats", { threadId }).then(
      (result) => {
        setSideChats(result.sideChats);
        setLoaded(true);
      },
      // Nothing to show is the safe failure: the header control stays away.
      () => {
        setSideChats([]);
        setLoaded(true);
      },
    );
  }, [rpc, threadId]);

  // Several changes land together (a reply finishing moves status and
  // attention at once), so they share one refetch.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const soon = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(refetch, 200);
  }, [refetch]);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  useEffect(refetch, [refetch]);

  useEffect(() => {
    const set = listeners.get(threadId) ?? new Set();
    set.add(soon);
    listeners.set(threadId, set);
    return () => {
      set.delete(soon);
      if (set.size === 0) listeners.delete(threadId);
    };
  }, [soon, threadId]);

  // The server announces side chats being opened, replying, or archived.
  useRealtime(SIDE_CHATS_CHANGED, (payload) => {
    if ((payload as { threadId?: unknown } | null)?.threadId === threadId) soon();
  });

  // Reading a side chat raises no event a plugin can hear, so an unread dot
  // is rechecked when the window regains focus and, while one shows, on a
  // slow poll. Opening the list refetches too (see `refetch` callers).
  useEffect(() => {
    window.addEventListener("focus", soon);
    return () => window.removeEventListener("focus", soon);
  }, [soon]);
  const anyUnread = sideChats.some((chat) => chat.state === "unread");
  useEffect(() => {
    if (!anyUnread) return;
    const poll = setInterval(refetch, UNREAD_POLL_MS);
    return () => clearInterval(poll);
  }, [anyUnread, refetch]);

  const act = useCallback(
    async (sideChatId: string, work: () => Promise<void>) => {
      setBusy(sideChatId);
      try {
        await work();
      } finally {
        setBusy(null);
        announce(threadId);
      }
    },
    [threadId],
  );

  const promote = useCallback(
    (sideChatThreadId: string, environment: EnvironmentChoice) =>
      act(sideChatThreadId, async () => {
        try {
          const promoted = await rpc.call("promoteSideChat", { sideChatThreadId, environment });
          for (const warning of promoted.warnings) toast.warning(warning);
          navigate.toThread(promoted.threadId);
        } catch (cause) {
          toast.error(`Couldn't promote the side chat: ${describe(cause)}`);
        }
      }),
    [act, navigate, rpc],
  );

  const archive = useCallback(
    (sideChatThreadId: string) =>
      act(sideChatThreadId, async () => {
        try {
          await rpc.call("archiveSideChat", { sideChatThreadId });
          toast.success("Side chat archived");
        } catch (cause) {
          toast.error(`Couldn't archive the side chat: ${describe(cause)}`);
        }
      }),
    [act, rpc],
  );

  const open = useCallback(
    (chat: SideChatSummary) => {
      const opened = navigate.openThreadPanel({
        actionId: PANEL_ACTION,
        title: oneLine(chat.preview, 28),
        params: { threadId: chat.id, anchor: chat.anchor },
      });
      if (!opened) toast.error("This view has no side panel to open the side chat in.");
    },
    [navigate],
  );

  return { sideChats, loaded, busy, promote, archive, open, refresh: soon };
}

/** "just now", "5m ago", "3h ago", "2d ago". */
export function age(updatedAt: number, now = Date.now()): string {
  const minutes = Math.floor((now - updatedAt) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
