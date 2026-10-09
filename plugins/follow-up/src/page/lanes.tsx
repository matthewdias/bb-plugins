// The Follow Up page's two lanes beside the cards: what is running now, and
// every follow-up still open, archived threads included.
import { useState } from "react";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "../../server";
import type { LaneGroup, Running } from "../../lib/page.ts";
import type { FollowUp, Reason } from "../../lib/followups.ts";
import { FileToMenuItems, useDestinations, useFile, useOpenDestinationSetup } from "../filing.tsx";
import { REFUSAL_DETAIL } from "../record-draft.ts";
import { SEND_FAILED } from "../use-next-steps.ts";
import { ago, MessageBox } from "./cards.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

function LaneHeading({ title, detail }: { title: string; detail: string }) {
  return (
    <h2 className="flex items-baseline gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      {title}
      <span className="font-normal normal-case tracking-normal">· {detail}</span>
    </h2>
  );
}

// --- in motion ---------------------------------------------------------------

export function InMotion({ running, now }: { running: Running[]; now: number }) {
  return (
    <section aria-label="In motion" className="flex flex-col gap-1 rounded-lg border border-border bg-card p-3">
      <LaneHeading title="In motion" detail={String(running.length)} />
      {running.length === 0 ? (
        <p className="py-1 text-xs text-muted-foreground">Nothing is running.</p>
      ) : (
        <ul className="flex flex-col">
          {running.map((row) => (
            <RunningRow key={row.threadId} row={row} now={now} />
          ))}
        </ul>
      )}
    </section>
  );
}

function RunningRow({ row, now }: { row: Running; now: number }) {
  const navigate = useBbNavigate();
  const rpc = useRpc<typeof rpcContract>();
  const [open, setOpen] = useState(false);
  const [queueing, setQueueing] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);

  const queue = async (text: string): Promise<boolean> => {
    try {
      const result = await rpc.call("page_reply", { threadId: row.threadId, text });
      if (result.outcome === "failed") {
        toast.error(SEND_FAILED);
        return false;
      }
      toast(result.outcome === "queued" ? "Queued behind the current turn." : "Sent.");
      return true;
    } catch {
      toast.error(SEND_FAILED);
      return false;
    }
  };
  const stop = async () => {
    setConfirmStop(false);
    try {
      const result = await rpc.call("page_stop", { threadId: row.threadId });
      if (result.outcome === "failed") toast.error("It could not be stopped. Open the thread.");
    } catch {
      toast.error("It could not be stopped. Open the thread.");
    }
  };

  const total = row.openFollowUps + row.doneFollowUps;
  return (
    <li className="border-t border-border py-2 first:border-t-0">
      <div className="flex items-start gap-2">
        <span
          aria-hidden
          className={cn(
            "mt-1.5 size-2 shrink-0 rounded-full",
            row.status === "pending" ? "bg-muted-foreground/50" : "animate-pulse bg-emerald-500 motion-reduce:animate-none",
          )}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-baseline gap-2">
            <button
              type="button"
              className="min-w-0 truncate text-left text-[13px] font-medium text-foreground hover:underline"
              onClick={() => navigate.toThread(row.threadId)}
            >
              {row.title}
            </button>
            {row.startedAt !== null && (
              <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">{ago(row.startedAt, now)}</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <span className="min-w-0 break-words">{row.now}</span>
            {total > 0 && (
              <span>
                · {row.openFollowUps} of {total} follow-ups open
              </span>
            )}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-6 shrink-0 text-muted-foreground"
          aria-expanded={open}
          aria-label={open ? "Hide actions" : "Show actions"}
          onClick={() => setOpen(!open)}
        >
          <Icon name={open ? "ChevronUp" : "ChevronDown"} className="size-3.5" />
        </Button>
      </div>
      {open && (
        <div className="mt-2 pl-4">
          {queueing ? (
            <MessageBox
              initial=""
              placeholder="Runs after the current turn…"
              sendLabel="Queue"
              onSend={queue}
              onCancel={() => setQueueing(false)}
            />
          ) : confirmStop ? (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">Stop this turn?</span>
              <Button size="sm" variant="destructive" onClick={() => void stop()}>
                Stop
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmStop(false)}>
                Keep going
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" variant="outline" onClick={() => setQueueing(true)}>
                Queue a message
              </Button>
              <Button size="sm" variant="outline" className="text-destructive" onClick={() => setConfirmStop(true)}>
                <Icon name="Square" aria-hidden />
                Stop
              </Button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

// --- follow-ups --------------------------------------------------------------

const REASON_LABEL: Record<Reason, string> = {
  "out-of-scope": "out of scope",
  blocked: "blocked",
  deferred: "deferred",
  risk: "risk",
  cleanup: "cleanup",
};

const REASON_TONE: Record<Reason, string> = {
  "out-of-scope": "text-violet-600 bg-violet-500/10 dark:text-violet-400",
  blocked: "text-amber-600 bg-amber-500/10 dark:text-amber-400",
  deferred: "text-sky-600 bg-sky-500/10 dark:text-sky-400",
  risk: "text-destructive bg-destructive/10",
  cleanup: "text-muted-foreground bg-muted",
};

export function FollowUpsLane({ groups }: { groups: LaneGroup[] }) {
  const threads = groups.reduce((sum, group) => sum + group.threads.length, 0);
  const rows = groups.reduce(
    (sum, group) => sum + group.threads.reduce((inner, thread) => inner + thread.rows.length, 0),
    0,
  );
  return (
    <section aria-label="Follow-ups" className="flex flex-col gap-1 rounded-lg border border-border bg-card p-3">
      <LaneHeading
        title="Follow-ups"
        detail={rows === 0 ? "none open" : `${rows} open in ${threads} ${threads === 1 ? "thread" : "threads"}`}
      />
      {groups.map((group) => (
        <div key={group.projectId} className="mt-1.5 flex flex-col">
          <h3 className="text-xs font-semibold text-foreground">{group.projectName}</h3>
          {group.threads.map((thread) => (
            <LaneThread key={thread.threadId} thread={thread} />
          ))}
        </div>
      ))}
    </section>
  );
}

function LaneThread({ thread }: { thread: LaneGroup["threads"][number] }) {
  const navigate = useBbNavigate();
  return (
    <div className="mt-1 flex flex-col">
      <button
        type="button"
        className="flex min-w-0 items-center gap-1.5 text-left text-xs text-muted-foreground hover:text-foreground"
        onClick={() => navigate.toThread(thread.threadId)}
      >
        <span className="truncate">{thread.title}</span>
        {thread.archived && (
          <span className="shrink-0 rounded bg-muted px-1 text-[10px] uppercase tracking-wide">archived</span>
        )}
      </button>
      <ul className="flex flex-col">
        {thread.rows.map((row) => (
          <LaneRow key={row.id} threadId={thread.threadId} row={row} />
        ))}
      </ul>
    </div>
  );
}

function LaneRow({ threadId, row }: { threadId: string; row: LaneGroup["threads"][number]["rows"][number] }) {
  const rpc = useRpc<typeof rpcContract>();
  const [busy, setBusy] = useState(false);

  const lead = async () => {
    setBusy(true);
    try {
      if (row.lead === "handoff") {
        const result = await rpc.call("page_handoff", { threadId, id: row.id });
        if (result.outcome === "spawned") toast.success("Handed off to a new thread.");
        else if (result.outcome === "no-environment") toast.error("That thread's checkout is gone, so there is nowhere to hand it off from.");
        else toast.error("It could not be handed off. Try again.");
      } else {
        const result = await rpc.call("followups_next_do", { threadId, id: row.id });
        if (result.outcome === "queued") toast("Queued behind the current turn.");
        else if (result.outcome === "gone") toast.error("That follow-up is no longer open.");
        else if (result.outcome === "failed") toast.error(SEND_FAILED);
      }
    } catch {
      toast.error(row.lead === "handoff" ? "It could not be handed off. Try again." : SEND_FAILED);
    } finally {
      setBusy(false);
    }
  };
  const close = async (how: "done" | "dismiss") => {
    setBusy(true);
    try {
      if (how === "done") await rpc.call("followups_done", { threadId, id: row.id, done: true });
      else await rpc.call("followups_dismiss", { threadId, id: row.id });
    } catch {
      toast.error(REFUSAL_DETAIL.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="group flex items-start gap-2 border-t border-border/60 py-1.5 first:border-t-0">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="break-words text-[13px] leading-snug text-foreground">{row.text}</span>
        <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          {row.reason !== null && (
            <span className={cn("rounded px-1 text-[10px] font-semibold uppercase tracking-wide", REASON_TONE[row.reason])}>
              {REASON_LABEL[row.reason]}
            </span>
          )}
          {row.inProgress && <span>in progress</span>}
        </span>
      </div>
      <Button size="sm" variant="outline" className="h-7 shrink-0 px-2 text-xs" disabled={busy} onClick={() => void lead()}>
        {row.lead === "handoff" ? "Hand off" : "Do"}
      </Button>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-7 shrink-0 text-muted-foreground" disabled={busy} aria-label={`More for "${row.text}"`}>
            <Icon name="MoreHorizontal" className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-w-[min(20rem,calc(100vw-2rem))]">
          <FileItems threadId={threadId} row={row} />
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void close("done")}>
            <Icon name="Check" className="size-3.5" aria-hidden />
            Mark done
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void close("dismiss")}>
            <Icon name="X" className="size-3.5" aria-hidden />
            Dismiss
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

/**
 * The thread's "File to …" items, mounted only while the menu is open, so a
 * long lane does not fetch every thread's destinations up front.
 */
function FileItems({ threadId, row }: { threadId: string; row: LaneGroup["threads"][number]["rows"][number] }) {
  const state = useDestinations(threadId);
  const file = useFile(threadId);
  const setUp = useOpenDestinationSetup();
  // The menu needs a row to check it is not already filing; the lane's row is
  // never mid-filing, or it would not be listed as open.
  const asRow: FollowUp = {
    id: row.id,
    text: row.text,
    reason: row.reason,
    file: null,
    detail: null,
    createdAt: "",
  };
  return <FileToMenuItems row={asRow} state={state} onFile={(destinationId) => void file([row.id], destinationId)} onSetUp={setUp} />;
}
