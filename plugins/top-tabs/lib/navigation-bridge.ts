// bb's navigation items, carried from the sidebar header to the strip.
//
// `experimental_useSidebarNavigation()` only has data inside the sidebar's
// own slots: called from an app overlay it returns no items, and its actions
// belong to the component that called it. So a header slot component that
// draws nothing (components/NavBridge) publishes what it sees, and the strip
// reads it here.
//
// bb does not mount the header on every page (Settings has its own). The
// strip keeps the last items it was given so its tabs stay put, but marks
// them stale: the active item no longer describes the route, and the actions
// do nothing once their component is gone, so the strip navigates by path
// instead until the header comes back. When another header is chosen the
// bridge never mounts and the strip runs on what it last saw.
//
// The items are also kept in localStorage, so a window loaded straight onto
// one of those pages still has its tabs. A restored list is stale from the
// start, exactly like a retired one.
import { useSyncExternalStore } from "react";
import type {
  ExperimentalSidebarNavigationItem as NavItem,
  ExperimentalSidebarNavigationState,
} from "@get-bb/plugin-sdk/app";

export interface BridgedNavigation {
  state: ExperimentalSidebarNavigationState;
  /** False once the slot that published `state` has unmounted. */
  live: boolean;
}

let current: BridgedNavigation | null = null;
const listeners = new Set<() => void>();

function set(next: BridgedNavigation | null): void {
  current = next;
  for (const listener of listeners) listener();
}

export function publishNavigation(state: ExperimentalSidebarNavigationState): void {
  if (current?.state === state && current.live) return;
  set({ state, live: true });
  persist(state.items);
}

/** The slot unmounted: keep its items, stop trusting its route and actions. */
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
    // Storage full or blocked: the strip just starts empty off the slot's pages.
  }
}

const isString = (value: unknown): value is string => typeof value === "string" && value.length <= 512;

function parseIcon(raw: unknown): NavItem["icon"] | null {
  if (typeof raw !== "object" || raw === null) return null;
  const icon = raw as Record<string, unknown>;
  if (icon.kind === "host" && isString(icon.name)) return { kind: "host", name: icon.name } as NavItem["icon"];
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
      experimental_Accessory: null,
    });
  }
  return items;
}

/** Actions for a list no slot is behind: none of them can do anything. */
const STALE_ACTIONS: ExperimentalSidebarNavigationState["actions"] = {
  activate() {},
  setVisible() {},
  setOrder() {},
  openCustomize() {},
  openDetails() {},
  disablePlugin: async () => {},
};

/**
 * Key the snapshot by plugin id, and if no slot has published yet in this
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
