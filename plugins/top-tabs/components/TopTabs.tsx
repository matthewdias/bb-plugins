// The strip: Threads, the open destination tabs, and the button that opens
// more. Mounted once per window as an app overlay, so it sits above every
// route and survives every navigation.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import {
  experimental_usePluginId,
  experimental_useSidebarThreadActions,
  experimental_useSidebarThreads,
  useBbNavigate,
  useSettings,
  useSidebarSplitLayout,
  type ExperimentalSidebarNavigationItem as NavItem,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { publishController } from "../lib/controller.ts";
import { useReservesTrafficLights } from "../lib/desktop.ts";
import { currentPath, navigateToPath, subscribeLocation } from "../lib/location.ts";
import { restoreNavigation, useBridgedNavigation } from "../lib/navigation-bridge.ts";
import {
  COMPACT_QUERY,
  closePane,
  interceptPageClose,
  isSidebarOpen,
  observeSidebar,
  toggleSidebar,
} from "../lib/shell.ts";
import { useBridgedSplits } from "../lib/split-bridge.ts";
import { getState, initStore, update, useTabsState } from "../lib/store.ts";
import {
  SETTINGS,
  THREADS,
  activeTabFor,
  adopt,
  close,
  closeOthers,
  closeToRight,
  cycle,
  defaultPathFor,
  leavesSettings,
  pin,
  panesOf,
  panesOnScreen,
  pathFits,
  recordPath,
  recordRecent,
  recordRecentThread,
  reopen,
  seed,
  sidebarStep,
  splitPartner,
  stripTakesPageClose,
  successorAfterClose,
  threadIdFromPath,
  threadPaneFor,
  unpin,
  type RouteTarget,
  type ScreenPane,
  type TabId,
} from "../lib/tabs-model.ts";
import { CloseGlyph, PaneMap, ThreadsGlyph } from "./glyphs.tsx";
import { TabIcon, destinationsOf } from "./destinations.tsx";
import { TabMenu, TabPicker, type SplitAction, type TabMenuProps } from "./menus.tsx";
import { ThreadsLabel, ThreadsStatus } from "./threads-tab.tsx";
import { SwitcherTrigger, ThreadSwitcher } from "./thread-switcher.tsx";
import { useTabDrag, type SplitHooks } from "./use-tab-drag.ts";

/** How long the nav items must sit still before the first-run seed reads them. */
const SEED_SETTLE_MS = 1500;

/** How long after the strip starts a switch the route change still counts as its. */
const STRIP_MOVE_MS = 2000;

/** Set on <html> while the strip is on screen; top-tabs.css makes room for it. */
const ON_CLASS = "bb-top-tabs-on";
/** Set on <html> while the strip leaves the corner to macOS traffic lights. */
const TRAFFIC_LIGHTS_CLASS = "bb-top-tabs-traffic-lights";

type LabelMode = "always" | "active" | "never";

/** The `tabLabels` setting, read defensively: an unknown value shows labels. */
function labelModeOf(value: unknown): LabelMode {
  if (value === "Never") return "never";
  if (value === "Active tab only") return "active";
  return "always";
}

const NO_ITEMS: readonly NavItem[] = [];

function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}

function routeTarget(item: NavItem): RouteTarget {
  const { action } = item;
  return action.kind === "open-plugin-panel"
    ? { id: item.id, kind: action.kind, pluginId: action.pluginId, panelId: action.panelId }
    : { id: item.id, kind: action.kind, pluginId: null, panelId: null };
}

/** A primary-button press with no modifier, from a mouse or pen. */
function isPlainPress(event: ReactPointerEvent): boolean {
  return (
    event.button === 0 &&
    event.pointerType !== "touch" &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

function pathnameOf(path: string): string {
  return path.split(/[?#]/, 1)[0] ?? path;
}

/** Close the split panes these tabs are on screen in. True if any closed. */
function closePanesOf(screen: readonly ScreenPane[] | null, ids: readonly string[]): boolean {
  let closed = false;
  for (const id of ids) {
    for (const pane of panesOf(screen, id)) closed = closePane(pane.paneId) || closed;
  }
  return closed;
}

export function TopTabs() {
  const pluginId = experimental_usePluginId();
  initStore(pluginId);
  restoreNavigation(pluginId);
  const tabs = useTabsState();
  const bridged = useBridgedNavigation();
  const nav = bridged?.state ?? null;
  const navLive = bridged?.live === true;
  const bbNavigate = useBbNavigate();
  const { values } = useSettings();
  const collapseSidebar = values?.collapseSidebar !== false;
  const closeSettingsOnExit = values?.closeSettingsOnExit !== false;
  const labelMode = labelModeOf(values?.tabLabels);
  const compact = useMediaQuery(COMPACT_QUERY);
  const trafficLights = useReservesTrafficLights();
  const path = useSyncExternalStore(subscribeLocation, currentPath);
  const pathname = pathnameOf(path);
  const splitLayout = useSidebarSplitLayout();
  const splits = useBridgedSplits();
  const { threads } = experimental_useSidebarThreads();
  const threadActions = experimental_useSidebarThreadActions();

  const destinations = useMemo(() => destinationsOf(nav?.items ?? NO_ITEMS), [nav?.items]);
  const byId = useMemo(() => new Map(destinations.map((item) => [item.id, item])), [destinations]);
  const targets = useMemo(() => destinations.map(routeTarget), [destinations]);
  const active = activeTabFor({ activeItemId: navLive ? nav!.activeItemId : null, pathname }, targets);
  // Tabs whose plugin is not loaded (disabled, or still starting) stay in
  // storage but not on screen, so they come back with their plugin.
  const shown = useMemo(() => tabs.open.filter((id) => byId.has(id)), [tabs.open, byId]);

  // What each pane of a split shows, or null when nothing is split.
  const screen = useMemo(() => {
    const destinationPanes = new Map<string, string[]>();
    for (const [id, split] of splits) {
      const paneIds = split.layout?.panes.filter((p) => p.isMe).map((p) => p.paneId) ?? [];
      if (paneIds.length > 0) destinationPanes.set(id, paneIds);
    }
    return panesOnScreen(splitLayout?.panes ?? null, destinationPanes, active);
  }, [splitLayout, splits, active]);
  // bb holding a split at all, on screen or not. The sidebar waits on this
  // rather than on `screen`, which blinks off for a render whenever focus
  // moves between panes.
  const inSplit = (splitLayout?.panes.length ?? 0) > 1;

  // Callbacks below read the latest of these rather than closing over them,
  // so the controller and window listeners never act on a stale strip.
  const live = useRef({ active, byId, shown, nav, navLive, bbNavigate, screen, threads, splits, threadActions, compact, collapseSidebar, inSplit });
  live.current = { active, byId, shown, nav, navLive, bbNavigate, screen, threads, splits, threadActions, compact, collapseSidebar, inSplit };

  // First run: the destinations the sidebar showed become the open tabs.
  // Wait for the list to settle, since plugin panels register as their
  // bundles load and a fresh client briefly lists only bb's own items. The
  // wait is keyed on which items are visible, not on the list object, which
  // bb hands over anew on every render.
  const visibleKey = destinations
    .filter((item) => item.isVisible && item.id !== SETTINGS)
    .map((item) => item.id)
    .join("\n");
  useEffect(() => {
    if (tabs.seeded || visibleKey === "") return;
    const timer = window.setTimeout(() => {
      update((s) => seed(s, visibleKey.split("\n")));
    }, SEED_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [tabs.seeded, visibleKey]);

  // A destination reached any other way — the palette, a shortcut, a link —
  // gets a tab, and every tab remembers where it was left.
  useEffect(() => {
    if (active === null) return;
    // Read the location now rather than from the render: it is the one
    // source that cannot lag behind.
    const here = currentPath();
    const item = byId.get(active);
    const target = item === undefined ? null : routeTarget(item);
    const threadId = active === THREADS ? threadIdFromPath(here) : null;
    update((s) => {
      let next = recordRecent(adopt(s, active), active);
      if (threadId !== null) next = recordRecentThread(next, threadId);
      return pathFits(active, target, pathnameOf(here)) ? recordPath(next, active, here) : next;
    });
  }, [active, path, byId]);

  // The sidebar belongs to Threads; see sidebarStep for the rules. A split is
  // the user's own arrangement, and the sidebar is where they drag threads
  // into it from, so while one is up the strip leaves the sidebar alone.
  const previous = useRef<TabId | null | undefined>(undefined);
  const wasInSplit = useRef(false);

  /**
   * Bring the sidebar in line with a move to `next`. A tab click calls this
   * before it navigates, so the sidebar and the new page arrive in one paint
   * instead of the page rendering at one width and then reflowing to
   * another; navigation from anywhere else is caught by the effect below.
   * Either way it runs once per move, because it records `next` as where
   * the strip now is.
   */
  const syncSidebar = useCallback((next: TabId | null) => {
    const before = previous.current;
    previous.current = next;
    const { compact, collapseSidebar, inSplit } = live.current;
    if (compact || !collapseSidebar || inSplit) return;
    const sidebarOpen = isSidebarOpen();
    if (sidebarOpen === null) return;
    const step = sidebarStep({
      previous: before,
      next,
      sidebarOpen,
      threadsSidebarOpen: getState().threadsSidebarOpen,
    });
    update((s) =>
      s.threadsSidebarOpen === step.threadsSidebarOpen
        ? s
        : { ...s, threadsSidebarOpen: step.threadsSidebarOpen },
    );
    if (step.action !== null) toggleSidebar({ instant: true });
  }, []);

  useEffect(() => {
    // When a split closes, look at what is left afresh, as on first load: the
    // sidebar comes back on Threads and slides away on any other tab.
    if (wasInSplit.current && !inSplit) previous.current = undefined;
    wasInSplit.current = inSplit;
    syncSidebar(active);
  }, [active, compact, collapseSidebar, inSplit, syncSidebar]);

  // While Threads is in view, the user's own toggling is their preference.
  // The strip's toggles happen once another tab is already active, or set
  // the preference they restore, so they never record anything wrong.
  useEffect(() => {
    if (active !== THREADS || compact || !collapseSidebar) return;
    return observeSidebar((open) => {
      if (live.current.active !== THREADS) return;
      update((s) => (s.threadsSidebarOpen === open ? s : { ...s, threadsSidebarOpen: open }));
    });
  }, [active, compact, collapseSidebar]);

  // Close the Settings tab when bb takes the route out of Settings — Escape,
  // Back to app, the browser's back — rather than the strip switching tabs.
  // `activate` marks the strip's own moves; a mark older than a moment is
  // not this move's.
  const stripMove = useRef<{ to: TabId; at: number } | null>(null);
  const lastActive = useRef<TabId | null | undefined>(undefined);
  useEffect(() => {
    const before = lastActive.current;
    lastActive.current = active;
    if (before === active) return;
    const move = stripMove.current;
    stripMove.current = null;
    const byStrip = move !== null && performance.now() - move.at < STRIP_MOVE_MS;
    if (closeSettingsOnExit && leavesSettings(before, active, byStrip)) {
      update((s) => close(s, [SETTINGS]));
    }
  }, [active, closeSettingsOnExit]);

  const activate = useCallback((id: TabId) => {
    const { active, byId, nav, navLive, bbNavigate, screen, threads } = live.current;
    const saved = getState().paths[id];
    // A move the strip makes, for the Settings rule above. Marked only once
    // a move is really happening, so a click on the tab in view leaves no mark.
    const markMove = () => {
      stripMove.current = { to: id, at: performance.now() };
    };
    if (id === THREADS) {
      if (active !== THREADS) markMove();
      // In a split, Threads means the pane already showing a thread: focus
      // it (bb focuses a pane when you navigate to what it shows) rather
      // than replacing whatever the focused pane holds.
      const pane = threadPaneFor(screen, threadIdFromPath(saved));
      if (pane !== null) {
        if (pane.isFocused || active === THREADS) return;
        const href = threads.find((t) => t.id === pane.threadId)?.href;
        if (href !== undefined && navigateToPath(href)) return;
      }
      // No early return for Threads: navigating to the saved location is a
      // no-op when already there, and anywhere else it is the way back.
      if (active !== THREADS) syncSidebar(THREADS);
      if (saved === undefined || !navigateToPath(saved)) bbNavigate.toCompose();
      return;
    }
    const item = byId.get(id);
    if (id === active || item === undefined) return;
    markMove();
    syncSidebar(id);
    update((s) => adopt(s, id));
    if (saved !== undefined && navigateToPath(saved)) return;
    // Settings is the strip's own entry; bb's actions do not know it.
    if (navLive && nav !== null && id !== SETTINGS) {
      nav.actions.activate(id, { openInSplit: false });
      return;
    }
    const fallback = defaultPathFor(routeTarget(item));
    if (fallback !== null) navigateToPath(fallback);
  }, [syncSidebar]);

  // The tab being switched to, drawn as selected before bb has rendered it.
  const [pending, setPending] = useState<TabId | null>(null);
  const pressedThreads = useRef(false);

  /**
   * Switch tabs the way a user sees it: mark the tab selected now, let that
   * paint, then navigate. bb's render of a thread blocks the page for a few
   * hundred milliseconds, and without this the tab would only light up once
   * it finished.
   */
  const activateSoon = useCallback(
    (id: TabId) => {
      setPending(id);
      requestAnimationFrame(() => {
        window.setTimeout(() => {
          setPending(null);
          activate(id);
        }, 0);
      });
    },
    [activate],
  );

  // The Threads tab's hover card; `keyboard` when the command opened it.
  const [switcher, setSwitcher] = useState<{ keyboard: boolean } | null>(null);

  /** Go to one thread from the switcher: Threads, at that thread. */
  const openThread = useCallback(
    (thread: PluginSidebarThread) => {
      const { active, threadActions } = live.current;
      setSwitcher(null);
      stripMove.current = { to: THREADS, at: performance.now() };
      if (active !== THREADS) syncSidebar(THREADS);
      // bb's own open: it focuses the thread's pane if a split shows it.
      threadActions.open(thread.id);
    },
    [syncSidebar],
  );

  const closeTab = useCallback(
    (id: TabId) => {
      // Threads and pinned tabs stay; a pinned tab has to be unpinned first.
      if (id === THREADS || getState().pinned.includes(id)) return;
      const { active, shown, screen } = live.current;
      const next = successorAfterClose(shown, id, active);
      update((s) => close(s, [id]));
      // A tab on screen in a split closes with its pane, and bb chooses which
      // pane takes focus; there is no neighbour to switch to.
      if (closePanesOf(screen, [id])) return;
      if (next !== null && next !== active) activateSoon(next);
    },
    [activateSoon],
  );

  // bb's Close on a lone plugin page would open New Thread and leave the tab
  // open behind Threads; it closes the tab instead, as the tab's own × does.
  useEffect(
    () =>
      interceptPageClose(() => {
        const { active } = live.current;
        if (!stripTakesPageClose(active, getState().pinned)) return false;
        closeTab(active!);
        return true;
      }),
    [closeTab],
  );

  /**
   * Close a batch around an anchor tab. If the tab in view is one of them,
   * the anchor takes its place — the tab the user right-clicked is the one
   * they meant to keep looking at.
   */
  const closeAround = useCallback(
    (anchor: TabId, closing: readonly string[], apply: () => void) => {
      const { active, screen } = live.current;
      apply();
      closePanesOf(screen, closing);
      if (active !== null && closing.includes(active)) activateSoon(anchor);
    },
    [activateSoon],
  );

  const closeOtherTabs = useCallback(
    (keep: TabId) => {
      const { pinned } = getState();
      const closing = live.current.shown.filter((id) => id !== keep && !pinned.includes(id));
      closeAround(keep, closing, () => update((s) => closeOthers(s, keep)));
    },
    [closeAround],
  );

  const closeTabsToRight = useCallback(
    (of: TabId) => {
      const { shown } = live.current;
      const { pinned } = getState();
      const right = of === THREADS ? shown : shown.slice(shown.indexOf(of) + 1);
      const closing = right.filter((id) => !pinned.includes(id));
      closeAround(of, closing, () => update((s) => closeToRight(s, of)));
    },
    [closeAround],
  );

  const reopenTab = useCallback(() => {
    const result = reopen(getState(), (id) => live.current.byId.has(id));
    if (result.tab === null) return;
    update(() => result.state);
    activateSoon(result.tab.id);
  }, [activateSoon]);

  const togglePin = useCallback((id: TabId) => {
    if (id === THREADS) return;
    update((s) => (s.pinned.includes(id) ? unpin(s, id) : pin(s, id)));
  }, []);

  /** Whether `id` can occupy a split pane right now. */
  const canBeInPane = useCallback((id: TabId): boolean => {
    const { byId, navLive, splits } = live.current;
    if (id === THREADS) return threadIdFromPath(getState().paths[THREADS]) !== null;
    const item = byId.get(id);
    // Only plugin panels can sit in a pane, and opening one takes bb's
    // navigation actions, which only work while the header bridge is mounted.
    return (
      item !== undefined &&
      item.action.kind === "open-plugin-panel" &&
      navLive &&
      splits.get(id)?.isAvailable !== false
    );
  }, []);

  /** Put `id` in a new pane beside the focused one. */
  const openInSplit = useCallback((id: TabId) => {
    const { nav, threadActions } = live.current;
    if (id === THREADS) {
      const threadId = threadIdFromPath(getState().paths[THREADS]);
      if (threadId !== null) threadActions.open(threadId, { split: true });
      return;
    }
    nav?.actions.activate(id, { openInSplit: true });
    // bb opens a panel at its root. Once the new pane is in view, take it on
    // to where the tab was left.
    const saved = getState().paths[id];
    if (saved === undefined) return;
    window.setTimeout(() => {
      if (live.current.active === id) navigateToPath(saved);
    }, 150);
  }, []);

  /** The tab to bring in when the user splits the tab they are looking at. */
  const partnerFor = useCallback(
    (id: TabId): TabId | null => {
      const { shown } = live.current;
      const canPair = (other: TabId) =>
        canBeInPane(other) && (other === THREADS || shown.includes(other));
      return splitPartner(id, getState().recent, id === THREADS ? shown : [THREADS], canPair);
    },
    [canBeInPane],
  );

  /**
   * Split the tab in view. bb will not put one destination in two panes, so
   * the tab stays where it is — mounted, scrolled, mid-edit — and its partner
   * opens beside it.
   */
  const splitWithPartner = useCallback(
    (id: TabId) => {
      const partner = partnerFor(id);
      if (partner !== null) openInSplit(partner);
    },
    [openInSplit, partnerFor],
  );

  /** "Split with …" for the tab in view, or null when it cannot be split. */
  const partnerLabelFor = useCallback(
    (id: TabId): string | null => {
      const { active, screen, byId } = live.current;
      if (id !== active || screen !== null) return null;
      if (id !== THREADS && byId.get(id)?.action.kind !== "open-plugin-panel") return null;
      const partner = partnerFor(id);
      if (partner === null) return null;
      return partner === THREADS ? "Threads" : (byId.get(partner)?.label ?? null);
    },
    [partnerFor],
  );

  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(
    () =>
      publishController({
        active: () => live.current.active,
        activate: activateSoon,
        close: closeTab,
        cycle: (direction) => {
          const { active, shown } = live.current;
          activateSoon(cycle([THREADS, ...shown], active, direction));
        },
        reopen: reopenTab,
        openPicker: () => setPickerOpen(true),
        isPinned: (id) => getState().pinned.includes(id),
        togglePin,
        openSwitcher: () => setSwitcher({ keyboard: true }),
      }),
    [activateSoon, closeTab, reopenTab, togglePin],
  );

  // Keep the tab in view visible when the strip scrolls.
  const tabRefs = useRef(new Map<string, HTMLElement>());
  useEffect(() => {
    if (active === null) return;
    tabRefs.current.get(active)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active, shown.length]);

  // Tell top-tabs.css the strip is up, so it makes room for it. A class on
  // <html> rather than `body:has(#bb-top-tabs)`, which restyled the whole page
  // on every change inside the strip.
  useLayoutEffect(() => {
    if (compact) return;
    const root = document.documentElement;
    root.classList.add(ON_CLASS);
    root.classList.toggle(TRAFFIC_LIGHTS_CLASS, trafficLights);
    return () => {
      root.classList.remove(ON_CLASS);
      root.classList.remove(TRAFFIC_LIGHTS_CLASS);
    };
  }, [compact, trafficLights]);

  const stripRef = useRef<HTMLElement>(null);
  const splitHooks = useRef<SplitHooks>({ partnerLabelFor, splitWithPartner });
  splitHooks.current = { partnerLabelFor, splitWithPartner };
  const drag = useTabDrag(tabRefs, live, stripRef, splitHooks);

  const listRef = useRef<HTMLDivElement>(null);
  const onWheel = (event: ReactWheelEvent) => {
    const list = listRef.current;
    if (list === null || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    list.scrollLeft += event.deltaY;
  };

  const onKeyDown = (event: ReactKeyboardEvent) => {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(event.key)) return;
    const buttons = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>(".bb-top-tab-main") ?? [],
    );
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index === -1) return;
    event.preventDefault();
    const target =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[target]?.focus();
  };

  if (compact) return null;

  const splitActionFor = (id: TabId): SplitAction | null => {
    const partnerLabel = partnerLabelFor(id);
    if (partnerLabel !== null) {
      return { label: `Split with ${partnerLabel}`, run: () => splitWithPartner(id) };
    }
    // The tab in view with nothing to pair it with: there is no split to make.
    if (id === active && screen === null) return null;
    if (panesOf(screen, id).length > 0 || !canBeInPane(id)) return null;
    return {
      label: id === THREADS ? "Open thread in split" : "Open in split",
      run: () => openInSplit(id),
    };
  };
  const closable = shown.filter((id) => !tabs.pinned.includes(id));
  const menuFor = (id: TabId): TabMenuProps => ({
    id,
    item: id === THREADS ? null : (byId.get(id) ?? null),
    isPinned: tabs.pinned.includes(id),
    canCloseOthers: closable.some((other) => other !== id),
    canCloseRight:
      id === THREADS
        ? closable.length > 0
        : shown.slice(shown.indexOf(id) + 1).some((other) => closable.includes(other)),
    canReopen: tabs.closed.some((c) => byId.has(c.id) && !tabs.open.includes(c.id)),
    onClose: () => closeTab(id),
    onTogglePin: () => togglePin(id),
    onCloseOthers: () => closeOtherTabs(id),
    onCloseRight: () => closeTabsToRight(id),
    onReopen: reopenTab,
    actionsAvailable: navLive,
    split: splitActionFor(id),
    onDetails: () => nav?.actions.openDetails(id),
  });

  // What the strip draws as selected: the tab being switched to, until bb has
  // rendered it, then the tab the route belongs to.
  const selected = pending ?? active;
  const pinnedShown = shown.filter((id) => tabs.pinned.includes(id));
  const ordinaryShown = shown.filter((id) => !tabs.pinned.includes(id));
  const setTabRef = (id: TabId) => (el: HTMLDivElement | null) => {
    if (el === null) tabRefs.current.delete(id);
    else tabRefs.current.set(id, el);
  };
  // Pinned tabs are always icons. The rest follow the Tab labels setting.
  const showsLabel = (id: TabId) =>
    !tabs.pinned.includes(id) && (labelMode === "always" || (labelMode === "active" && id === selected));
  const threadsLabelled = showsLabel(THREADS);

  const destinationTab = (id: TabId) => {
    const item = byId.get(id)!;
    const isPinned = tabs.pinned.includes(id);
    const labelled = showsLabel(id);
    const dragging = drag.state?.id === id;
    const name = item.shortcut ? `${item.label} (${item.shortcut.label})` : item.label;
    return (
      <TabMenu key={id} {...menuFor(id)}>
        <div
          className="bb-top-tab"
          data-active={selected === id ? "" : undefined}
          data-visible={selected !== id && panesOf(screen, id).length > 0 ? "" : undefined}
          data-pinned={isPinned ? "" : undefined}
          data-icon-only={labelled ? undefined : ""}
          data-dragging={dragging ? "" : undefined}
          style={dragging ? { transform: `translateX(${drag.state!.dx}px)` } : undefined}
          ref={setTabRef(id)}
        >
          <button
            type="button"
            className="bb-top-tab-main"
            aria-current={selected === id ? "page" : undefined}
            aria-label={labelled ? undefined : item.label}
            aria-keyshortcuts={item.shortcut?.ariaKeyShortcuts}
            title={isPinned ? `${name} — pinned` : name}
            disabled={item.isDisabled}
            onPointerDown={(event) => drag.onPointerDown(event, id)}
            onClick={() => {
              if (drag.consumeClick()) return;
              activateSoon(id);
            }}
            onMouseDown={(event) => {
              // Middle-click closes; stop it starting autoscroll first.
              if (event.button === 1) event.preventDefault();
            }}
            onAuxClick={(event) => {
              if (event.button === 1) closeTab(id);
            }}
          >
            <span className="bb-top-tab-icon">
              <TabIcon item={item} />
            </span>
            {labelled && <span className="bb-top-tab-label">{item.label}</span>}
            {labelled && item.experimental_Accessory !== null && (
              <span className="bb-top-tab-accessory">
                <item.experimental_Accessory />
              </span>
            )}
            {navLive && nav?.isShortcutModifierHeld === true && item.shortcut !== null && (
              <kbd className="bb-top-tab-shortcut">{item.shortcut.label}</kbd>
            )}
            {labelled && <PaneMap screen={screen} tab={id} />}
          </button>
          {!isPinned && (
            <button
              type="button"
              className="bb-top-tab-close"
              aria-label={`Close ${item.label}`}
              title="Close tab"
              onClick={() => closeTab(id)}
            >
              <CloseGlyph />
            </button>
          )}
        </div>
      </TabMenu>
    );
  };

  return (
    <nav
      ref={stripRef}
      id="bb-top-tabs"
      className="bb-top-tabs"
      aria-label="Tabs"
      data-traffic-lights={trafficLights ? "" : undefined}
      data-dragging={drag.state === null ? undefined : ""}
    >
      <div className="bb-top-tabs-list" ref={listRef} onWheel={onWheel} onKeyDown={onKeyDown}>
        <ThreadSwitcher
          open={switcher !== null}
          onOpenChange={(open) => setSwitcher(open ? { keyboard: false } : null)}
          currentThreadId={selected === THREADS ? threadIdFromPath(path) : null}
          focusFirst={switcher?.keyboard === true}
          recentThreadIds={tabs.recentThreads}
          onOpenThread={openThread}
        >
          <TabMenu {...menuFor(THREADS)}>
            <SwitcherTrigger asChild>
              <div
                className="bb-top-tab bb-top-tab-threads"
                data-active={selected === THREADS ? "" : undefined}
                data-visible={selected !== THREADS && panesOf(screen, THREADS).length > 0 ? "" : undefined}
                data-icon-only={threadsLabelled ? undefined : ""}
                ref={setTabRef(THREADS)}
              >
                <button
                  type="button"
                  className="bb-top-tab-main"
                  aria-current={selected === THREADS ? "page" : undefined}
                  aria-label={threadsLabelled ? undefined : "Threads"}
                  title={threadsLabelled ? undefined : "Threads"}
                  onPointerDown={(event) => {
                    // Threads switches on press, as a browser tab does: it cannot
                    // be dragged, so there is nothing to wait for the release for.
                    if (!isPlainPress(event)) return;
                    pressedThreads.current = true;
                    setSwitcher(null);
                    activateSoon(THREADS);
                  }}
                  onClick={() => {
                    // The click that ends that press has already been handled;
                    // a keyboard activation has not.
                    if (pressedThreads.current) {
                      pressedThreads.current = false;
                      return;
                    }
                    activateSoon(THREADS);
                  }}
                >
                  <ThreadsGlyph className="bb-top-tab-icon" />
                  {threadsLabelled && (
                    <ThreadsLabel active={selected === THREADS} savedPath={tabs.paths[THREADS]} />
                  )}
                  <ThreadsStatus />
                  {threadsLabelled && <PaneMap screen={screen} tab={THREADS} />}
                </button>
              </div>
            </SwitcherTrigger>
          </TabMenu>
        </ThreadSwitcher>
        {pinnedShown.map(destinationTab)}
        <div className="bb-top-tabs-divider" aria-hidden="true" />
        {ordinaryShown.map(destinationTab)}
      </div>
      {drag.preview !== null && (
        <div className="bb-top-tabs-split-preview" style={drag.preview.rect} aria-hidden="true">
          <span>{drag.preview.label}</span>
        </div>
      )}
      <TabPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        destinations={destinations}
        openIds={shown}
        pinnedIds={tabs.pinned}
        active={active}
        canReopen={tabs.closed.some((c) => byId.has(c.id) && !tabs.open.includes(c.id))}
        splitFor={splitActionFor}
        onPick={activateSoon}
        onTogglePin={togglePin}
        onReopen={reopenTab}
      />
    </nav>
  );
}

