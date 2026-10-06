// The thread header control: a side-chat icon with a count, present only when
// the thread has side chats worth promoting, opening a list with two ways to
// promote each.
//
// It lives in the main thread's header because the side-chat panel belongs to
// bb's built-in plugin and takes no controls from others.
import { Fragment, useCallback, useEffect, useState } from "react";
import {
  experimental_Icon as Icon,
  useBbNavigate,
  useRealtime,
  useRpc,
  type PluginThreadHeaderActionProps,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { EnvironmentChoice, rpcContract, SideChatSummary } from "@/lib/contract";
import { SIDE_CHATS_CHANGED } from "@/lib/promotion";
import { cn } from "@/lib/utils";

/** "just now", "5m ago", "3h ago", "2d ago". */
export function age(updatedAt: number, now = Date.now()): string {
  const minutes = Math.floor((now - updatedAt) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function SideChatsControl({ threadId, isCompactViewport }: PluginThreadHeaderActionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [sideChats, setSideChats] = useState<SideChatSummary[]>([]);
  const [promoting, setPromoting] = useState<string | null>(null);

  const refetch = useCallback(() => {
    rpc.call("listSideChats", { threadId }).then(
      (result) => setSideChats(result.sideChats),
      // Nothing to show is the safe failure: the control simply stays away.
      () => setSideChats([]),
    );
  }, [rpc, threadId]);

  useEffect(refetch, [refetch]);
  useRealtime(SIDE_CHATS_CHANGED, (payload) => {
    if ((payload as { threadId?: unknown } | null)?.threadId === threadId) refetch();
  });

  const promote = useCallback(
    async (sideChatThreadId: string, environment: EnvironmentChoice) => {
      setPromoting(sideChatThreadId);
      try {
        const promoted = await rpc.call("promoteSideChat", { sideChatThreadId, environment });
        for (const warning of promoted.warnings) toast.warning(warning);
        navigate.toThread(promoted.threadId);
      } catch (cause) {
        toast.error(`Couldn't promote the side chat: ${cause instanceof Error ? cause.message : String(cause)}`);
      } finally {
        setPromoting(null);
        refetch();
      }
    },
    [navigate, refetch, rpc],
  );

  if (sideChats.length === 0) return null;
  const count = sideChats.length;
  const label = `Promote a side chat (${count} side chat${count === 1 ? "" : "s"})`;

  return (
    <DropdownMenu onOpenChange={(open) => open && refetch()}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          className={cn(
            "inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-muted-foreground",
            "hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "data-[state=open]:bg-accent data-[state=open]:text-foreground",
          )}
        >
          <Icon name="SideChat" className="size-4" aria-hidden />
          {isCompactViewport ? null : <span className="text-xs tabular-nums">{count}</span>}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>Promote a side chat to its own thread</DropdownMenuLabel>
        {sideChats.map((chat, index) => (
          <Fragment key={chat.id}>
            {index > 0 ? <DropdownMenuSeparator /> : null}
            <div className="flex items-baseline gap-2 px-2 pt-1.5 pb-0.5 text-sm">
              <span className="min-w-0 flex-1 truncate" title={chat.preview}>
                {chat.preview}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">{age(chat.updatedAt)}</span>
            </div>
            <DropdownMenuItem
              disabled={promoting !== null}
              onSelect={() => void promote(chat.id, "shared")}
            >
              <Icon name="ArrowUpRight" fallback="SideChat" className="size-4" aria-hidden />
              {promoting === chat.id ? "Promoting…" : "Promote"}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={promoting !== null}
              onSelect={() => void promote(chat.id, "worktree")}
            >
              <Icon name="GitBranch" fallback="SideChat" className="size-4" aria-hidden />
              Promote into new worktree
            </DropdownMenuItem>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
