// One open follow-up, with its own buttons, wherever the page lists it: the
// follow-ups lane, and beside a card's close-out actions — Merge, Archive —
// where what a thread would leave behind is part of the decision.
import { useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "../../server";
import type { LaneRow as LaneRowData } from "../../lib/page.ts";
import type { FollowUp, Reason } from "../../lib/followups.ts";
import { FileToMenuItems, useDestinations, useFile, useOpenDestinationSetup } from "../filing.tsx";
import { REFUSAL_DETAIL } from "../record-draft.ts";
import { SEND_FAILED } from "../use-next-steps.ts";
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

export function LaneRow({ threadId, row }: { threadId: string; row: LaneRowData }) {
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
function FileItems({ threadId, row }: { threadId: string; row: LaneRowData }) {
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

/** Rows shown before the rest fold behind "Show N more". */
const STILL_OPEN_SHOWN = 4;

/**
 * What a close-out would leave behind: a thread's open follow-ups, shown
 * beside Merge or Archive, each with its own buttons, so a row can be handed
 * off, filed or closed before the thread goes. Several threads' rows when a
 * family archives its merged workers.
 */
export function StillOpen({
  groups,
  note,
}: {
  groups: ReadonlyArray<{ threadId: string; title: string | null; rows: readonly LaneRowData[] }>;
  note: string;
}) {
  const [all, setAll] = useState(false);
  const total = groups.reduce((sum, group) => sum + group.rows.length, 0);
  if (total === 0) return null;
  let budget = all ? Number.POSITIVE_INFINITY : STILL_OPEN_SHOWN;
  const shown = groups.flatMap((group) => {
    if (budget <= 0 || group.rows.length === 0) return [];
    const rows = group.rows.slice(0, budget);
    budget -= rows.length;
    return [{ ...group, rows }];
  });
  return (
    <section aria-label="Still open" className="rounded-md border border-border bg-background/50 px-2.5 py-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Still open · {total}
      </h3>
      <p className="text-xs text-muted-foreground">{note}</p>
      {shown.map((group) => (
        <div key={group.threadId} className="mt-1 flex flex-col">
          {group.title !== null && <span className="truncate text-xs text-muted-foreground">{group.title}</span>}
          <ul className="flex flex-col">
            {group.rows.map((row) => (
              <LaneRow key={row.id} threadId={group.threadId} row={row} />
            ))}
          </ul>
        </div>
      ))}
      {total > STILL_OPEN_SHOWN && (
        <button
          type="button"
          className="py-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
          onClick={() => setAll(!all)}
        >
          {all ? "Show fewer" : `Show ${total - STILL_OPEN_SHOWN} more`}
        </button>
      )}
    </section>
  );
}
