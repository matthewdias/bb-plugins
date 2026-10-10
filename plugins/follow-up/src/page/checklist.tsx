// A checklist that has stopped to wait for you, on its thread's card.
//
// The checklist is Agent Checklists'; this shows where it stands and does what
// that plugin's own controls do, through its own calls (see lib/checklist.ts).
// What is shown is read in the background and can be a few minutes old, so
// the server reads it again before acting and says so if it has moved on.
import { useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "../../server";
import { checklistOffers, waitingLabel } from "../../lib/checklist.ts";
import type { Card } from "../../lib/page.ts";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

export function ChecklistCard({ card }: { card: Card }) {
  const rpc = useRpc<typeof rpcContract>();
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState("");
  const checklist = card.checklist;
  if (checklist === null) return null;
  const offers = checklistOffers(checklist.status);
  const verb = offers.action === "continue" ? "Continue" : "Resume";

  const act = async (withReply: boolean) => {
    setBusy(true);
    try {
      const text = reply.trim();
      const result = await rpc.call("page_checklist", {
        threadId: card.threadId,
        checklistId: checklist.id,
        action: offers.action,
        ...(withReply && text !== "" ? { reply: text } : {}),
      });
      if (result.outcome === "stale") toast.error("That checklist has moved on. Nothing was done.");
      else if (result.outcome === "unavailable") toast.error("Agent Checklists did not answer. Open the thread.");
      else if (result.outcome === "failed") toast.error("It did not go through. Open the thread to see why.");
    } catch {
      toast.error("It did not go through. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const percent = checklist.total === 0 ? 0 : Math.round((checklist.done / checklist.total) * 100);
  return (
    <section aria-label={`Checklist: ${checklist.name}`} className="flex min-w-0 flex-col gap-2">
      <p className="text-sm text-foreground">
        <span className="font-medium">{checklist.name}</span>{" "}
        <span className="text-muted-foreground">
          · {checklist.done} of {checklist.total} steps · {waitingLabel(checklist.status)}
        </span>
      </p>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={checklist.total}
        aria-valuenow={checklist.done}
        aria-label="Steps done"
        className="h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full rounded-full bg-amber-500" style={{ width: `${percent}%` }} />
      </div>
      {checklist.next !== null && (
        <p className="text-[13px] text-muted-foreground">
          Next: <span className="font-medium text-foreground">{checklist.next}</span>
        </p>
      )}
      {checklist.note !== null && (
        <blockquote className="whitespace-pre-wrap break-words border-l-2 border-amber-500/70 pl-2.5 text-[13px] text-foreground">
          {checklist.note}
          {checklist.noteCut && <span className="text-muted-foreground">… The rest is in the thread.</span>}
        </blockquote>
      )}
      {checklist.error !== null && <p className="text-xs text-destructive">Last try failed: {checklist.error}</p>}
      {offers.reply && (
        <textarea
          rows={2}
          value={reply}
          onChange={(event) => setReply(event.target.value)}
          placeholder="Your reply, sent to the thread before it resumes"
          aria-label="Reply to the thread"
          className="w-full resize-y rounded-md border border-dashed border-border bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:border-solid focus-visible:ring-1 focus-visible:ring-ring"
        />
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {offers.reply && (
          <Button size="sm" disabled={busy || reply.trim() === ""} onClick={() => void act(true)}>
            {busy && <Icon name="Spinner" className="animate-spin" aria-hidden />}
            Reply and resume
          </Button>
        )}
        <Button size="sm" variant={offers.reply ? "outline" : "default"} disabled={busy} onClick={() => void act(false)}>
          {verb}
        </Button>
      </div>
    </section>
  );
}
