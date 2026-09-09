// Per-thread state for the composer banner.
//
// This began as shared state for two slots — a count pill in `actions` and the
// card in `banners` — which needed no kv or realtime to stay in sync, because
// both shipped in the same app bundle and so shared module scope. The pill is
// gone: the banner shrinks to a summary line instead of unmounting, so it can
// own its own fetching.
//
// What is left still does not belong in component state. Collapse is a
// per-thread choice that must survive switching threads and coming back.
import { useSyncExternalStore } from "react";
import { AUTO_COLLAPSE_AT, rowsEqual, type FollowUp } from "../lib/followups.ts";

/**
 * The live threshold, which the setting moves.
 *
 * Module scope rather than context for the same reason the rest of this file
 * is: `derive` is called from a `useSyncExternalStore` selector and from
 * `toggleCollapsed`, which is an event handler, and neither can read a hook.
 * The banner pushes the setting in — see `setAutoCollapseAt` — so the value is
 * whatever was last published, falling back to the shipped default until the
 * settings load.
 */
let autoCollapseAt: number = AUTO_COLLAPSE_AT;

/**
 * Publish the configured threshold.
 *
 * Notifies only on a real change: this is called from a render effect on every
 * settings read, and re-notifying on an unchanged value would wake every
 * subscriber for nothing.
 */
export function setAutoCollapseAt(next: number): void {
  if (!Number.isFinite(next) || next < 0 || next === autoCollapseAt) return;
  autoCollapseAt = next;
  notify();
}

type ThreadState = {
  rows: FollowUp[];
  done: FollowUp[];
  /** undefined = follow the collapse threshold; a boolean is an explicit choice. */
  collapsed: boolean | undefined;
  /** Done starts folded away: it is a record, not a to-do list. */
  showDone: boolean;
};

const EMPTY: ThreadState = { rows: [], done: [], collapsed: undefined, showDone: false };

const byThread = new Map<string, ThreadState>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function stateFor(threadId: string | null): ThreadState {
  if (threadId === null) return EMPTY;
  return byThread.get(threadId) ?? EMPTY;
}

export function setRows(threadId: string, rows: FollowUp[], done: FollowUp[] = []): void {
  const current = stateFor(threadId);
  // Referential equality matters: useSyncExternalStore re-renders on identity
  // change, so an unchanged fetch must not produce a new object.
  // Whole-row, not a named subset. This used to compare id, sentAt and doneAt
  // only, which meant every other field changed on the server and never reached
  // this banner: a row being described, a handoff coming back, an amended text.
  // The panel has its own fetch and no store, which is why those states showed
  // there and not here.
  if (rowsEqual(current.rows, rows) && rowsEqual(current.done, done)) return;
  byThread.set(threadId, { ...current, rows, done });
  notify();
}

export function toggleShowDone(threadId: string): void {
  const current = stateFor(threadId);
  byThread.set(threadId, { ...current, showDone: !current.showDone });
  notify();
}

/**
 * Set the collapse state outright, for callers that know which state they
 * want rather than the opposite of the current one — opening the panel
 * collapses the banner whether or not it was open.
 */
export function setCollapsed(threadId: string, collapsed: boolean): void {
  const current = stateFor(threadId);
  if (current.collapsed === collapsed) return;
  byThread.set(threadId, { ...current, collapsed });
  notify();
}

export function toggleCollapsed(threadId: string): void {
  const current = stateFor(threadId);
  const effective = current.collapsed ?? current.rows.length > autoCollapseAt;
  byThread.set(threadId, { ...current, collapsed: !effective });
  notify();
}

type PublicState = {
  rows: FollowUp[];
  done: FollowUp[];
  collapsed: boolean;
  showDone: boolean;
};

/** `collapsed` is stored as a tri-state, so resolve it in exactly one place. */
function derive(state: ThreadState): PublicState {
  return {
    rows: state.rows,
    done: state.done,
    collapsed: state.collapsed ?? state.rows.length > autoCollapseAt,
    showDone: state.showDone,
  };
}

/** Rows plus the effective collapse state for one thread. */
export function useFollowUpState(threadId: string | null): PublicState {
  return derive(
    useSyncExternalStore(
      subscribe,
      () => stateFor(threadId),
      () => EMPTY,
    ),
  );
}

/**
 * The same view, read once, for callbacks that cannot use hooks — the + menu
 * item's `disabled` predicate and `run`. Safe because the banner slot stays
 * mounted and fetching even on a thread with nothing to show: it returns null
 * from the render, not before the hooks.
 */
export function peekFollowUpState(threadId: string | null): PublicState {
  return derive(stateFor(threadId));
}
