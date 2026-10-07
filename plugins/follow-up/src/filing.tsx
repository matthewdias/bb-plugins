// Filing from the card and the panel: the menus that send rows to a
// destination, and what a row says while it is on its way.
//
// One module for both surfaces, like filed-badge.tsx, so the two cannot come
// to file differently or describe the same row in different words.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  useBbNavigate,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "../server";
import type { Destination } from "../lib/destinations.ts";
import { isFiling, type FollowUp } from "../lib/followups.ts";
import { FOLLOWUPS_PANEL_ACTION } from "./panel-ids.ts";
import { dismissKeyboard } from "./keyboard.ts";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";

/** Must match DESTINATIONS_CHANGED in server.ts. */
export const DESTINATIONS_CHANGED = "followups-destinations-changed";

export interface DestinationsState {
  destinations: Destination[];
  /** This thread's project's default, which File all reaches for first. */
  defaultId: string | null;
}

/** The destinations set up in Settings, kept fresh, with this project's default. */
export function useDestinations(threadId: string | null): DestinationsState {
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const [state, setState] = useState<DestinationsState>({ destinations: [], defaultId: null });
  const rpcRef = useRef(rpc);
  rpcRef.current = rpc;
  const threadRef = useRef(threadId);
  threadRef.current = threadId;

  const load = useCallback(async () => {
    const target = threadRef.current;
    if (target === null) return;
    try {
      const result = await rpcRef.current.call("followups_destinations", {
        projectId: null,
        threadId: target,
      });
      if (threadRef.current === target) setState(result);
    } catch {
      // Keep what was there: a menu that empties on a blip reads as the
      // destinations being gone.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [threadId, connection, load]);

  useRealtime(DESTINATIONS_CHANGED, () => {
    void load();
  });

  return state;
}

const REFUSED: Record<"no-destination" | "unknown-destination" | "nothing-to-file", string> = {
  "no-destination": "Pick a destination first; it becomes this project's default.",
  "unknown-destination": "That destination is no longer set up.",
  "nothing-to-file": "Nothing to file: those follow-ups are already on their way.",
};

/**
 * File rows: null ids for every open one, null destination for the project's
 * default. The rows say "filing…" on their own once this returns, so success
 * needs no message; only a refusal does.
 */
export function useFile(threadId: string | null) {
  const rpc = useRpc<typeof rpcContract>();
  return useCallback(
    async (ids: string[] | null, destinationId: string | null) => {
      if (threadId === null) return;
      try {
        const result = await rpc.call("followups_file", { threadId, ids, destinationId });
        if (result.outcome !== "started") toast.error(REFUSED[result.outcome]);
      } catch {
        toast.error("Filing could not start. Try again.");
      }
    },
    [rpc, threadId],
  );
}

/**
 * Where destinations are set up from a thread: the Follow-ups panel, which
 * carries the same editor as Settings. bb gives a plugin no way to open its
 * own settings page, and the panel is reachable on a phone besides.
 */
export function useOpenDestinationSetup() {
  const navigate = useBbNavigate();
  return useCallback(() => {
    dismissKeyboard();
    navigate.openThreadPanel({ actionId: FOLLOWUPS_PANEL_ACTION, params: { destinations: true } });
  }, [navigate]);
}

/** Default first, so the likeliest choice is the first item under the pointer. */
function ordered(state: DestinationsState): Destination[] {
  return [...state.destinations].sort(
    (a, b) => Number(b.id === state.defaultId) - Number(a.id === state.defaultId),
  );
}

/** The "File to …" items in a row's ⋯ menu. */
export function FileToMenuItems({
  row,
  state,
  onFile,
  onSetUp,
}: {
  row: FollowUp;
  state: DestinationsState;
  onFile: (destinationId: string) => void;
  onSetUp: () => void;
}) {
  if (state.destinations.length === 0) {
    return (
      <DropdownMenuItem onSelect={onSetUp} aria-label="Set up where follow-ups can be filed">
        <Icon name="FolderExport" className="size-3.5" aria-hidden />
        Set up where to file…
      </DropdownMenuItem>
    );
  }
  const filing = isFiling(row);
  return (
    <>
      {ordered(state).map((destination) => (
        <DropdownMenuItem
          key={destination.id}
          disabled={filing}
          onSelect={() => onFile(destination.id)}
          aria-label={`File "${row.text}" to ${destination.name}`}
        >
          <Icon name="FolderExport" className="size-3.5" aria-hidden />
          File to {destination.name}
        </DropdownMenuItem>
      ))}
    </>
  );
}

/**
 * File every open row at once. A menu rather than a button: opening it is the
 * first tap, choosing where is the second, so a stray tap files nothing — this
 * writes to systems outside bb, and an issue it opens cannot be closed from here.
 */
export function FileAllMenu({
  count,
  state,
  onFile,
  onSetUp,
}: {
  count: number;
  state: DestinationsState;
  onFile: (destinationId: string) => void;
  onSetUp: () => void;
}) {
  if (count === 0) return null;
  return (
    <DropdownMenu modal={false}>
      <span title="File all…" className="inline-flex shrink-0">
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            onMouseDown={(event) => event.preventDefault()}
            aria-label="File all follow-ups…"
          >
            <Icon name="FolderExport" className="size-3.5 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
      </span>
      <DropdownMenuContent align="end" className="max-w-[min(20rem,calc(100vw-2rem))]">
        {ordered(state).map((destination) => (
          <DropdownMenuItem
            key={destination.id}
            onSelect={() => onFile(destination.id)}
            aria-label={`File all ${count} to ${destination.name}`}
          >
            <Icon name="FolderExport" className="size-3.5" aria-hidden />
            <span className="min-w-0 whitespace-normal">
              File all {count} to {destination.name}
              {destination.id === state.defaultId && (
                <span className="ml-1 text-muted-foreground">(default)</span>
              )}
            </span>
          </DropdownMenuItem>
        ))}
        {state.destinations.length > 0 && <DropdownMenuSeparator />}
        <DropdownMenuItem onSelect={onSetUp} aria-label="Set up where follow-ups can be filed">
          <Icon name="SlidersHorizontal" className="size-3.5" aria-hidden />
          {state.destinations.length === 0 ? "Set up where to file…" : "Destinations…"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** What a row says while it is on its way, or why the last try did not land. */
export function FilingStatus({ row }: { row: FollowUp }) {
  if (isFiling(row)) {
    return (
      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <Icon name="Spinner" className="size-3" aria-hidden />
        Filing{row.filingTo ? ` to ${row.filingTo}` : ""}…
      </span>
    );
  }
  if (row.filingNote) {
    return (
      <span role="note" className="text-[11px] leading-snug text-destructive">
        {row.filingNote}
      </span>
    );
  }
  return null;
}
