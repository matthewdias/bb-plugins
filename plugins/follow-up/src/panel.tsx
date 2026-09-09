import { useCallback, useEffect, useRef, useState } from "react";
import {
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
  useSettings,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import {
  DETAIL_MAX,
  formatRollup,
  isInProgress,
  needsReview,
  isExpanding,
  TEXT_MAX,
  type FollowUp,
} from "../lib/followups.ts";
import { FollowUpSortable, useSortableRow } from "./sortable.tsx";
import { ComposerInsert, ComposerInsertedMark } from "./composer-insert.tsx";
import { HandoffAction } from "./handoff.tsx";
import { EmptyState } from "./empty-state.tsx";
import { rememberRpc } from "./rpc.ts";
import { isChangeSignal } from "./use-follow-ups.ts";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

/**
 * The read-properly surface: full detail for every row, several at once, with
 * room the banner does not have. Also the mobile path — hover cannot work on
 * touch, so the banner shows no detail on a compact viewport.
 *
 * It fetches independently rather than reading the shared store, because a
 * panel can be open while the composer — and therefore the banner that owns
 * fetching — is not mounted at all.
 */
/** The banner opens the panel with `{ edit: id }` to start editing that row. */
function editIdFrom(params: unknown): string | null {
  if (typeof params !== "object" || params === null) return null;
  const value = (params as { edit?: unknown }).edit;
  return typeof value === "string" ? value : null;
}

/**
 * The Done disclosure, extracted so the empty state can carry it too.
 *
 * "Nothing outstanding" is a claim; these rows are the evidence for it, and an
 * agent-closed row states a claim of its own that is worth reading right at the
 * point you are being offered the archive button.
 */
function DonePanelSection({
  done,
  busy,
  onClearDone,
  onReopen,
  onDismiss,
}: {
  done: FollowUp[];
  busy: boolean;
  onClearDone: () => void;
  onReopen: (row: FollowUp) => void;
  onDismiss: (row: FollowUp) => void;
}) {
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-muted-foreground">
        {done.length} done
      </summary>
      {/* Inside the disclosure, not beside the summary: a button in a
          `<summary>` toggles the disclosure on its way to being clicked. */}
      <div className="mt-2 flex items-center justify-end">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs text-muted-foreground"
          disabled={busy}
          onClick={() => void onClearDone()}
          aria-label="Clear the done follow-ups"
        >
          Clear
        </Button>
      </div>
      <ul className="mt-1 flex flex-col gap-1 pl-3">
        {done.map((row) => (
          <li key={row.id} className="flex flex-col gap-0.5">
            <span className="flex items-start gap-1">
              <span className="min-w-0 flex-1 break-words text-muted-foreground line-through">
                {row.text}
              </span>
              {/* The panel had no actions on done rows at all, so reopening
                  something closed by mistake meant going back to the
                  banner — which is collapsed by the time you are reading
                  here, since opening this panel collapses it. */}
              <span title="Reopen" className="inline-flex shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-5 text-muted-foreground"
                  disabled={busy}
                  onClick={() => void onReopen(row)}
                  aria-label={`Reopen "${row.text}"`}
                >
                  <Icon name="ArrowTurnBackward" className="size-3" />
                </Button>
              </span>
              <span title="Dismiss" className="inline-flex shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-5 text-muted-foreground"
                  disabled={busy}
                  onClick={() => void onDismiss(row)}
                  aria-label={`Dismiss "${row.text}"`}
                >
                  <Icon name="X" className="size-3" />
                </Button>
              </span>
            </span>
            {/* The panel has the room the banner's tooltip was standing in
                for: an agent-closed row states its claim in full, which is
                what makes checking it against the code possible. */}
            {row.doneBy === "agent" && (
              <span className="break-words text-muted-foreground/70">
                agent:{" "}
                {row.doneNote === null || row.doneNote === undefined
                  ? "closed without a note"
                  : row.doneNote}
              </span>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function FollowUpPanel({
  threadId,
  params,
}: {
  threadId: string;
  params?: unknown;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [rows, setRows] = useState<FollowUp[] | null>(null);
  const [done, setDone] = useState<FollowUp[]>([]);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(editIdFrom(params));
  const [problem, setProblem] = useState<string | null>(null);
  const rowsRef = useRef<FollowUp[] | null>(rows);
  rowsRef.current = rows;

  const load = useCallback(async () => {
    try {
      const result = await rpc.call("followups_list", { threadId });
      setRows(result.followUps);
      setDone(result.done);
    } catch {
      setRows((current) => current ?? []);
    }
  }, [rpc, threadId]);

  const connection = useRealtimeConnectionState();
  // Refetches on reconnect as well as on mount: a panel left open across a
  // dropped connection had no other way back to the truth.
  useEffect(() => {
    void load();
  }, [load, connection]);

  // The panel fetches independently of the banner — it can be open while the
  // composer is not mounted — so it has to subscribe to the change signal
  // itself. Without this it only ever showed what was true when it opened, and
  // an agent recording a row updated the banner while an open panel sat stale.
  useRealtime("followups-changed", (payload) => {
    if (isChangeSignal(payload) && payload.threadId === threadId) void load();
  });

  // Hand the client to callbacks that cannot use hooks — the messageAction.
  useEffect(() => {
    rememberRpc(rpc);
  }, [rpc]);

  const dismiss = useCallback(
    async (row: FollowUp) => {
      setBusy(true);
      // Both lists: a done row can be dismissed from the section below.
      setRows((current) => (current ?? []).filter((entry) => entry.id !== row.id));
      setDone((current) => current.filter((entry) => entry.id !== row.id));
      try {
        const result = await rpc.call("followups_dismiss", { threadId, id: row.id });
        setRows(result.followUps);
        setDone(result.done);
      } catch {
        void load();
      } finally {
        setBusy(false);
      }
    },
    [rpc, threadId, load],
  );

  const markDone = useCallback(
    async (row: FollowUp, next: boolean) => {
      setBusy(true);
      try {
        const result = await rpc.call("followups_done", {
          threadId,
          id: row.id,
          done: next,
        });
        setRows(result.followUps);
        setDone(result.done);
      } catch {
        void load();
      } finally {
        setBusy(false);
      }
    },
    [rpc, threadId, load],
  );

  const amend = useCallback(
    async (row: FollowUp, text: string, detail: string) => {
      setBusy(true);
      setProblem(null);
      try {
        const result = await rpc.call("followups_amend", {
          threadId,
          id: row.id,
          text,
          detail: detail.trim() === "" ? null : detail,
        });
        setRows(result.followUps);
        setDone(result.done);
        if (result.outcome === "amended" || result.outcome === "unchanged") {
          setEditing(null);
          return;
        }
        // Refusals keep the form open with what you typed still in it: the
        // wording is the thing being worked on, and losing it to a rejection
        // would be worse than the rejection.
        setProblem(
          result.outcome === "duplicate"
            ? "Another follow-up on this thread already says that."
            : result.outcome === "dismissed"
              ? "You dismissed that wording earlier, so it cannot come back."
              : "That follow-up is no longer here.",
        );
      } catch {
        setProblem("Could not save. Try again.");
      } finally {
        setBusy(false);
      }
    },
    [rpc, threadId],
  );

  // Same contract as the banner: send the resulting order and the row that
  // moved, so only that row is recorded as placed by hand.
  const commitOrder = useCallback(
    (orderedIds: string[], movedId: string) => {
      const byId = new Map((rowsRef.current ?? []).map((entry) => [entry.id, entry]));
      const reordered = orderedIds
        .map((id) => byId.get(id))
        .filter((entry): entry is FollowUp => entry !== undefined);
      setRows(reordered);
      void (async () => {
        try {
          const result = await rpc.call("followups_reorder", {
            threadId,
            orderedIds,
            movedId,
          });
          setRows(result.followUps);
          setDone(result.done);
        } catch {
          void load();
        }
      })();
    },
    [rpc, threadId, load],
  );

  // Per-row dismissal is not a substitute: it tombstones the wording so it can
  // never be recorded again, where clearing just drops the record of what was
  // finished. The panel offered only the destructive one.
  const clearDone = useCallback(async () => {
    setBusy(true);
    try {
      await rpc.call("followups_clear_done", { threadId });
      const result = await rpc.call("followups_list", { threadId });
      setRows(result.followUps);
      setDone(result.done);
    } catch {
      void load();
    } finally {
      setBusy(false);
    }
  }, [rpc, threadId, load]);

  // Same rule as the banner: inserting a row says it is the one being worked
  // on next, and the top of the list is where that is said.
  const expandRow = useCallback(
    async (row: FollowUp) => {
      try {
        await rpc.call("followups_expand", { threadId, id: row.id });
      } finally {
        void load();
      }
    },
    [rpc, threadId, load],
  );

  const cancelExpand = useCallback(
    async (row: FollowUp) => {
      try {
        const result = await rpc.call("followups_expand_cancel", {
          threadId,
          id: row.id,
        });
        setRows(result.followUps);
        setDone(result.done);
      } catch {
        void load();
      }
    },
    [rpc, threadId, load],
  );

  const moveToTop = useCallback(
    (row: FollowUp) => {
      const current = rowsRef.current ?? [];
      if (current.length < 2 || current[0]?.id === row.id) return;
      commitOrder(
        [row.id, ...current.filter((entry) => entry.id !== row.id).map((entry) => entry.id)],
        row.id,
      );
    },
    [commitOrder],
  );

  if (rows === null) {
    return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;
  }

  // Ungated, unlike the banner's: no `everRecorded`, and no waiting for a turn
  // to end. This panel is opened deliberately, so there is no cost to it having
  // an answer — which is what covers the thread that never recorded a follow-up
  // at all, and where the banner is right to stay silent.
  if (rows.length === 0) {
    return (
      <div className="flex flex-col gap-3 p-3">
        {/* Never animated here. The banner earns its entrance by marking a
            change you may not have watched happen; a panel you just opened is
            not a change, it is a page. */}
        <EmptyState
          threadId={threadId}
          done={done}
          animate={false}
        />
        {done.length > 0 && (
          <DonePanelSection
            done={done}
            busy={busy}
            onClearDone={() => void clearDone()}
            onReopen={(row) => void markDone(row, false)}
            onDismiss={(row) => void dismiss(row)}
          />
        )}
      </div>
    );
  }

  const rollup = formatRollup(rows);
  const returned = rows.filter(needsReview).length;
  const inProgress = rows.filter(
    (row) => isInProgress(row) && !needsReview(row),
  ).length;

  return (
    <div className="flex flex-col gap-3 p-3">
      <p className="text-xs text-muted-foreground">
        {rows.length} follow-up{rows.length === 1 ? "" : "s"}
        {rollup === "" ? "" : ` · ${rollup}`}
        {returned > 0 && (
          <span className="ml-1.5 inline-flex items-center gap-0.5 align-middle text-foreground">
            <Icon name="BellDot" className="size-3" aria-hidden />
            <span className="tabular-nums">{returned}</span>
            <span className="sr-only">handed off and back, needs checking</span>
          </span>
        )}
        {inProgress > 0 && (
          <span className="ml-1.5 inline-flex items-center gap-0.5 align-middle text-foreground">
            <Icon name="Sent" className="size-3" aria-hidden />
            <span className="tabular-nums">{inProgress}</span>
            <span className="sr-only">in progress</span>
          </span>
        )}
      </p>
      <FollowUpSortable
        ids={rows.map((entry) => entry.id)}
        onCommit={commitOrder}
      >
        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <PanelRow
              key={row.id}
              row={row}
              threadId={threadId}
              busy={busy}
              editing={editing === row.id}
              problem={editing === row.id ? problem : null}
              onEdit={() => {
                setProblem(null);
                setEditing(row.id);
              }}
              onCancelEdit={() => {
                setProblem(null);
                setEditing(null);
              }}
              onAmend={(text, detail) => void amend(row, text, detail)}
              onDone={() => void markDone(row, true)}
              onDismiss={() => void dismiss(row)}
              onInserted={() => moveToTop(row)}
              onCancelExpand={() => void cancelExpand(row)}
              onExpand={() => void expandRow(row)}
            />
          ))}
        </ul>
      </FollowUpSortable>
      {done.length > 0 && (
        <DonePanelSection
          done={done}
          busy={busy}
          onClearDone={() => void clearDone()}
          onReopen={(row) => void markDone(row, false)}
          onDismiss={(row) => void dismiss(row)}
        />
      )}
    </div>
  );
}

/**
 * One panel row. Split out of the panel because useSortableRow is a hook and
 * has to run per row, not in a loop inside the parent.
 */
function PanelRow({
  row,
  threadId,
  busy,
  editing,
  problem,
  onEdit,
  onCancelEdit,
  onAmend,
  onDone,
  onDismiss,
  onInserted,
  onCancelExpand,
  onExpand,
}: {
  row: FollowUp;
  threadId: string;
  onCancelExpand: () => void;
  onExpand: () => void;
  busy: boolean;
  editing: boolean;
  problem: string | null;
  onEdit: () => void;
  onCancelEdit: () => void;
  onAmend: (text: string, detail: string) => void;
  onDone: () => void;
  onDismiss: () => void;
  onInserted: () => void;
}) {
  const { setNodeRef, style, handleProps, isDragging } = useSortableRow(row.id);
  // Same read as the banner's row, for the same reason. `!== false` so the
  // button survives the render before the values arrive.
  const offerDescribe = useSettings().values?.offerDescribe !== false;
  const [draftText, setDraftText] = useState(row.text);
  const [draftDetail, setDraftDetail] = useState(row.detail ?? "");

  // Re-seed only while the editor is closed. What you have typed wins over a
  // row that changed underneath you — the alternative is deleting someone's
  // half-written sentence to show them an agent's edit.
  //
  // The trade is real now that this panel refetches on the change signal: if an
  // agent amends a row while its editor is open, saving overwrites their
  // version with what was on screen when you started. Before live updates the
  // case could not arise, because the panel never saw the change at all.
  useEffect(() => {
    if (!editing) {
      setDraftText(row.text);
      setDraftDetail(row.detail ?? "");
    }
  }, [editing, row.text, row.detail]);

  if (editing) {
    return (
      <li ref={setNodeRef} style={style} className="flex flex-col gap-2 border-b border-border/50 pb-3">
        <textarea
          value={draftText}
          onChange={(event) => setDraftText(event.target.value)}
          rows={2}
          maxLength={TEXT_MAX}
          aria-label="Follow-up text"
          className="w-full resize-y rounded border border-border bg-background px-2 py-1 text-sm leading-snug focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <textarea
          value={draftDetail}
          onChange={(event) => setDraftDetail(event.target.value)}
          rows={4}
          maxLength={DETAIL_MAX}
          placeholder="Detail a future reader would need"
          aria-label="Follow-up detail"
          className="w-full resize-y rounded border border-border bg-background px-2 py-1 text-xs leading-relaxed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        {problem !== null && (
          <p className="text-xs text-destructive">{problem}</p>
        )}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="h-7"
            disabled={busy || draftText.trim() === ""}
            onClick={() => onAmend(draftText.trim(), draftDetail)}
          >
            Save
          </Button>
          <Button variant="ghost" size="sm" className="h-7" onClick={onCancelEdit}>
            Cancel
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex flex-col gap-1 border-b border-border/50 pb-3",
        isDragging && "rounded bg-background shadow-sm ring-1 ring-border",
      )}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          {...handleProps}
          className={cn(
            "mt-0.5 flex size-5 shrink-0 touch-none items-center justify-center rounded text-muted-foreground",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            isDragging ? "cursor-grabbing" : "cursor-grab",
          )}
          aria-label={`Reorder "${row.text}"`}
        >
          <Icon name="DragDropVertical" className="size-4" aria-hidden />
        </button>
        {row.reason !== null && (
          <span className="mt-px shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            {row.reason}
          </span>
        )}
        {/* Live, unlike every other glyph here, so it comes first: a row being
            described is the one thing on this list that will change on its own
            while you look at it. */}
        {/* State, not a control — the stop lives with the other verbs on the
            right. It was briefly the button itself, and nothing about a spinner
            says "click me". */}
        {isExpanding(row) && (
          <span
            title="A helper thread is describing this follow-up"
            className="mt-1 inline-flex shrink-0 text-foreground"
          >
            <Icon name="Spinner" className="size-3.5" aria-hidden />
            <span className="sr-only">Being described</span>
          </span>
        )}
        {/* The two states the banner shows and this surface did not, which was
            backwards: the panel is where rows are read properly, so it was the
            one that could not say which of them were already in flight. */}
        {isInProgress(row) && (
          <span
            title={
              row.handoffState === "failed"
                ? "The thread this was handed to failed"
                : row.handoffState === "finished"
                  ? "Handed-off thread finished — check it before closing this"
                  : "In progress — a prompt referencing this was sent"
            }
            className={cn(
              "mt-1 inline-flex shrink-0",
              row.handoffState === "failed"
                ? "text-destructive"
                : "text-foreground",
            )}
          >
            <span className="sr-only">
              {row.handoffState === "failed"
                ? "Handoff failed"
                : row.handoffState === "finished"
                  ? "Handoff finished, needs checking"
                  : "In progress"}
            </span>
            <Icon
              name={
                row.handoffState === "failed"
                  ? "AlertCircle"
                  : row.handoffState === "finished"
                    ? "BellDot"
                    : "Sent"
              }
              className="size-3"
              aria-hidden
            />
          </span>
        )}
        <ComposerInsertedMark row={row} />
        <span className="min-w-0 flex-1 text-sm leading-snug">{row.text}</span>
        {/* One slot, two states: describe this, or stop describing it. Offered
            only on a row with no detail, which is what an expansion is for. */}
        {offerDescribe && !isExpanding(row) && (row.detail === null || row.detail === "") && (
          <span title="Describe this in more detail" className="inline-flex">
            <Button
              variant="ghost"
              size="icon"
              className="size-6 shrink-0 text-muted-foreground"
              disabled={busy}
              onClick={onExpand}
              aria-label={`Describe "${row.text}" in more detail`}
            >
              <Icon name="Brain" className="size-3.5" />
            </Button>
          </span>
        )}
        {isExpanding(row) && (
          <span title="Stop describing this" className="inline-flex">
            <Button
              variant="ghost"
              size="icon"
              className="size-6 shrink-0 text-muted-foreground hover:text-destructive"
              onClick={onCancelExpand}
              aria-label={`Stop describing "${row.text}"`}
            >
              <Icon name="Square" className="size-3.5" />
            </Button>
          </span>
        )}
        <ComposerInsert row={row} threadId={threadId} onInserted={onInserted} />
        <HandoffAction row={row} />
        <span title="Edit" className="inline-flex">
          <Button
            variant="ghost"
            size="icon"
            className="size-6 shrink-0 text-muted-foreground"
            disabled={busy}
            onClick={onEdit}
            aria-label={`Edit "${row.text}"`}
          >
            <Icon name="Edit" className="size-3.5" />
          </Button>
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-6 shrink-0 text-muted-foreground"
          disabled={busy}
          onClick={onDone}
          aria-label={`Mark "${row.text}" done`}
        >
          <Icon name="Check" className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-6 shrink-0 text-muted-foreground"
          disabled={busy}
          onClick={onDismiss}
          aria-label={`Dismiss "${row.text}"`}
        >
          <Icon name="X" className="size-3.5" />
        </Button>
      </div>
      {row.file !== null && <p className="text-xs text-muted-foreground">{row.file}</p>}
      {row.detail !== null && row.detail !== "" && (
        <p className="text-xs leading-relaxed text-muted-foreground">{row.detail}</p>
      )}
    </li>
  );
}
