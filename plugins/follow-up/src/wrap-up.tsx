// Wrap up: a popup over the composer that takes the thread to done.
//
// Every open row gets a disposition, defaulting to the project's destination,
// and one button carries them all out and archives the thread — asked each
// time, with Archive ticked. Once someone is wrapping up the timeline has
// served its purpose, so the popup takes the height it needs.
//
// The pickers are native <select>s. bb closes a composer popup on any press
// outside it, and a menu portaled to the page body is outside it: picking from
// one would close the popup under the pick. A native picker is drawn by the
// browser, not the page, and on a phone it is the system's own wheel.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useComposer,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
  type ExperimentalComposerCommandRegistration,
  type PluginAppComposer,
  type PluginComposerApi,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "../server";
import { isFiling, type FollowUp } from "../lib/followups.ts";
import {
  defaultDisposition,
  dispositionFromKey,
  dispositionKey,
  wrapUpSummary,
  type Disposition,
} from "../lib/wrap-up.ts";
import { FilingStatus, useDestinations, useOpenDestinationSetup } from "./filing.tsx";
import { isChangeSignal } from "./use-follow-ups.ts";
import { threadIdFromScope } from "./scope.ts";
import { useFollowUpState } from "./store.ts";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

/** The popup's id, unique across this plugin's composer customizations. */
export const WRAP_UP_POPUP_ID = "followups-wrap-up";
/** Must match WRAP_UP_CHANGED in server.ts. */
export const WRAP_UP_CHANGED = "followups-wrap-up-changed";

export type WrapUpState = {
  status: "running" | "held";
  archive: boolean;
  held: string | null;
  waitingOn: number;
  failed: { id: string; note: string }[];
};

type WrapUpInfo = {
  state: WrapUpState | null;
  newWorktree: boolean;
  children: { open: number; running: number };
};

/** Open the popup from wherever the composer is in hand. */
export function openWrapUp(composer: Pick<PluginComposerApi, "experimental_openPopup">): boolean {
  if (composer.experimental_openPopup(WRAP_UP_POPUP_ID)) return true;
  toast.error("Wrap up opens in a thread's composer.");
  return false;
}

/** "Follow-ups: wrap up this thread…": the popup, from the palette. */
export const wrapUpCommand: ExperimentalComposerCommandRegistration = {
  id: "wrap-up",
  title: "Follow-ups: wrap up this thread…",
  run: ({ composer }) => {
    openWrapUp(composer);
  },
};

/** As `registerInsertCommand`: a bb without composer commands loses only this. */
export function registerWrapUpCommand(
  composer: Partial<Pick<PluginAppComposer, "experimental_registerCommand">>,
): boolean {
  if (typeof composer.experimental_registerCommand !== "function") return false;
  composer.experimental_registerCommand(wrapUpCommand);
  return true;
}

/**
 * Keep one read of the server's wrap-up answer fresh: the state alone for the card's
 * status line, the full one for the popup, which also needs to know about new
 * worktrees and child threads.
 */
function useWrapUpRead<T>(
  threadId: string | null,
  read: (threadId: string) => Promise<T>,
): { value: T | null; reload: () => void } {
  const connection = useRealtimeConnectionState();
  const [value, setValue] = useState<{ threadId: string; value: T } | null>(null);
  const threadRef = useRef(threadId);
  threadRef.current = threadId;
  const readRef = useRef(read);
  readRef.current = read;

  const load = useCallback(async () => {
    const target = threadRef.current;
    if (target === null) return;
    try {
      const result = await readRef.current(target);
      if (threadRef.current === target) setValue({ threadId: target, value: result });
    } catch {
      // Keep the last answer: a line that vanished on a blip would read as the
      // wrap-up having finished.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [threadId, connection, load]);

  useRealtime(WRAP_UP_CHANGED, (payload) => {
    if (isChangeSignal(payload) && payload.threadId === threadRef.current) void load();
  });

  return {
    value: value !== null && value.threadId === threadId ? value.value : null,
    reload: () => void load(),
  };
}

/** The card's status line: a wrap-up under way, or held short of the archive. */
export function useWrapUpState(threadId: string | null): {
  state: WrapUpState | null;
  forget: () => void;
} {
  const rpc = useRpc<typeof rpcContract>();
  const { value, reload } = useWrapUpRead(threadId, async (target) =>
    (await rpc.call("followups_wrap_up_state", { threadId: target })).state,
  );
  const forget = useCallback(() => {
    if (threadId === null) return;
    void rpc.call("followups_wrap_up_forget", { threadId }).then(reload, reload);
  }, [rpc, threadId, reload]);
  return { state: value, forget };
}

/** The line on the card while a wrap-up waits, or after one was held. */
export function WrapUpStatus({
  state,
  onOpen,
  onForget,
}: {
  state: WrapUpState;
  onOpen: () => void;
  onForget: () => void;
}) {
  if (state.status === "running") {
    return (
      <p className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground" role="status">
        <Icon name="Spinner" className="size-3 shrink-0" aria-hidden />
        <span>
          Wrapping up: waiting on {state.waitingOn} {state.waitingOn === 1 ? "filing" : "filings"}
          {state.archive ? ", then archiving this thread." : "."}
        </span>
      </p>
    );
  }
  return (
    <div className="flex items-start gap-1.5 px-1 text-xs" role="note">
      <Icon name="AlertTriangle" className="mt-0.5 size-3 shrink-0 text-destructive" aria-hidden />
      <span className="min-w-0 flex-1 leading-snug text-foreground">{state.held}</span>
      <Button
        variant="secondary"
        size="sm"
        className="h-6 shrink-0 px-2 text-xs"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onOpen}
      >
        Wrap up…
      </Button>
      <span title="Dismiss" className="inline-flex shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="size-6 text-muted-foreground"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onForget}
          aria-label="Dismiss this notice"
        >
          <Icon name="X" className="size-3.5" />
        </Button>
      </span>
    </div>
  );
}

/** The popup as registered: bound to the composer that opened it. */
export function WrapUpPopup() {
  const composer = useComposer();
  const threadId = threadIdFromScope(composer.scope);
  if (threadId === null) {
    return <p className="p-3 text-sm text-muted-foreground">Wrap up works on a thread.</p>;
  }
  return (
    <WrapUp
      threadId={threadId}
      running={composer.isRunning}
      onClose={() => composer.experimental_closePopup()}
    />
  );
}

const SELECT_CLASS =
  "h-7 max-w-full shrink-0 rounded-md border border-border bg-transparent px-1.5 text-xs text-foreground " +
  "outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

export function WrapUp({
  threadId,
  running,
  onClose,
}: {
  threadId: string;
  /** The agent is mid-turn: nothing here may run until it stops. */
  running: boolean;
  onClose: () => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const { rows } = useFollowUpState(threadId);
  const { destinations, defaultId } = useDestinations(threadId);
  const openDestinationSetup = useOpenDestinationSetup();
  const { value: info, reload } = useWrapUpRead<WrapUpInfo>(threadId, (target) =>
    rpc.call("followups_wrap_up_get", { threadId: target }),
  );
  const [chosen, setChosen] = useState<Record<string, Disposition>>({});
  const [archive, setArchive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const deciding = rows.filter((row) => !isFiling(row));
  const filing = rows.filter((row) => isFiling(row));
  const known = useMemo(() => new Set(destinations.map((entry) => entry.id)), [destinations]);
  const fallback = defaultDisposition(defaultId !== null && known.has(defaultId) ? defaultId : null);
  // A pick that names a destination since removed falls back to the default
  // rather than sending a request the server would refuse.
  const dispositionOf = (row: FollowUp): Disposition => {
    const pick = chosen[row.id];
    if (pick === undefined || (pick.kind === "file" && !known.has(pick.destinationId))) return fallback;
    if (pick.kind === "handoff" && pick.where === "new-worktree" && info?.newWorktree !== true) return fallback;
    return pick;
  };
  const nameOf = (id: string) => destinations.find((entry) => entry.id === id)?.name ?? id;
  const summary = wrapUpSummary(deciding.map(dispositionOf), nameOf, archive);
  const state = info?.state ?? null;
  const waiting = state?.status === "running";
  const failedNote = (row: FollowUp) =>
    row.filingNote ? null : (state?.failed.find((entry) => entry.id === row.id)?.note ?? null);
  // Default first, then the rest as set up.
  const ordered = [
    ...destinations.filter((entry) => entry.id === defaultId),
    ...destinations.filter((entry) => entry.id !== defaultId),
  ];

  const submit = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const result = await rpc.call("followups_wrap_up", {
        threadId,
        plan: deciding.map((row) => ({ id: row.id, disposition: dispositionOf(row) })),
        archive,
      });
      switch (result.outcome) {
        case "archived":
          toast.success("Wrapped up and archived.");
          onClose();
          return;
        case "waiting":
          // The card says what it is waiting on, and archives when it lands.
          onClose();
          return;
        case "finished":
          if (result.message !== null) toast.error(result.message);
          onClose();
          return;
        default:
          // Held, changed, still running, busy, failed: stay, and say why.
          setProblem(result.message ?? "It could not wrap up. Try again.");
          reload();
      }
    } catch {
      setProblem("It could not wrap up. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const blocked = running || waiting;

  return (
    <div className="flex max-h-[min(44rem,calc(100dvh-8rem))] w-full flex-col">
      <div className="shrink-0 border-b border-border px-3 pb-2 pt-2.5">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-medium text-foreground">Wrap up this thread</h2>
          <span className="text-xs tabular-nums text-muted-foreground">
            {rows.length === 0 ? "nothing open" : `${rows.length} open`}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {rows.length === 0
            ? "No follow-ups are left here."
            : "Choose where each follow-up goes. Nothing happens until you press Wrap up."}
        </p>
        {state?.status === "held" && state.held !== null && (
          <p role="note" className="mt-1.5 flex items-start gap-1.5 text-xs leading-snug text-foreground">
            <Icon name="AlertTriangle" className="mt-0.5 size-3 shrink-0 text-destructive" aria-hidden />
            {state.held}
          </p>
        )}
        {destinations.length === 0 && rows.length > 0 && (
          <p className="mt-1.5 text-xs text-muted-foreground">
            Nowhere to file yet.{" "}
            <button
              type="button"
              className="text-foreground underline underline-offset-2"
              onClick={() => {
                onClose();
                openDestinationSetup();
              }}
            >
              Set up a destination
            </button>
          </p>
        )}
      </div>

      {rows.length > 0 && (
        <ul
          aria-label="Open follow-ups"
          className="flex min-h-0 flex-1 flex-col divide-y divide-border/50 overflow-y-auto overscroll-contain px-3"
        >
          {deciding.map((row) => {
            const note = failedNote(row);
            return (
              <li key={row.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2">
                <div className="flex min-w-[min(14rem,100%)] flex-1 flex-col gap-0.5">
                  <span className="break-words text-xs leading-snug text-foreground" title={row.detail ?? undefined}>
                    {row.text}
                  </span>
                  {row.reason !== null && (
                    <span className="text-[11px] text-muted-foreground">{row.reason}</span>
                  )}
                  <FilingStatus row={row} />
                  {note !== null && (
                    <span role="note" className="text-[11px] leading-snug text-destructive">
                      {note}
                    </span>
                  )}
                </div>
                <select
                  aria-label={`What to do with "${row.text}"`}
                  className={SELECT_CLASS}
                  value={dispositionKey(dispositionOf(row))}
                  disabled={busy || blocked}
                  onChange={(event) => {
                    const next = dispositionFromKey(event.target.value);
                    if (next !== null) setChosen((current) => ({ ...current, [row.id]: next }));
                  }}
                >
                  {ordered.length > 0 && (
                    <optgroup label="File to">
                      {ordered.map((destination) => (
                        <option key={destination.id} value={`file:${destination.id}`}>
                          File to {destination.name}
                          {destination.id === defaultId ? " (default)" : ""}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  <optgroup label="Hand off">
                    <option value="handoff:here">Hand off in this checkout</option>
                    {info?.newWorktree === true && (
                      <option value="handoff:new-worktree">Hand off in a new worktree</option>
                    )}
                  </optgroup>
                  <optgroup label="Close here">
                    <option value="done">Mark done</option>
                    <option value="dismiss">Dismiss</option>
                    <option value="keep">Keep open</option>
                  </optgroup>
                </select>
              </li>
            );
          })}
          {filing.map((row) => (
            <li key={row.id} className="flex flex-col gap-0.5 py-2">
              <span className="break-words text-xs leading-snug text-muted-foreground">{row.text}</span>
              <FilingStatus row={row} />
            </li>
          ))}
        </ul>
      )}

      <div className="shrink-0 border-t border-border px-3 pb-2.5 pt-2">
        <label className="flex cursor-pointer items-start gap-2 text-xs text-foreground">
          <input
            type="checkbox"
            className="mt-0.5 accent-foreground"
            checked={archive}
            disabled={busy || blocked}
            onChange={(event) => setArchive(event.target.checked)}
          />
          <span className="flex flex-col gap-0.5">
            <span>Archive this thread</span>
            <span className="text-[11px] text-muted-foreground">
              Once everything sent somewhere has landed. If anything doesn't, it stays open.
            </span>
            {archive && info !== null && info.children.open > 0 && (
              <span className="text-[11px] text-destructive">
                Also archives {info.children.open} child{" "}
                {info.children.open === 1 ? "thread" : "threads"}
                {info.children.running > 0 ? `, ${info.children.running} still working` : ""}.
              </span>
            )}
          </span>
        </label>
        <p className="mt-2 text-xs text-muted-foreground" aria-live="polite">
          {running
            ? "The agent is still working. Wrap up once it stops."
            : waiting
              ? "Already wrapping up: waiting on what was sent."
              : summary}
        </p>
        {problem !== null && (
          <p role="alert" className="mt-1 text-xs text-destructive">
            {problem}
          </p>
        )}
        <div className="mt-2 flex items-center justify-end gap-1.5">
          <Button variant="ghost" size="sm" className="h-7 px-2.5 text-xs" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className={cn("h-7 px-3 text-xs", "bg-foreground/30 hover:bg-foreground/35")}
            disabled={busy || blocked}
            onClick={() => void submit()}
          >
            {busy && <Icon name="Spinner" className="size-3" aria-hidden />}
            Wrap up
          </Button>
        </div>
      </div>
    </div>
  );
}
