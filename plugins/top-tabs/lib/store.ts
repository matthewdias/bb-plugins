// The strip's state, shared by the strip, the sidebar rows and the palette
// commands, and kept in localStorage.
//
// Tabs are per client, like a browser's: the strip on your phone is not the
// strip on your desktop. Windows of one browser share the stored copy and the
// last one to change it wins on the next reload; they do not follow each
// other live, because a tab closing in a window you are not looking at would
// be stranger than one surviving there.
import { useSyncExternalStore } from "react";
import { EMPTY_STATE, parseState, type TabsState } from "./tabs-model.ts";

let state: TabsState = EMPTY_STATE;
let storageKey: string | null = null;
const listeners = new Set<() => void>();

/** Load the stored state. Idempotent; the plugin id keys the entry. */
export function initStore(pluginId: string): void {
  if (storageKey !== null) return;
  storageKey = `${pluginId}:tabs:v1`;
  try {
    const raw = localStorage.getItem(storageKey);
    state = raw === null ? EMPTY_STATE : parseState(JSON.parse(raw));
  } catch {
    state = EMPTY_STATE;
  }
}

export function getState(): TabsState {
  return state;
}

export function update(change: (current: TabsState) => TabsState): void {
  const next = change(state);
  if (next === state) return;
  state = next;
  if (storageKey !== null) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      // Storage full or blocked: the strip still works, it just forgets.
    }
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTabsState(): TabsState {
  return useSyncExternalStore(subscribe, getState);
}
