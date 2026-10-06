// The thread header control: a side-chat icon with a count, present only when
// the thread has side chats with something in them, marked while one is
// replying or has an unread reply. It opens a list with what can be done to
// each: open it again, promote it, or archive it.
//
// It lives in the main thread's header because the side-chat panel belongs to
// bb's built-in plugin and takes no controls from others.
import { Fragment } from "react";
import { experimental_Icon as Icon, type PluginThreadHeaderActionProps } from "@get-bb/plugin-sdk/app";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { overallState, StateMark, STATE_LABEL } from "./state-mark.tsx";
import { age, useSideChats } from "./use-side-chats.ts";

export function SideChatsControl({ threadId, isCompactViewport }: PluginThreadHeaderActionProps) {
  const { sideChats, busy, promote, archive, open, refresh } = useSideChats(threadId);

  if (sideChats.length === 0) return null;
  const count = sideChats.length;
  const replying = sideChats.filter((chat) => chat.state === "working").length;
  const unread = sideChats.filter((chat) => chat.state === "unread").length;
  const label = [
    `Side chats: ${count}`,
    ...(replying > 0 ? [`${replying} replying`] : []),
    ...(unread > 0 ? [`${unread} with a new reply`] : []),
  ].join(", ");

  return (
    <DropdownMenu onOpenChange={(isOpen) => isOpen && refresh()}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          className={cn(
            "relative inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-muted-foreground",
            "hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "data-[state=open]:bg-accent data-[state=open]:text-foreground",
          )}
        >
          <Icon name="SideChat" className="size-4" aria-hidden />
          {isCompactViewport ? null : <span className="text-xs tabular-nums">{count}</span>}
          <StateMark state={overallState(sideChats.map((chat) => chat.state))} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>Side chats</DropdownMenuLabel>
        {sideChats.map((chat, index) => {
          const status = STATE_LABEL[chat.state];
          const disabled = busy !== null;
          return (
            <Fragment key={chat.id}>
              {index > 0 ? <DropdownMenuSeparator /> : null}
              <div className="flex items-center gap-2 px-2 pt-1.5 pb-0.5 text-sm">
                <StateMark state={chat.state} />
                <span className="min-w-0 flex-1 truncate" title={chat.preview}>
                  {chat.preview}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {status ?? age(chat.updatedAt)}
                </span>
              </div>
              <DropdownMenuItem disabled={disabled} onSelect={() => open(chat)}>
                <Icon name="SideChat" className="size-4" aria-hidden />
                Open
              </DropdownMenuItem>
              <DropdownMenuItem disabled={disabled} onSelect={() => void promote(chat.id, "shared")}>
                <Icon name="ArrowUpRight" fallback="SideChat" className="size-4" aria-hidden />
                {busy === chat.id ? "Working…" : "Promote to thread"}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={disabled} onSelect={() => void promote(chat.id, "worktree")}>
                <Icon name="GitBranch" fallback="SideChat" className="size-4" aria-hidden />
                Promote into new worktree
              </DropdownMenuItem>
              <DropdownMenuItem disabled={disabled} onSelect={() => void archive(chat.id)}>
                <Icon name="Archive" fallback="SideChat" className="size-4" aria-hidden />
                Archive
              </DropdownMenuItem>
            </Fragment>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
