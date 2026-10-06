// The queue, above every tab: what is waiting to install or update, a button
// to run it all, and a list to review it and take things back off. Nothing
// queued, nothing drawn.
import { useState } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Job } from "../lib/queue";
import { haptic } from "./haptics";
import { triageStore, type QueueState, type TriageRpc } from "./triage-store";

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** "2 to install, 1 to update, 1 to remove". */
export function queueSummary(jobs: readonly Job[]): string {
  const count = (kind: Job["kind"]) => jobs.filter((job) => job.kind === kind).length;
  return (
    [
      [count("install"), "to install"],
      [count("update"), "to update"],
      [count("remove"), "to remove"],
    ] as const
  )
    .filter(([n]) => n > 0)
    .map(([n, what]) => `${n} ${what}`)
    .join(", ");
}

const DOING: Record<Job["kind"], string> = { install: "Installing", update: "Updating", remove: "Removing" };

export function QueueBar({ rpc, queue }: { rpc: TriageRpc; queue: QueueState }) {
  const [open, setOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  if (queue.jobs.length === 0) return null;
  const current = queue.jobs.find((job) => job.state === "running");

  async function start() {
    setStarting(true);
    try {
      const { started } = await rpc.call("queue_start", {});
      if (started > 0) haptic("impact-medium");
    } catch (cause) {
      toast.error(`Couldn't start: ${message(cause)}`);
    } finally {
      setStarting(false);
    }
  }

  async function remove(job: Job) {
    try {
      const { removed, reason } = await rpc.call("unqueue", { key: job.key });
      if (!removed) {
        haptic("warning");
        toast(reason ?? "That can't be taken off now.");
        return;
      }
      haptic("impact-light");
      void triageStore.load(rpc);
    } catch (cause) {
      toast.error(`Couldn't take it off: ${message(cause)}`);
    }
  }

  return (
    <div className="mx-auto w-full max-w-md shrink-0 rounded-xl border border-border bg-card" role="status" aria-label="Queue">
      <div className="flex items-center gap-3 px-3 py-2">
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          <p className="text-sm font-medium">
            {queue.running
              ? current
                ? `${DOING[current.kind]} ${current.displayName}…`
                : "Starting…"
              : queueSummary(queue.jobs)}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {queue.running
              ? `${queue.jobs.length} to go · keeps going if you close bb`
              : open
                ? "Hide the list"
                : `${queue.jobs.map((job) => job.displayName).join(", ")} · review`}
          </p>
        </button>
        {!queue.running && (
          <Button size="sm" onClick={() => void start()} disabled={starting}>
            Run all
          </Button>
        )}
      </div>
      {open && (
        <ul className="divide-y divide-border border-t border-border">
          {queue.jobs.map((job) => (
            <li key={job.id} className="flex items-center gap-3 px-3 py-1.5">
              <span
                className={cn(
                  "w-14 shrink-0 text-[11px] text-muted-foreground",
                  job.state === "running" && "text-foreground",
                )}
              >
                {job.state === "running" ? "now" : job.kind}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">{job.displayName}</span>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => void remove(job)}
                disabled={job.state === "running"}
                aria-label={`Take ${job.displayName} off the queue`}
              >
                <Icon name="X" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
