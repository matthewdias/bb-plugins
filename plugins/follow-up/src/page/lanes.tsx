// The Follow Up page's two lanes beside the cards: what is running now, and
// every follow-up still open, archived threads included.
import { useState } from "react";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "../../server";
import { isBusy, type LaneGroup, type Running } from "../../lib/page.ts";
import { SEND_FAILED } from "../use-next-steps.ts";
import { ago, MessageBox } from "./cards.tsx";
import { LaneRow } from "./rows.tsx";
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
  // A family row for a parent that is not running itself: its workers are.
  const selfRunning = isBusy(row.status);
  return (
    <li className="border-t border-border py-1 first:border-t-0">
      <div className="flex items-center gap-1">
        {/* The whole row opens the thread: a phone has no room to aim at a
            truncated title, and the activity line is what you tapped for. */}
        <button
          type="button"
          aria-label={`Open ${row.title}`}
          onClick={() => navigate.toThread(row.threadId)}
          className="group flex min-h-11 min-w-0 flex-1 items-start gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <span
            aria-hidden
            className={cn(
              "mt-1.5 size-2 shrink-0 rounded-full",
              row.status === "pending" || !selfRunning
                ? "bg-muted-foreground/50"
                : "animate-pulse bg-emerald-500 motion-reduce:animate-none",
            )}
          />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex items-baseline gap-2">
              <span className="min-w-0 truncate text-[13px] font-medium text-foreground">{row.title}</span>
              {row.startedAt !== null && (
                <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">{ago(row.startedAt, now)}</span>
              )}
            </span>
            <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              <span className="min-w-0 break-words">{row.now}</span>
              {total > 0 && (
                <span>
                  · {row.openFollowUps} of {total} follow-ups open
                </span>
              )}
              {selfRunning && row.workers.length > 0 && (
                <span>· {row.workers.length === 1 ? "1 worker running" : `${row.workers.length} workers running`}</span>
              )}
            </span>
          </span>
          <Icon
            name="ArrowUpRight"
            aria-hidden
            className="mt-0.5 size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
          />
        </button>
        {selfRunning && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 text-muted-foreground"
            aria-expanded={open}
            aria-label={open ? "Hide actions" : "Show actions"}
            onClick={() => setOpen(!open)}
          >
            <Icon name="MoreHorizontal" className="size-4" />
          </Button>
        )}
      </div>
      {row.workers.length > 0 && (
        <ul aria-label="Workers running" className="ml-3 flex flex-col border-l-2 border-border pl-1">
          {row.workers.map((worker) => (
            <li key={worker.threadId}>
              <button
                type="button"
                aria-label={`Open ${worker.title}`}
                onClick={() => navigate.toThread(worker.threadId)}
                className="group flex min-h-10 w-full min-w-0 flex-col gap-0.5 rounded-md px-1.5 py-1 text-left text-xs hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <span className="flex w-full items-baseline gap-2">
                  <span className="size-1.5 shrink-0 self-center rounded-full bg-emerald-500" aria-hidden />
                  <span className="min-w-0 truncate font-medium text-foreground">{worker.title}</span>
                  {worker.startedAt !== null && (
                    <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">{ago(worker.startedAt, now)}</span>
                  )}
                </span>
                <span className="break-words pl-3.5 text-muted-foreground">{worker.now}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && selfRunning && (
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
        <LaneProject key={group.projectId} group={group} />
      ))}
    </section>
  );
}

/** Rows shown per project before the rest fold behind "Show N more". */
const ROWS_PER_PROJECT = 6;

/**
 * One project's rows, folded past the first few: a backlog of a hundred rows
 * is a list to dip into, not one to scroll past on the way to the next project.
 */
function LaneProject({ group }: { group: LaneGroup }) {
  const [all, setAll] = useState(false);
  let budget = all ? Number.POSITIVE_INFINITY : ROWS_PER_PROJECT;
  const shown: LaneGroup["threads"] = [];
  for (const thread of group.threads) {
    if (budget <= 0) break;
    const rows = thread.rows.slice(0, budget);
    budget -= rows.length;
    shown.push({ ...thread, rows });
  }
  const total = group.threads.reduce((sum, thread) => sum + thread.rows.length, 0);
  const hidden = total - shown.reduce((sum, thread) => sum + thread.rows.length, 0);
  return (
    <div className="mt-1.5 flex flex-col">
      <h3 className="flex items-baseline gap-1.5 text-xs font-semibold text-foreground">
        {group.projectName}
        <span className="font-normal text-muted-foreground">{total}</span>
      </h3>
      {shown.map((thread) => (
        <LaneThread key={thread.threadId} thread={thread} />
      ))}
      {(hidden > 0 || all) && total > ROWS_PER_PROJECT && (
        <button
          type="button"
          className="self-start py-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
          onClick={() => setAll(!all)}
        >
          {all ? "Show fewer" : `Show ${hidden} more`}
        </button>
      )}
    </div>
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
