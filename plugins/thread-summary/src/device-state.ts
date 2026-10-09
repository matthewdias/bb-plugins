// Whether the card is showing, as a hook every card in the window shares.
//
// ../lib/card-state stores it per device; this keeps the cards in step, so
// pressing the button in one pane shows or hides the card in every other.
import { useCallback, useSyncExternalStore } from "react";
import { experimental_usePluginId } from "@get-bb/plugin-sdk/app";
import { readState, writeState, type DeviceState } from "../lib/card-state";

const cache = new Map<string, DeviceState>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function current(pluginId: string): DeviceState {
  let state = cache.get(pluginId);
  if (state === undefined) {
    state = readState(pluginId);
    cache.set(pluginId, state);
  }
  return state;
}

/** For tests: forget what was read, so the next read goes to storage. */
export function resetDeviceState(): void {
  cache.clear();
}

export function useDeviceState(): [DeviceState, (patch: Partial<DeviceState>) => void] {
  const pluginId = experimental_usePluginId();
  const read = useCallback(() => current(pluginId), [pluginId]);
  const state = useSyncExternalStore(subscribe, read, read);
  const update = useCallback(
    (patch: Partial<DeviceState>) => {
      writeState(pluginId, patch);
      cache.set(pluginId, { ...current(pluginId), ...patch });
      for (const listener of [...listeners]) listener();
    },
    [pluginId],
  );
  return [state, update];
}
