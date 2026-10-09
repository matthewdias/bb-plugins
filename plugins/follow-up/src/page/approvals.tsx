// Approvals answered on their cards: a command, a file change, a permission,
// a tool, a plan.
//
// Each card shows what bb's own approval card shows, offers the choices the
// approval offers, in bb's words, and answers through page_approve, which
// resolves it exactly as bb's card would. Click only: no key answers an
// approval, here or in Focus, because the whole of what it allows has to be
// on screen when it is answered.
import { useState } from "react";
import { experimental_Diff as Diff, Markdown, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "../../server";
import type { Card, Decision, Grant, PendingAsk } from "../../lib/page.ts";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

type Approval = Extract<PendingAsk, { kind: "approval" }>;

/** bb's own words for each choice: a plan's are its own. */
export function decisionLabel(decision: Decision, subject: Approval["subject"]): string {
  if (subject === "plan") return decision === "deny" ? "Keep planning" : "Approve plan";
  switch (decision) {
    case "allow_once":
      return "Allow once";
    case "allow_for_session":
      return "Allow for session";
    case "deny":
      return "Deny";
  }
}

/** Lines past which a plan folds behind "Show whole plan". */
const PLAN_FOLD_LINES = 14;

export function ApprovalForm({ card, ask }: { card: Card; ask: Approval }) {
  const rpc = useRpc<typeof rpcContract>();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const answer = async (decision: Decision) => {
    setBusy(true);
    try {
      const trimmed = note.trim();
      const result = await rpc.call("page_approve", {
        threadId: card.threadId,
        interactionId: ask.interactionId,
        decision,
        ...(ask.subject === "plan" && decision === "deny" && trimmed !== "" ? { note: trimmed } : {}),
      });
      if (result.outcome === "stale") toast.error("That approval was already answered, or withdrawn.");
      else if (result.outcome === "refused") toast.error("That choice isn't on offer any more. Open the thread.");
      else if (result.outcome === "failed") toast.error("The answer did not go through. Try again.");
      else if (result.noted === "failed") toast.error("Kept planning, but your note did not go. Send it in the thread.");
    } catch {
      toast.error("The answer did not go through. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const detail = ask.detail;
  const sessionGrant =
    ask.decisions.includes("allow_for_session") && (detail.kind === "command" || detail.kind === "file_change")
      ? detail.sessionGrant
      : null;

  return (
    <div className="flex flex-col gap-2">
      {ask.unseen && (
        <p role="alert" className="flex items-start gap-1.5 rounded-md border border-destructive/60 bg-destructive/5 px-2.5 py-1.5 text-xs text-destructive">
          <Icon name="AlertTriangle" className="mt-px size-3.5 shrink-0" aria-hidden />
          This holds characters that don't show, marked ⟦U+…⟧. What runs may not be what it seems to say.
        </p>
      )}
      <ApprovalDetail ask={ask} />
      {ask.reason !== null && <p className="text-xs text-muted-foreground">“{ask.reason}”</p>}
      {ask.subject === "plan" && ask.decisions.includes("deny") && (
        <textarea
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Optional: what to change, sent with Keep planning"
          aria-label="Note for Keep planning"
          className="w-full resize-y rounded-md border border-dashed border-border bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:border-solid focus-visible:ring-1 focus-visible:ring-ring"
        />
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {ask.decisions.map((decision) => (
          <Button
            key={decision}
            size="sm"
            variant={decision === "allow_once" ? "default" : "outline"}
            className={cn(decision === "deny" && ask.subject !== "plan" && "text-destructive")}
            disabled={busy}
            onClick={() => void answer(decision)}
          >
            {busy && decision === "allow_once" && <Icon name="Spinner" className="animate-spin" aria-hidden />}
            {decisionLabel(decision, ask.subject)}
          </Button>
        ))}
      </div>
      {sessionGrant !== null && (
        <p className="text-xs text-muted-foreground">For session also allows: {grantText(sessionGrant)}</p>
      )}
    </div>
  );
}

/** "reads /repo, writes /repo/out, network", or "nothing more" for an empty grant. */
export function grantText(grant: Grant): string {
  const parts = [
    grant.read.length > 0 ? `reads ${grant.read.join(", ")}` : null,
    grant.write.length > 0 ? `writes ${grant.write.join(", ")}` : null,
    grant.network ? "network" : null,
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? "nothing more" : parts.join("; ");
}

function ApprovalDetail({ ask }: { ask: Approval }) {
  const detail = ask.detail;
  switch (detail.kind) {
    case "command":
      return (
        <div className="flex flex-col gap-1">
          <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/50 px-2.5 py-1.5 font-mono text-xs text-foreground">
            <span className="select-none text-muted-foreground">$ </span>
            {detail.command}
          </pre>
          {(detail.cwd !== null || detail.actions.length > 0) && (
            <p className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
              {detail.cwd !== null && (
                <span>
                  in <span className="font-mono">{detail.cwd}</span>
                </span>
              )}
              {detail.actions.map((action) => (
                <span key={action}>· {action}</span>
              ))}
            </p>
          )}
        </div>
      );
    case "file_change":
      return <FileChange detail={detail} />;
    case "permission_grant":
      return (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 rounded-md border border-border bg-muted/50 px-2.5 py-1.5 text-xs">
          {detail.toolName !== null && (
            <>
              <dt className="text-muted-foreground">For</dt>
              <dd className="font-mono text-foreground">{detail.toolName}</dd>
            </>
          )}
          <dt className="text-muted-foreground">Read</dt>
          <dd className="break-words font-mono text-foreground">{detail.asked.read.join(", ") || "nothing"}</dd>
          <dt className="text-muted-foreground">Write</dt>
          <dd className="break-words font-mono text-foreground">{detail.asked.write.join(", ") || "nothing"}</dd>
          <dt className="text-muted-foreground">Network</dt>
          <dd className="text-foreground">{detail.asked.network ? "yes" : "no"}</dd>
        </dl>
      );
    case "plan":
      return <Plan plan={detail.plan} path={detail.planFilePath} />;
    case "tool_use":
      return (
        <div
          className={cn(
            "flex flex-col gap-1 rounded-md border px-2.5 py-1.5 text-xs",
            detail.destructive ? "border-destructive/60 bg-destructive/5" : "border-border bg-muted/50",
          )}
        >
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-foreground">{detail.title ?? detail.tool}</span>
            {/* The title is the tool's own description of itself; which tool runs is the name. */}
            {detail.title !== null && detail.title !== detail.tool && (
              <span className="font-mono text-muted-foreground">{detail.tool}</span>
            )}
            {detail.badge !== null && (
              <span className={cn("rounded px-1 text-[10px] font-semibold uppercase tracking-wide", detail.destructive ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")}>
                {detail.badge}
              </span>
            )}
          </span>
          {detail.detail !== null && (
            <pre className="whitespace-pre-wrap break-words font-mono text-foreground">{detail.detail}</pre>
          )}
        </div>
      );
  }
}

function FileChange({ detail }: { detail: Extract<Approval["detail"], { kind: "file_change" }> }) {
  const [open, setOpen] = useState<string | null>(detail.files[0]?.path ?? null);
  if (detail.files.length === 0) {
    return (
      <p className="rounded-md border border-border bg-muted/50 px-2.5 py-1.5 text-xs text-muted-foreground">
        Writes {detail.writeScope === null ? "files" : <span className="font-mono">in {detail.writeScope}</span>}. The diff
        couldn't be read here; it's in the thread.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      {detail.files.map((file) => (
        <div key={file.path} className="overflow-hidden rounded-md border border-border">
          <button
            type="button"
            aria-expanded={open === file.path}
            onClick={() => setOpen(open === file.path ? null : file.path)}
            className="flex w-full items-center gap-2 bg-muted/50 px-2.5 py-1 text-left text-xs hover:bg-state-hover"
          >
            <Icon name={open === file.path ? "ChevronDown" : "ChevronRight"} className="size-3 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 truncate font-mono text-foreground">{file.path}</span>
            <span className="shrink-0 text-muted-foreground">{file.change}</span>
          </button>
          {open === file.path && (
            <div className="max-h-80 overflow-auto">
              <Diff patch={file.patch} path={file.path} />
              {file.cut && <p className="px-2.5 py-1 text-xs text-muted-foreground">The rest of this diff is in the thread.</p>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Plan({ plan, path }: { plan: string; path: string | null }) {
  const long = plan.split("\n").length > PLAN_FOLD_LINES;
  const [whole, setWhole] = useState(!long);
  return (
    <div className="flex flex-col gap-1">
      <div
        className={cn(
          "relative overflow-hidden rounded-md border border-border bg-muted/30 px-3 py-2 text-sm",
          !whole && "max-h-72",
        )}
      >
        <Markdown content={plan} />
        {!whole && <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-card to-transparent" />}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {long && (
          <button type="button" className="hover:text-foreground hover:underline" onClick={() => setWhole(!whole)}>
            {whole ? "Fold the plan" : "Show whole plan"}
          </button>
        )}
        {path !== null && <span className="font-mono">{path}</span>}
      </div>
    </div>
  );
}
