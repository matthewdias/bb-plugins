// bb's navigation, carried from Top Tabs' sidebar navigation to the strip.
//
// bb hands its navigation model only to components inside the sidebar:
// outside it, `experimental_useSidebarNavigation` returns no items. So Top
// Tabs registers a sidebar navigation that draws nothing
// (components/NavProvider). While bb shows it, it publishes the model here,
// with which split pane holds each destination, and the strip, an app
// overlay, draws from that. When the user chooses another navigation, bb
// unmounts it and the strip steps aside.
//
// The items are also kept in localStorage, with a note that Top Tabs was the
// navigation, so a window that loads before the provider has drawn starts
// with its tabs. That list is for first paint only: if no provider mounts
// within GRACE_MS, the strip hides, as it would for any other navigation.
import { useSyncExternalStore } from "react";
import type {
  ExperimentalSidebarNavigationAction,
  ExperimentalSidebarNavigationItem,
  ExperimentalSidebarNavigationState,
} from "@get-bb/plugin-sdk/app";

/**
 * One of bb's navigation items, or the strip's own Settings, whose action
 * kind (`open-settings`) bb never sends (see components/destinations).
 */
export type NavItem = Omit<ExperimentalSidebarNavigationItem, "action"> & {
  action: ExperimentalSidebarNavigationAction | { kind: "open-settings" };
};

export type NavActions = Pick<ExperimentalSidebarNavigationState["actions"], "activate" | "openDetails">;

export interface NavState {
  items: readonly NavItem[];
  activeItemId: string | null;
  isShortcutModifierHeld: boolean;
  actions: NavActions;
}

/** What bb's split hook says about one destination. */
export interface ItemSplit {
  /** Whether the destination can open in a pane right now. */
  isAvailable: boolean;
  /** The panes showing it. */
  paneIds: readonly string[];
}

export interface BridgedNavigation {
  state: NavState;
  /** False for the list restored at load, before the provider has published. */
  live: boolean;
  splits: ReadonlyMap<string, ItemSplit>;
}

/** How long a restored list waits for the provider before the strip hides. */
export const GRACE_MS = 2000;
/**
 * How long the strip stays after the provider unmounts, so bb swapping one
 * mount for another (a reload of the plugin, a crash fallback) does not
 * flash the page without it.
 */
export const HIDE_DELAY_MS = 250;

const SNAPSHOT_LIMIT = 200;

interface Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface BridgeOptions {
  storage: () => Storage | null;
  setTimer: (run: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
}

/** Actions for a list no provider is behind: none of them can do anything. */
const STALE_ACTIONS: NavActions = {
  activate() {},
  openDetails() {},
};

const NO_SPLITS: ReadonlyMap<string, ItemSplit> = new Map();

export function createNavigationBridge(options: BridgeOptions) {
  let current: BridgedNavigation | null = null;
  let mounted = 0;
  let snapshotKey: string | null = null;
  let activeKey: string | null = null;
  let lastSnapshot = "";
  let splits: ReadonlyMap<string, ItemSplit> = NO_SPLITS;
  let timer: unknown = null;
  const listeners = new Set<() => void>();

  const set = (next: BridgedNavigation | null) => {
    current = next;
    for (const listener of listeners) listener();
  };

  const stopTimer = () => {
    if (timer !== null) options.clearTimer(timer);
    timer = null;
  };

  const write = (key: string | null, value: string | null) => {
    if (key === null) return;
    try {
      const storage = options.storage();
      if (value === null) storage?.removeItem(key);
      else storage?.setItem(key, value);
    } catch {
      // Storage full or blocked: the strip just starts empty next time.
    }
  };

  const persist = (items: readonly NavItem[]) => {
    const snapshot = JSON.stringify(items.slice(0, SNAPSHOT_LIMIT).map(snapshotItem));
    if (snapshot === lastSnapshot) return;
    lastSnapshot = snapshot;
    write(snapshotKey, snapshot);
  };

  /** No provider is showing: the strip goes, and the next load starts without it. */
  const hide = () => {
    stopTimer();
    splits = NO_SPLITS;
    write(activeKey, null);
    if (current !== null) set(null);
  };

  return {
    /**
     * Key storage by plugin id and, if no provider has published in this
     * window and Top Tabs was the navigation last time, start from the list
     * it saw then. Idempotent.
     */
    restore(pluginId: string): void {
      if (snapshotKey !== null) return;
      snapshotKey = `${pluginId}:nav:v1`;
      activeKey = `${pluginId}:nav-active:v1`;
      if (mounted > 0) {
        write(activeKey, "1");
        if (current !== null) persist(current.state.items);
        return;
      }
      let items: NavItem[] = [];
      try {
        const storage = options.storage();
        if (storage?.getItem(activeKey) !== "1") return;
        const raw = storage.getItem(snapshotKey);
        if (raw === null) return;
        lastSnapshot = raw;
        items = parseSnapshot(JSON.parse(raw));
      } catch {
        // A corrupt snapshot is no snapshot.
      }
      if (items.length === 0) return;
      set({
        state: { items, activeItemId: null, isShortcutModifierHeld: false, actions: STALE_ACTIONS },
        live: false,
        splits: NO_SPLITS,
      });
      timer = options.setTimer(() => {
        timer = null;
        if (mounted === 0) hide();
      }, GRACE_MS);
    },

    /**
     * Top Tabs' navigation is on screen. Returns its unmount. A hide already
     * waiting finds a provider mounted and does nothing.
     */
    providerMounted(): () => void {
      mounted++;
      write(activeKey, "1");
      return () => {
        mounted--;
        if (mounted > 0) return;
        stopTimer();
        timer = options.setTimer(() => {
          timer = null;
          if (mounted === 0) hide();
        }, HIDE_DELAY_MS);
      };
    },

    publish(state: NavState): void {
      if (mounted === 0) return;
      if (current?.state === state && current.live) return;
      set({ state, live: true, splits });
      persist(state.items);
    },

    /** What the split hook says about `id`, or null when its item is gone. */
    setSplit(id: string, split: ItemSplit | null): void {
      const before = splits.get(id);
      if (split === null ? before === undefined : before !== undefined && sameSplit(before, split)) return;
      const next = new Map(splits);
      if (split === null) next.delete(id);
      else next.set(id, split);
      splits = next;
      if (current?.live) set({ ...current, splits });
    },

    get(): BridgedNavigation | null {
      return current;
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export type NavigationBridge = ReturnType<typeof createNavigationBridge>;

function sameSplit(a: ItemSplit, b: ItemSplit): boolean {
  return (
    a.isAvailable === b.isAvailable &&
    a.paneIds.length === b.paneIds.length &&
    a.paneIds.every((id, index) => id === b.paneIds[index])
  );
}

// ------------------------------------------------------------ snapshot

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

const isString = (value: unknown): value is string => typeof value === "string" && value.length <= 512;

const HOST_ICONS = new Set(["extensions", "new-thread", "search", "skills"]);

function parseIcon(raw: unknown): NavItem["icon"] | null {
  if (typeof raw !== "object" || raw === null) return null;
  const icon = raw as Record<string, unknown>;
  if (icon.kind === "host" && isString(icon.name) && HOST_ICONS.has(icon.name)) {
    return { kind: "host", name: icon.name as "extensions" | "new-thread" | "search" | "skills" };
  }
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
export function parseSnapshot(raw: unknown): NavItem[] {
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
      badge: null,
    });
  }
  return items;
}

// ------------------------------------------------------------ the window's bridge

export const navigation = createNavigationBridge({
  storage: () => (typeof localStorage === "undefined" ? null : localStorage),
  setTimer: (run, ms) => window.setTimeout(run, ms),
  clearTimer: (handle) => window.clearTimeout(handle as number),
});

export function useBridgedNavigation(): BridgedNavigation | null {
  return useSyncExternalStore(navigation.subscribe, navigation.get);
}
