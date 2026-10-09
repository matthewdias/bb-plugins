// Approvals answered on their cards: a command, a file change, a permission,
// a tool, a plan.
//
// Each card shows what bb's own approval card shows, offers the choices the
// approval offers, in bb's words, and answers through page_approve, which
// resolves it exactly as bb's card would. Nothing is folded away beside a
// choice that allows it: the whole command, every file's diff, the whole
// plan. One the card can't show whole is held for the thread (see `held` in
// lib/page.ts) and never reaches this form. Click only: no key answers an
// approval, here or in Focus, for the same reason.
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

export function ApprovalForm({ card, ask }: { card: Card; ask: Approval }) {
  const rpc = useRpc<typeof rpcContract>();
  const [busy, setBusy] = useState(false);

  const answer = async (decision: Decision) => {
    setBusy(true);
    try {
      const result = await rpc.call("page_approve", {
        threadId: card.threadId,
        interactionId: ask.interactionId,
        decision,
      });
      if (result.outcome === "stale") toast.error("That approval was already answered, or withdrawn.");
      else if (result.outcome === "refused") toast.error("That choice isn't on offer any more. Open the thread.");
      else if (result.outcome === "failed") toast.error("The answer did not go through. Try again.");
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
      {ask.reason !== null && <p className="text-xs text-muted-foreground">The agent says: “{ask.reason}”</p>}
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
      {/* bb's rejection tells the agent to ask what to change; that question
          is where you say it, on its own card. */}
      {ask.subject === "plan" && ask.decisions.includes("deny") && (
        <p className="text-xs text-muted-foreground">Keep planning: the agent asks what to change, and the question comes here.</p>
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
          {/* Which tool runs comes first, by name; its title only describes it. */}
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-medium text-foreground">{detail.tool}</span>
            {detail.title !== null && detail.title !== detail.tool && (
              <span className="text-sm text-foreground">{detail.title}</span>
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

/** Every file open: what Allow allows is on the card, not behind a click. You can close one you've read. */
function FileChange({ detail }: { detail: Extract<Approval["detail"], { kind: "file_change" }> }) {
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const toggle = (path: string) => {
    const next = new Set(closed);
    if (!next.delete(path)) next.add(path);
    setClosed(next);
  };
  return (
    <div className="flex flex-col gap-1">
      {detail.files.map((file) => {
        const open = !closed.has(file.path);
        return (
          <div key={file.path} className="overflow-hidden rounded-md border border-border">
            <button
              type="button"
              aria-expanded={open}
              onClick={() => toggle(file.path)}
              className="flex w-full items-center gap-2 bg-muted/50 px-2.5 py-1 text-left text-xs hover:bg-state-hover"
            >
              <Icon name={open ? "ChevronDown" : "ChevronRight"} className="size-3 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 break-all font-mono text-foreground">
                {file.path}
                {file.movedTo !== null && <> → {file.movedTo}</>}
              </span>
              <span className="shrink-0 text-muted-foreground">{file.movedTo !== null ? "move" : file.change}</span>
            </button>
            {open && file.patch !== "" && (
              <div className="max-h-80 overflow-auto">
                <Diff patch={file.patch} path={file.path} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** The whole plan, never folded: Approve plan approves all of it. */
function Plan({ plan, path }: { plan: string; path: string | null }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
        <Markdown content={plan} />
      </div>
      {path !== null && <span className="font-mono text-xs text-muted-foreground">{path}</span>}
    </div>
  );
}
