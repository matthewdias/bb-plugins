// Tab Nav's state, shared by the rail and the palette commands, and kept in
// localStorage.
//
// Tabs are per client, like a browser's: the tabs on your phone are not the
// tabs on your desktop. Windows of one browser share the stored copy and the
// last one to change it wins on the next reload; they do not follow each
// other live, because a tab closing in a window you are not looking at would
// be stranger than one surviving there.
import { useSyncExternalStore } from "react";
import { EMPTY_STATE, parseState, type TabsState } from "./tabs-model.ts";

let state: TabsState = EMPTY_STATE;
let storageKey: string | null = null;
/** Whether the rail shows names: wide, or icons only. Per client, as the tabs are. */
let wide = false;
let wideKey: string | null = null;
const listeners = new Set<() => void>();

/** Load the stored state. Idempotent; the plugin id keys the entry. */
export function initStore(pluginId: string): void {
  if (storageKey !== null) return;
  storageKey = `${pluginId}:tabs:v1`;
  wideKey = `${pluginId}:wide:v1`;
  try {
    const raw = localStorage.getItem(storageKey);
    state = raw === null ? EMPTY_STATE : parseState(JSON.parse(raw));
  } catch {
    state = EMPTY_STATE;
  }
  try {
    wide = localStorage.getItem(wideKey) === "1";
  } catch {
    wide = false;
  }
}

export function isWide(): boolean {
  return wide;
}

/** Show the rail's names, or icons only. */
export function setWide(next: boolean): void {
  if (next === wide) return;
  wide = next;
  if (wideKey !== null) {
    try {
      localStorage.setItem(wideKey, next ? "1" : "0");
    } catch {
      // Storage blocked: the width holds until the next reload.
    }
  }
  for (const listener of listeners) listener();
}

export function useWide(): boolean {
  return useSyncExternalStore(subscribe, isWide);
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
      // Storage full or blocked: the tabs still work, they just forget.
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
