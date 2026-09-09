// The compose view: where a follow-up becomes a thread.
//
// It renders bb's own new-thread composer rather than anything of ours, which
// is what let the hand-rolled skill picker be deleted. `/` in this draft reaches
// every skill the project can invoke, through the host's menu, and the model and
// permission pickers come along for free — the old quick path spawned with none
// of them, so every handoff silently took the project defaults.
//
// `layout="document"` and the spacer below the composer are not cosmetic. The
// `/` menu lays out *below* the prompt box, and `layout="contained"` renders
// `justify-end`, pinning the box to the bottom of its container with nothing
// underneath — which clipped the skills list. The composer needs room below it
// or the picker is unusable.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  experimental_NewThreadComposer as NewThreadComposer,
  useBbNavigate,
  useRpc,
  type NewThreadRequest,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import type { FollowUp } from "../lib/followups.ts";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

/**
 * The two destinations, and what each does to the row.
 *
 * `note` is rendered, not hidden in a tooltip: the difference between them is a
 * disposition — whether this thread still owns the work — and that is the actual
 * choice being made, not a detail about it.
 *
 * There is deliberately no "fill this composer" target. Handoff means sending a
 * row elsewhere; putting one into *this* thread's composer is the row's own
 * insert action, which does it better — a mention pill resolves the whole record
 * at send time and marks the row in progress, where a pasted string did neither.
 */
const TARGETS = [
  {
    id: "child" as const,
    label: "Child thread",
    note: "Still ours — in progress",
    hint: "Starts a thread under this one. A parent still owns work it delegated.",
  },
  {
    id: "thread" as const,
    label: "New thread",
    note: "Not ours — marked done",
    hint: "Starts an independent thread. The row is done, with the destination in its note.",
  },
];

/** The row id this tab was opened for. */
function idFrom(params: unknown): string | null {
  if (typeof params !== "object" || params === null) return null;
  const value = (params as { id?: unknown }).id;
  return typeof value === "string" && value.length > 0 ? value : null;
}

type Seed = {
  /** Null in fresh-start mode: this tab was opened with no row to hand off. */
  row: FollowUp | null;
  projectId: string;
  environmentId: string | null;
  prompt: string;
};

export function HandoffPanel({
  threadId,
  params,
}: {
  threadId: string;
  params: unknown;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const id = idFrom(params);
  const [seed, setSeed] = useState<Seed | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // `target` is null when nothing was handed off — the fresh-start send, which
  // has no row and so no disposition to report.
  const [sent, setSent] = useState<{
    threadId: string | null;
    target: string | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  // The target is chosen before submitting, because the composer owns its own
  // submit button — there is no way to put two of them in its action row.
  const [target, setTarget] = useState<"child" | "thread">("child");
  const rpcRef = useRef(rpc);
  rpcRef.current = rpc;
  // Generation guard rather than a per-effect flag, so the "hand off again"
  // path gets the same protection as the mount load without repeating it.
  const generation = useRef(0);

  const load = useCallback(async () => {
    const mine = ++generation.current;
    try {
      const result = await rpcRef.current.call("followups_handoff_seed", {
        threadId,
        // Omitted in fresh-start mode. The project and environment are still
        // wanted — they are what puts the new thread in this checkout — so this
        // is the same round trip with nothing to look up.
        ...(id === null ? {} : { id }),
      });
      if (generation.current !== mine) return;
      // Two different nulls, and collapsing them would be the bug: a row that
      // has gone is an error to report, while no row having been asked for is
      // this tab's other mode.
      if (id !== null && result.row === null) {
        setProblem("That follow-up is no longer here.");
        return;
      }
      setSeed({
        row: result.row,
        projectId: result.projectId,
        environmentId: result.environmentId,
        prompt: result.prompt,
      });
    } catch {
      if (generation.current === mine) {
        setProblem(
          id === null
            ? "Could not read this thread."
            : "Could not read that follow-up.",
        );
      }
    }
  }, [threadId, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = useCallback(
    async (request: NewThreadRequest) => {
      setBusy(true);
      setProblem(null);
      try {
        // Fresh start: the same spawn with no row attached, and so none of the
        // bookkeeping a handoff does. It goes through its own RPC rather than a
        // flag on this one because every other branch of `followups_handoff` is
        // about the row it cannot find here.
        if (id === null) {
          const started = await rpcRef.current.call("followups_start_thread", {
            threadId,
            request: request as unknown as Record<string, unknown> & {
              projectId: string;
            },
          });
          if (started.outcome === "spawned") {
            setSent({ threadId: started.spawnedThreadId, target: null });
            setSeed(null);
            setProblem(null);
            return;
          }
          setProblem("The thread could not be started.");
          // Thrown, not swallowed: the composer keeps the draft when `onSubmit`
          // rejects, so a failed send does not lose what was written.
          throw new Error(started.outcome);
        }
        const result = await rpcRef.current.call("followups_handoff", {
          threadId,
          id,
          target,
          // Cast, not validated: `NewThreadRequest` is the host's contract and
          // the RPC forwards it whole. Modelling it field by field here would
          // mean re-declaring a shape this plugin does not own, and failing
          // closed the next time the host adds a field to it.
          request: request as unknown as Record<string, unknown> & {
            projectId: string;
          },
        });
        if (result.outcome === "spawned") {
          // Clear everything the compose step was holding. The panel cannot
          // close its own tab — `threadPanelAction` has no close in its props
          // and `ExperimentalAppPanel` only opens — so the tab outlives the
          // send, and anything left standing here is stale by definition: the
          // seed describes a row that has just changed state, and re-opening
          // this row's handoff focuses this same tab rather than remounting it.
          setSent({ threadId: result.spawnedThreadId, target });
          setSeed(null);
          setProblem(null);
          setTarget("child");
          return;
        }
        setProblem(
          result.outcome === "not-found"
            ? "That follow-up is no longer here."
            : "The thread could not be started.",
        );
        // Thrown, not swallowed: the composer keeps the draft when `onSubmit`
        // rejects, so a failed handoff does not lose what was written.
        throw new Error(result.outcome);
      } finally {
        setBusy(false);
      }
    },
    [threadId, id, target],
  );

  if (problem !== null && seed === null) {
    return <Empty>{problem}</Empty>;
  }
  if (sent !== null) {
    return (
      <div className="flex flex-col items-start gap-2 p-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Icon name="Sent" className="size-3.5" aria-hidden />
          {sent.target === null ? "Started" : "Handed off"}
          {sent.threadId === null ? "" : ` ${sent.threadId}`}
          {sent.target === "child" ? " as a child of this thread" : ""}.
        </span>
        {/* Not a dead end. The tab cannot close itself, so it offers the two
            things worth doing next instead of sitting on a stale receipt. */}
        <span className="flex items-center gap-1">
          {sent.threadId !== null && (
            <Button
              variant="secondary"
              size="sm"
              className="h-auto px-2 py-1 text-xs"
              onClick={() => {
                if (sent.threadId !== null) navigate.toThread(sent.threadId);
              }}
            >
              Open thread
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-auto px-2 py-1 text-xs"
            onClick={() => {
              setSent(null);
              void load();
            }}
          >
            {sent.target === null ? "Start another" : "Hand off again"}
          </Button>
        </span>
      </div>
    );
  }
  if (seed === null) {
    return <Empty>Loading…</Empty>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border px-3 py-2">
        <p className="text-xs font-medium">
          {seed.row === null ? "New thread from this one" : seed.row.text}
        </p>
        {seed.row === null ? (
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Starts on its own, in this project and checkout.
          </p>
        ) : (
          seed.row.file !== null && (
            <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
              {seed.row.file}
            </p>
          )
        )}
        {/* No picker without a row. Both of its notes — "Still ours — in
            progress", "Not ours — marked done" — describe what the send does to
            a follow-up, and there is no follow-up here; the choice they offer is
            not being made. Fresh starts go out unparented: a child says this
            thread still owns the work, and this button is offered precisely
            because it has nothing left to own. */}
        {seed.row !== null && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <span className="mr-1 text-[11px] text-muted-foreground">Send as</span>
          {TARGETS.map((entry) => (
            <span key={entry.id} title={entry.hint} className="inline-flex">
              <Button
                variant={target === entry.id ? "secondary" : "ghost"}
                size="sm"
                className="h-auto gap-1.5 px-2 py-1 text-xs"
                aria-pressed={target === entry.id}
                disabled={busy}
                onClick={() => setTarget(entry.id)}
              >
                <Icon
                  name="Check"
                  className={
                    target === entry.id
                      ? "size-3 text-foreground"
                      : "size-3 text-transparent"
                  }
                  aria-hidden
                />
                {entry.label}
                <span className="text-[11px] font-normal text-muted-foreground">
                  {entry.note}
                </span>
              </Button>
            </span>
          ))}
        </div>
        )}
        {problem !== null && (
          <p className="mt-1 text-[11px] text-destructive">{problem}</p>
        )}
      </div>
      {/* Scrolls, and the composer is not bottom-pinned, so the `/` menu has
          somewhere to open. See the note at the top of this file. */}
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <NewThreadComposer
          defaultProjectId={seed.projectId}
          {...(seed.environmentId === null
            ? {}
            : {
                // Default to the checkout the row is actually about, which is
                // what the old quick path always did. A seed, not a lock — the
                // composer's environment picker can still be changed.
                defaultEnvironment: {
                  type: "reuse",
                  environmentId: seed.environmentId,
                },
              })}
          initialPrompt={seed.prompt}
          placeholder={
            seed.row === null ? "Start something new…" : "Hand this off…"
          }
          layout="document"
          // Per row, so two handoffs composed at once never share a draft, and
          // a half-written one survives a reload. Fresh starts get their own
          // key for the same reason: one half-written new thread per thread,
          // kept apart from any row's draft.
          draftKey={`handoff:${threadId}:${id ?? "new"}`}
          onSubmit={submit}
        />
        <div className="h-[50vh]" aria-hidden />
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="p-3 text-xs text-muted-foreground">{children}</div>
  );
}
