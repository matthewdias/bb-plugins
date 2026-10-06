// The stored settings for complications, shared by the rows and Settings.
//
// One store at module scope: the overlay that draws the rows and the settings
// section are separate React trees, and both must show the same thing the
// moment either changes it. The backend announces every write, so another
// window catches up too.
import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
  type PluginRpcClient,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import { PREFS_CHANGED, type ComplicationPrefs, type ComplicationPrefsMap } from "./complication-prefs";

type Rpc = PluginRpcClient<typeof rpcContract>;

let prefs: ComplicationPrefsMap = {};
let loaded = false;
const listeners = new Set<() => void>();

function publish(next: ComplicationPrefsMap): void {
  prefs = next;
  loaded = true;
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const read = () => prefs;
const readLoaded = () => loaded;

async function load(rpc: Rpc): Promise<void> {
  try {
    publish((await rpc.call("complicationPrefs_list", {})).prefs);
  } catch {
    // Keep what was last read: a failed refresh is not "nothing turned on".
  }
}

export function useComplicationPrefs(): {
  prefs: ComplicationPrefsMap;
  loaded: boolean;
  update: (id: string, patch: Partial<ComplicationPrefs>) => Promise<void>;
} {
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();

  // Again on reconnect: a write announced while the connection was down was
  // never heard here.
  useEffect(() => {
    void load(rpc);
  }, [rpc, connection]);

  useRealtime(PREFS_CHANGED, () => {
    void load(rpc);
  });

  const update = useCallback(
    async (id: string, patch: Partial<ComplicationPrefs>) => {
      publish((await rpc.call("complicationPrefs_set", { id, prefs: patch })).prefs);
    },
    [rpc],
  );

  return {
    prefs: useSyncExternalStore(subscribe, read, read),
    loaded: useSyncExternalStore(subscribe, readLoaded, readLoaded),
    update,
  };
}
