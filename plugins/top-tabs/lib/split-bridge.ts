// Each destination's split support, carried from the sidebar header to the
// strip.
//
// `experimental_useSidebarNavigationSplit(id)` belongs with the navigation
// hook: it answers inside the sidebar's slots, where bb knows the items. The
// header bridge renders one publisher per destination (see NavBridge), and
// the strip reads the results here: the drag handler that hands a tab to
// bb's split gesture, and which panes show the destination. A publisher that unmounts takes its entry with it, so a stale
// handler is never called.
import { useSyncExternalStore } from "react";
import type { ExperimentalSidebarNavigationSplit } from "@get-bb/plugin-sdk/app";

let splits: ReadonlyMap<string, ExperimentalSidebarNavigationSplit> = new Map();
const listeners = new Set<() => void>();

function emit(next: ReadonlyMap<string, ExperimentalSidebarNavigationSplit>): void {
  splits = next;
  for (const listener of listeners) listener();
}

export function publishSplit(id: string, split: ExperimentalSidebarNavigationSplit): void {
  if (splits.get(id) === split) return;
  emit(new Map(splits).set(id, split));
}

export function retireSplit(id: string): void {
  if (!splits.has(id)) return;
  const next = new Map(splits);
  next.delete(id);
  emit(next);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useBridgedSplits(): ReadonlyMap<string, ExperimentalSidebarNavigationSplit> {
  return useSyncExternalStore(subscribe, () => splits);
}
