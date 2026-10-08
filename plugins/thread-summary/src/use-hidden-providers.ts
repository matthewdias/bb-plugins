// The hidden-providers list, shared by every card and the settings section.
//
// One store at module scope: the header actions and the settings section are
// separate React trees, and all must show the same thing the moment any of
// them changes it. The backend announces every write, so another window
// catches up too. Thread Badges' use-complication-prefs.ts, for a list.
//
// Read once per window, not once per header: a header mounts per pane and
// can remount on every thread switch. A reload — another window's write, or
// a reconnect — is heard by every mounted header at once, so those coalesce
// into one call too.
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import {
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
  type PluginRpcClient,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import { HIDDEN_CHANGED } from "../lib/hidden";

type Rpc = PluginRpcClient<typeof rpcContract>;

let hidden: ReadonlySet<string> = new Set();
let loaded = false;
const listeners = new Set<() => void>();

function publish(next: readonly string[]): void {
  hidden = new Set(next);
  loaded = true;
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const read = () => hidden;
const readLoaded = () => loaded;

async function load(rpc: Rpc): Promise<void> {
  try {
    publish((await rpc.call("hiddenProviders_list", {})).hidden);
  } catch {
    // Keep what was last read: a failed refresh is not "nothing hidden".
  }
}

/** Whether this window has asked for the list yet. */
let requested = false;
let scheduled = false;
let inFlight = false;
/** A reload asked for while one was in flight, which may predate the change. */
let again = false;

/**
 * Read the list, once for every caller in this turn of the event loop. One
 * asked for while a read is in flight runs after it, since that read may have
 * left before the change it is meant to catch.
 */
function reload(rpc: Rpc): void {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    if (inFlight) {
      again = true;
      return;
    }
    inFlight = true;
    void load(rpc).finally(() => {
      inFlight = false;
      if (!again) return;
      again = false;
      reload(rpc);
    });
  });
}

/** For tests: forget the window's list, so the next mount reads it afresh. */
export function resetHiddenProviders(): void {
  hidden = new Set();
  loaded = false;
  requested = false;
}

export function useHiddenProviders(): {
  hidden: ReadonlySet<string>;
  loaded: boolean;
  setHidden: (id: string, hide: boolean) => Promise<void>;
} {
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();

  useEffect(() => {
    if (requested) return;
    requested = true;
    reload(rpc);
  }, [rpc]);

  // Again on reconnect: a write announced while the connection was down was
  // never heard here.
  const previous = useRef(connection);
  useEffect(() => {
    const was = previous.current;
    previous.current = connection;
    if (was !== "connected" && connection === "connected") reload(rpc);
  }, [rpc, connection]);

  useRealtime(HIDDEN_CHANGED, () => reload(rpc));

  const setHidden = useCallback(
    async (id: string, hide: boolean) => {
      publish((await rpc.call("hiddenProviders_set", { id, hidden: hide })).hidden);
    },
    [rpc],
  );

  return {
    hidden: useSyncExternalStore(subscribe, read, read),
    loaded: useSyncExternalStore(subscribe, readLoaded, readLoaded),
    setHidden,
  };
}
