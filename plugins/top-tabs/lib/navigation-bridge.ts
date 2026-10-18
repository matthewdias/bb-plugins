// bb's navigation items, carried from the rail to the strip.
//
// lib/rail.ts reads them off bb's navigation rail and publishes them here.
// When the rail is gone, or stops offering a model the strip understands,
// the strip keeps the last items it was given so its tabs stay put, but
// marks them stale: the active item no longer describes the route and the
// actions cannot be trusted, so the strip navigates by path instead until
// the rail comes back.
//
// The items are also kept in localStorage, so a window that loads before the
// rail has drawn still has its tabs. A restored list is stale from the
// start, exactly like a retired one.
import { useSyncExternalStore } from "react";
import type { NavItem, NavState } from "./nav-types.ts";

export interface BridgedNavigation {
  state: NavState;
  /** False once the rail that published `state` is gone. */
  live: boolean;
}

let current: BridgedNavigation | null = null;
const listeners = new Set<() => void>();

function set(next: BridgedNavigation | null): void {
  current = next;
  for (const listener of listeners) listener();
}

export function publishNavigation(state: NavState): void {
  if (current?.state === state && current.live) return;
  set({ state, live: true });
  persist(state.items);
}

/** The rail went away: keep its items, stop trusting its route and actions. */
export function retireNavigation(): void {
  if (current === null || !current.live) return;
  set({ state: current.state, live: false });
}

// ------------------------------------------------------------ snapshot

const SNAPSHOT_LIMIT = 200;
let snapshotKey: string | null = null;
let lastSnapshot = "";

/** The parts of an item that mean the same after a reload. */
function snapshotItem(item: NavItem) {
  return {
    id: item.id,
    label: item.label,
    icon: item.icon,
    action: item.action,
    isVisible: item.isVisible,
    pluginId: item.pluginId,
    shortcut: item.shortcut,
  };
}

function persist(items: readonly NavItem[]): void {
  if (snapshotKey === null) return;
  const snapshot = JSON.stringify(items.slice(0, SNAPSHOT_LIMIT).map(snapshotItem));
  if (snapshot === lastSnapshot) return;
  lastSnapshot = snapshot;
  try {
    localStorage.setItem(snapshotKey, snapshot);
  } catch {
    // Storage full or blocked: the strip just starts empty until the rail draws.
  }
}

const isString = (value: unknown): value is string => typeof value === "string" && value.length <= 512;

function parseIcon(raw: unknown): NavItem["icon"] | null {
  if (typeof raw !== "object" || raw === null) return null;
  const icon = raw as Record<string, unknown>;
  if (icon.kind === "host" && isString(icon.name)) return { kind: "host", name: icon.name };
  if (icon.kind === "plugin" && isString(icon.pluginId) && (icon.icon === null || isString(icon.icon))) {
    return { kind: "plugin", pluginId: icon.pluginId, icon: icon.icon as string | null };
  }
  return null;
}

function parseAction(raw: unknown): NavItem["action"] | null {
  if (typeof raw !== "object" || raw === null) return null;
  const action = raw as Record<string, unknown>;
  if (!isString(action.kind)) return null;
  if (action.kind === "open-plugin-panel") {
    if (!isString(action.pluginId) || !isString(action.panelId)) return null;
    return { kind: "open-plugin-panel", pluginId: action.pluginId, panelId: action.panelId };
  }
  return { kind: action.kind } as NavItem["action"];
}

/** Items read back from storage, which anything on the page can write. */
function parseSnapshot(raw: unknown): NavItem[] {
  if (!Array.isArray(raw)) return [];
  const items: NavItem[] = [];
  for (const entry of raw.slice(0, SNAPSHOT_LIMIT)) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const icon = parseIcon(record.icon);
    const action = parseAction(record.action);
    if (!isString(record.id) || !isString(record.label) || icon === null || action === null) continue;
    const shortcut =
      typeof record.shortcut === "object" &&
      record.shortcut !== null &&
      isString((record.shortcut as Record<string, unknown>).label) &&
      isString((record.shortcut as Record<string, unknown>).ariaKeyShortcuts)
        ? (record.shortcut as NavItem["shortcut"])
        : null;
    items.push({
      id: record.id,
      label: record.label,
      icon,
      action,
      isVisible: record.isVisible === true,
      pluginId: isString(record.pluginId) ? record.pluginId : null,
      shortcut,
      isDisabled: false,
      isLoading: false,
    });
  }
  return items;
}

/** Actions for a list no rail is behind: none of them can do anything. */
const STALE_ACTIONS: NavState["actions"] = {
  activate() {},
  openDetails() {},
};

/**
 * Key the snapshot by plugin id, and if the rail has not published yet in this
 * window, start from the last list it saw. Idempotent.
 */
export function restoreNavigation(pluginId: string): void {
  if (snapshotKey !== null) return;
  snapshotKey = `${pluginId}:nav:v1`;
  if (current !== null) {
    persist(current.state.items);
    return;
  }
  try {
    const raw = localStorage.getItem(snapshotKey);
    if (raw === null) return;
    lastSnapshot = raw;
    const items = parseSnapshot(JSON.parse(raw));
    if (items.length === 0) return;
    set({
      state: { items, activeItemId: null, isShortcutModifierHeld: false, actions: STALE_ACTIONS },
      live: false,
    });
  } catch {
    // A corrupt snapshot is no snapshot.
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useBridgedNavigation(): BridgedNavigation | null {
  return useSyncExternalStore(subscribe, () => current);
}
