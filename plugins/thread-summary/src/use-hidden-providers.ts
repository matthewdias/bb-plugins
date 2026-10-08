// The hidden-providers list, shared by every card and the settings section.
//
// One store at module scope: the header actions and the settings section are
// separate React trees, and all must show the same thing the moment any of
// them changes it. The backend announces every write, so another window
// catches up too. Thread Badges' use-complication-prefs.ts, for a list.
import { useCallback, useEffect, useSyncExternalStore } from "react";
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

export function useHiddenProviders(): {
  hidden: ReadonlySet<string>;
  loaded: boolean;
  setHidden: (id: string, hide: boolean) => Promise<void>;
} {
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();

  // Again on reconnect: a write announced while the connection was down was
  // never heard here.
  useEffect(() => {
    void load(rpc);
  }, [rpc, connection]);

  useRealtime(HIDDEN_CHANGED, () => {
    void load(rpc);
  });

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
