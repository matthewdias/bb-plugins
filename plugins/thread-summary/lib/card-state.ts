// What the card remembers per device.
//
// One thing: whether it is showing. The header button toggles it, and on a
// desktop the choice outlives the thread and the page — every thread you
// switch to shows the card, or none does, until you press the button again.
// It is this device's choice, not the thread's, so it lives in localStorage
// and every card in the window reads the same value. A phone never reads or
// writes it: the drawer there opens only when asked.

export interface DeviceState {
  shown: boolean;
}

export const DEFAULT_STATE: DeviceState = { shown: false };

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

const key = (pluginId: string) => `${pluginId}:shown`;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // Storage can throw outright in a locked-down browser; fall back to defaults.
    return null;
  }
}

export function readState(pluginId: string, store: Storage | null = storage()): DeviceState {
  try {
    return { shown: store?.getItem(key(pluginId)) === "true" };
  } catch {
    return DEFAULT_STATE;
  }
}

export function writeState(pluginId: string, patch: Partial<DeviceState>, store: Storage | null = storage()): void {
  try {
    if (patch.shown !== undefined) store?.setItem(key(pluginId), String(patch.shown));
  } catch {
    // A full or refused store keeps the choice for this session only.
  }
}
