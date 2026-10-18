// The strip's line to bb's navigation, read off the navigation rail.
//
// bb 0.46 made the rail its only sidebar layout and removed the plugin API
// the strip used to read navigation through (`experimental_sidebarHeader`
// and `experimental_useSidebarNavigation`). The rail still draws from the
// same model, though: every destination, hidden ones included, the active
// id, and `activate`, which takes `openInSplit` as the old actions did. The
// rail provides that model to its rows through React context, so the strip
// walks up from the rail's element to the provider and reads the value there.
//
// None of this is a supported API. The value is checked against the shape
// the strip needs (lib/nav-types.ts), and when the rail is missing or the
// shape has changed the strip carries on as it does off a page without the
// old header: on its last known list, navigating by path.
import type { NavItem, NavState } from "./nav-types.ts";

const RAIL_SELECTOR = '[data-testid="app-nav-rail"]';
const RAIL_ITEM_ATTR = "data-nav-rail-item";
/** How far above the rail's element the provider may be. It sat 7 up in 0.46.1. */
const MAX_DEPTH = 80;
/** Re-read even without a change on screen: hiding an item draws nothing new. */
const POLL_MS = 1000;

/** The parts of a React fiber the walk reads. */
export interface FiberLike {
  return: FiberLike | null;
  alternate: FiberLike | null;
  tag: number;
  stateNode: unknown;
  memoizedProps: unknown;
}

const HOST_ROOT = 3;

export function fiberOf(element: Element): FiberLike | null {
  for (const key of Object.keys(element)) {
    if (key.startsWith("__reactFiber$")) return (element as unknown as Record<string, FiberLike>)[key] ?? null;
  }
  return null;
}

/**
 * React keeps two copies of each fiber and swaps them on every commit, and an
 * element can point at either. The one whose ancestors lead to the root's
 * current tree holds the latest props.
 */
export function currentOf(fiber: FiberLike): FiberLike {
  let top = fiber;
  while (top.return !== null) top = top.return;
  const isCurrent =
    top.tag === HOST_ROOT && (top.stateNode as { current?: unknown } | null)?.current === top;
  return isCurrent || fiber.alternate === null ? fiber : fiber.alternate;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

function readItem(raw: unknown): NavItem | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.label !== "string") return null;
  const { icon, action, shortcut } = raw;
  if (!isRecord(icon) || !isRecord(action) || typeof action.kind !== "string") return null;
  let navIcon: NavItem["icon"];
  if (icon.kind === "host" && typeof icon.name === "string") navIcon = { kind: "host", name: icon.name };
  else if (icon.kind === "plugin" && typeof icon.pluginId === "string") {
    navIcon = { kind: "plugin", pluginId: icon.pluginId, icon: typeof icon.icon === "string" ? icon.icon : null };
  } else return null;
  let navAction: NavItem["action"];
  if (action.kind === "open-plugin-panel") {
    if (typeof action.pluginId !== "string" || typeof action.panelId !== "string") return null;
    navAction = { kind: "open-plugin-panel", pluginId: action.pluginId, panelId: action.panelId };
  } else navAction = { kind: action.kind };
  return {
    id: raw.id,
    label: raw.label,
    icon: navIcon,
    action: navAction,
    isVisible: raw.isVisible === true,
    isDisabled: raw.isDisabled === true,
    isLoading: raw.isLoading === true,
    pluginId: typeof raw.pluginId === "string" ? raw.pluginId : null,
    shortcut:
      isRecord(shortcut) && typeof shortcut.label === "string" && typeof shortcut.ariaKeyShortcuts === "string"
        ? { label: shortcut.label, ariaKeyShortcuts: shortcut.ariaKeyShortcuts }
        : null,
  };
}

/**
 * The navigation state inside a context value, or null when the value is not
 * bb's navigation model. Items that do not fit are dropped, not trusted.
 */
export function readNavState(value: unknown): NavState | null {
  if (!isRecord(value) || !isRecord(value.state)) return null;
  const { items, activeItemId, actions, isShortcutModifierHeld } = value.state;
  if (!Array.isArray(items) || !isRecord(actions)) return null;
  const { activate, openDetails } = actions;
  if (typeof activate !== "function" || typeof openDetails !== "function") return null;
  if (activeItemId !== null && typeof activeItemId !== "string") return null;
  return {
    items: items.map(readItem).filter((item): item is NavItem => item !== null),
    activeItemId,
    isShortcutModifierHeld: isShortcutModifierHeld === true,
    actions: {
      activate: (id, options) => activate.call(actions, id, options),
      openDetails: (id) => openDetails.call(actions, id),
    },
  };
}

/** Walk up from `fiber` to the first provider whose value is the navigation model. */
export function findNavState(fiber: FiberLike | null): NavState | null {
  let node = fiber === null ? null : currentOf(fiber);
  for (let depth = 0; node !== null && depth < MAX_DEPTH; depth++) {
    const props = node.memoizedProps;
    if (isRecord(props) && "value" in props) {
      const state = readNavState(props.value);
      if (state !== null) return state;
    }
    node = node.return;
  }
  return null;
}

/** Everything about a state that changes what the strip draws. */
export function navKey(state: NavState): string {
  return JSON.stringify([
    state.activeItemId,
    state.isShortcutModifierHeld,
    state.items.map((item) => [
      item.id,
      item.label,
      item.icon,
      item.action,
      item.isVisible,
      item.isDisabled,
      item.isLoading,
      item.pluginId,
      item.shortcut,
    ]),
  ]);
}

// ------------------------------------------------------------ the page

export function findRail(): Element | null {
  return document.querySelector(RAIL_SELECTOR);
}

/**
 * The artwork the rail draws for an item, kept from the last time it was on
 * the rail, so a tab shows exactly what bb shows, plugin branding included.
 * Items hidden from the rail are not drawn there and have none.
 */
const iconMarkup = new Map<string, string>();
const iconListeners = new Set<() => void>();

function collectIcons(rail: Element): void {
  let changed = false;
  for (const holder of Array.from(rail.querySelectorAll(`[${RAIL_ITEM_ATTR}]`))) {
    const id = holder.getAttribute(RAIL_ITEM_ATTR);
    // An icon from bb's set is an <svg>; a plugin's branding image is a span
    // that masks it (`data-plugin-icon-asset`).
    const art = holder.querySelector("button [data-icon-root], button svg, button img");
    if (id === null || art === null) continue;
    const markup = art.outerHTML;
    if (iconMarkup.get(id) === markup) continue;
    iconMarkup.set(id, markup);
    changed = true;
  }
  if (changed) for (const listener of iconListeners) listener();
}

export function railIcon(id: string): string | null {
  return iconMarkup.get(id) ?? null;
}

export function subscribeRailIcons(listener: () => void): () => void {
  iconListeners.add(listener);
  return () => iconListeners.delete(listener);
}

/**
 * Follow the rail's model: `onState` gets each new state, and null when the
 * rail is gone or no longer offers a model the strip understands. It is
 * called only when something the strip draws has changed.
 */
export function watchRail(onState: (state: NavState | null) => void): () => void {
  let rail: Element | null = null;
  let observer: MutationObserver | null = null;
  let lastKey: string | null | undefined;
  // The actions belong to the render that produced them. The state handed
  // out keeps one stable pair that calls the newest, so it need not be
  // republished, and the strip re-rendered, every time bb renders the rail.
  let latest: NavState["actions"] | null = null;
  const actions: NavState["actions"] = {
    activate: (id, options) => latest?.activate(id, options),
    openDetails: (id) => latest?.openDetails(id),
  };

  const read = () => {
    const found = findRail();
    if (found !== rail) {
      observer?.disconnect();
      observer = null;
      rail = found;
      if (rail !== null) {
        observer = new MutationObserver(read);
        observer.observe(rail, { subtree: true, childList: true, attributes: true });
      }
    }
    const state = rail === null ? null : findNavState(fiberOf(rail));
    if (rail !== null) collectIcons(rail);
    latest = state?.actions ?? null;
    const key = state === null ? null : navKey(state);
    if (key === lastKey) return;
    lastKey = key;
    onState(state === null ? null : { ...state, actions });
  };

  read();
  const timer = window.setInterval(read, POLL_MS);
  return () => {
    window.clearInterval(timer);
    observer?.disconnect();
  };
}

/**
 * Which destination each split pane shows, by the plugin page inside it.
 * A pane is matched only when one destination belongs to that plugin; bb
 * no longer says which of a plugin's several panels a pane holds.
 */
export function destinationPanes(items: readonly NavItem[]): Map<string, string[]> {
  const byPlugin = new Map<string, NavItem[]>();
  for (const item of items) {
    if (item.action.kind !== "open-plugin-panel" || item.action.pluginId === undefined) continue;
    const list = byPlugin.get(item.action.pluginId) ?? [];
    list.push(item);
    byPlugin.set(item.action.pluginId, list);
  }
  const panes = new Map<string, string[]>();
  for (const pane of Array.from(document.querySelectorAll("[data-split-pane-id]"))) {
    const paneId = pane.getAttribute("data-split-pane-id");
    const pluginId = pane.querySelector("[data-bb-plugin-root][data-bb-plugin]")?.getAttribute("data-bb-plugin");
    const owners = pluginId == null ? undefined : byPlugin.get(pluginId);
    if (paneId === null || owners === undefined || owners.length !== 1) continue;
    const id = owners[0]!.id;
    panes.set(id, [...(panes.get(id) ?? []), paneId]);
  }
  return panes;
}
