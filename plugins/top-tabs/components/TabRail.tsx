// Tab Nav: bb's destinations as vertical tabs in the sidebar's rail.
//
// Registered as a navigation with `placement: "rail"`. bb lays out the
// column at the sidebar's left edge, keeps it when the sidebar collapses, and
// draws Settings at its foot; Tab Nav draws Threads, the pinned and open
// tabs, and the button that opens more. Inside the sidebar bb lends its
// navigation model and its split drag directly.
//
// Threads cannot close: it is the thread list and the thread in view, as bb
// draws them. Every other destination — a plugin panel, Plugins, Skills —
// opens as a tab below it and remembers where it was left.
import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  experimental_usePluginId,
  experimental_useSidebarNavigation,
  experimental_useSidebarNavigationSplit,
  experimental_useSidebarThreadSplit,
  experimental_useSidebarThreads,
  useBbNavigate,
  useSettings,
  useSidebarSplitLayout,
  type ExperimentalSidebarNavigationProps,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { tabName } from "../lib/badge.ts";
import { publishController } from "../lib/controller.ts";
import { currentPath, navigateToPath, subscribeLocation } from "../lib/location.ts";
import type { NavItem } from "../lib/nav.ts";
import { closePane, interceptPageClose, isSidebarOpen, observeSidebar, toggleSidebar } from "../lib/shell.ts";
import { WIDE_DEFAULT, dragRail } from "../lib/rail-width.ts";
import {
  getState,
  getWideWidth,
  initStore,
  isWide,
  setWide,
  setWideWidth,
  update,
  useTabsState,
  useWide,
  useWideWidth,
} from "../lib/store.ts";
import {
  THREADS,
  activeTabFor,
  adopt,
  awayFromHome,
  close,
  closeOrderOf,
  closeOthers,
  closeToRight,
  cycle,
  destinationPanesFrom,
  pin,
  panesOf,
  panesOnScreen,
  pathFits,
  recordPath,
  recordRecent,
  recordRecentThread,
  rememberSidebar,
  reopen,
  reopenable,
  resetPinned,
  rootFor,
  seed,
  sidebarStep,
  splitPartner,
  subPathOf,
  pageCloseAction,
  successorAfterClose,
  successorAfterPinClose,
  threadIdFromPath,
  threadPaneFor,
  unpin,
  type RouteTarget,
  type ScreenPane,
  type TabId,
} from "../lib/tabs-model.ts";
import { CloseGlyph, ComposeGlyph, NamesGlyph, PaneMap, ThreadsGlyph } from "./glyphs.tsx";
import { TabBadge, TabIcon, destinationsOf } from "./destinations.tsx";
import { TabMenu, TabPicker, type SplitAction, type TabMenuProps } from "./menus.tsx";
import { TabTooltip, TabTooltipProvider } from "./tab-tooltip.tsx";
import { ThreadsLabel, ThreadsStatus } from "./threads-tab.tsx";
import { SwitcherTrigger, ThreadSwitcher } from "./thread-switcher.tsx";
import { useTabDrag } from "./use-tab-drag.ts";

/** How long the nav items must sit still before the first-run seed reads them. */
const SEED_SETTLE_MS = 1500;

/**
 * Set on <html> while the rail shows names; top-tabs.css widens bb's rail
 * column for it. Removed whenever the rail is not on screen, so another
 * navigation gets bb's own width.
 */
const WIDE_CLASS = "bb-tab-nav-wide";
/** Set on <html> while the rail's edge is dragged: bb's sidebar follows without sliding. */
const RESIZING_CLASS = "bb-tab-nav-resizing";
/** The wide rail's width, on <html> for top-tabs.css. */
const WIDTH_PROPERTY = "--bb-tab-nav-wide-width";

const NO_ITEMS: readonly NavItem[] = [];

/** What bb's split hook says about one destination tab. */
interface TabSplit {
  isAvailable: boolean;
  paneIds: readonly string[];
}

/**
 * The navigation bb mounts: the tab rail, or, on a phone, where the sidebar
 * is a drawer and tabs have no room, bb's own Rail.
 */
export function TabNavigation({ isCompactViewport, experimental_Original: Original }: ExperimentalSidebarNavigationProps) {
  if (isCompactViewport) return Original === undefined ? null : <Original />;
  return <TabRail />;
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

/** ⌘-click (Ctrl-click elsewhere) opens in a split, as on bb's own Rail. */
function wantsSplit(event: ReactMouseEvent): boolean {
  return event.metaKey || event.ctrlKey;
}

function pathnameOf(path: string): string {
  return path.split(/[?#]/, 1)[0] ?? path;
}

function sameSplit(a: TabSplit | undefined, b: TabSplit): boolean {
  return (
    a !== undefined &&
    a.isAvailable === b.isAvailable &&
    a.paneIds.length === b.paneIds.length &&
    a.paneIds.every((id, index) => id === b.paneIds[index])
  );
}

/** Close the split panes these tabs are on screen in. True if any closed. */
function closePanesOf(screen: readonly ScreenPane[] | null, ids: readonly string[]): boolean {
  let closed = false;
  for (const id of ids) {
    for (const pane of panesOf(screen, id)) closed = closePane(pane.paneId) || closed;
  }
  return closed;
}

function TabRail() {
  const pluginId = experimental_usePluginId();
  initStore(pluginId);
  const tabs = useTabsState();
  const wide = useWide();
  const nav = experimental_useSidebarNavigation();
  const bbNavigate = useBbNavigate();
  const { values } = useSettings();
  const collapseSidebar = values?.collapseSidebar !== false;
  const closeOrder = closeOrderOf(values?.recentAfterClose);
  const path = useSyncExternalStore(subscribeLocation, currentPath);
  const pathname = pathnameOf(path);
  const splitLayout = useSidebarSplitLayout();
  const { threads } = experimental_useSidebarThreads();

  const destinations = useMemo(() => destinationsOf(nav.items ?? NO_ITEMS), [nav.items]);
  const byId = useMemo(() => new Map(destinations.map((item) => [item.id, item])), [destinations]);
  const targets = useMemo(() => destinations.map(routeTarget), [destinations]);
  const active = activeTabFor({ activeItemId: nav.activeItemId, pathname }, targets);
  // Tabs whose plugin is not loaded (disabled, or still starting) stay in
  // storage but not on screen, so they come back with their plugin.
  const shown = useMemo(() => tabs.open.filter((id) => byId.has(id)), [tabs.open, byId]);

  // What bb's split hook says about each tab on screen, reported by the tabs
  // themselves, since the hook is per item.
  const [splits, setSplits] = useState<ReadonlyMap<string, TabSplit>>(() => new Map());
  const reportSplit = useCallback((id: string, split: TabSplit | null) => {
    setSplits((before) => {
      if (split === null ? !before.has(id) : sameSplit(before.get(id), split)) return before;
      const next = new Map(before);
      if (split === null) next.delete(id);
      else next.set(id, split);
      return next;
    });
  }, []);

  // Which destination each pane of a split shows: the split layout says
  // which thread a pane holds, and bb's split hook which panes each
  // destination is in.
  const paneOwners = useMemo(() => destinationPanesFrom(splits), [splits]);
  // What each pane of a split shows, or null when nothing is split.
  const screen = useMemo(
    () => panesOnScreen(splitLayout?.panes ?? null, paneOwners, active),
    [splitLayout, paneOwners, active],
  );
  // bb holding a split at all, on screen or not. The sidebar waits on this
  // rather than on `screen`, which blinks off for a render whenever focus
  // moves between panes.
  const inSplit = (splitLayout?.panes.length ?? 0) > 1;

  // Callbacks below read the latest of these rather than closing over them,
  // so the controller and window listeners never act on a stale rail.
  const live = useRef({ active, byId, shown, nav, splits, bbNavigate, screen, threads, collapseSidebar, inSplit, closeOrder });
  live.current = { active, byId, shown, nav, splits, bbNavigate, screen, threads, collapseSidebar, inSplit, closeOrder };

  // First run: the destinations bb's navigation showed become the open tabs.
  // Wait for the list to settle, since plugin panels register as their
  // bundles load and a fresh client briefly lists only bb's own items. The
  // wait is keyed on which items are visible, not on the list object, which
  // bb hands over anew on every render.
  const visibleKey = destinations
    .filter((item) => item.isVisible)
    .map((item) => item.id)
    .join("\n");
  useEffect(() => {
    if (tabs.seeded || visibleKey === "") return;
    const timer = window.setTimeout(() => {
      update((s) => seed(s, visibleKey.split("\n")));
    }, SEED_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [tabs.seeded, visibleKey]);

  // A pinned tab the close-tab command reset, until the rail has left it:
  // its location must not be recorded again on the way out.
  const resetting = useRef<TabId | null>(null);

  // A destination reached any other way — the palette, a shortcut, a link —
  // gets a tab, and every tab remembers where it was left.
  useEffect(() => {
    if (active === null) return;
    if (resetting.current !== active) resetting.current = null;
    // Read the location now rather than from the render: it is the one
    // source that cannot lag behind.
    const here = currentPath();
    const item = byId.get(active);
    const target = item === undefined ? null : routeTarget(item);
    const threadId = active === THREADS ? threadIdFromPath(here) : null;
    update((s) => {
      let next = recordRecent(adopt(s, active), active);
      if (threadId !== null) next = recordRecentThread(next, threadId);
      if (resetting.current === active) return next;
      return pathFits(active, target, pathnameOf(here)) ? recordPath(next, active, here) : next;
    });
  }, [active, path, byId]);

  // Each tab keeps the sidebar as the user left it; see sidebarStep for the
  // rules. On a destination the thread list collapses to the rail. A split
  // is the user's own arrangement, and the thread list is where they drag
  // threads into it from, so while one is up the rail leaves the sidebar
  // alone. `previous` is the tab the rail has brought the sidebar in line
  // with, which a tab click sets before the route catches up.
  const previous = useRef<TabId | null | undefined>(undefined);
  const wasInSplit = useRef(false);

  /**
   * Bring the sidebar in line with a move to `next`. A tab click calls this
   * before it navigates, so the sidebar and the new page arrive in one paint
   * instead of the page rendering at one width and then reflowing to
   * another; navigation from anywhere else is caught by the effect below.
   * Either way it runs once per move, because it records `next` as where
   * the rail now is.
   */
  const syncSidebar = useCallback((next: TabId | null) => {
    const before = previous.current;
    previous.current = next;
    const { collapseSidebar, inSplit } = live.current;
    if (!collapseSidebar || inSplit) return;
    const sidebarOpen = isSidebarOpen();
    if (sidebarOpen === null) return;
    const step = sidebarStep({ previous: before, next, sidebarOpen, sidebar: getState().sidebar });
    update((s) => (s.sidebar === step.sidebar ? s : { ...s, sidebar: step.sidebar }));
    if (step.action !== null) toggleSidebar({ instant: true });
  }, []);

  useEffect(() => {
    // When a split closes, look at what is left afresh, as on first load: the
    // tab in view gets back the sidebar it keeps.
    if (wasInSplit.current && !inSplit) previous.current = undefined;
    wasInSplit.current = inSplit;
    syncSidebar(active);
  }, [active, collapseSidebar, inSplit, syncSidebar]);

  // The user's own toggling is the preference of the tab they are on. It is
  // filed under `previous`, not the route: a tab click toggles the sidebar
  // before it navigates, and the route still names the tab being left. The
  // rail's own toggles set the state the tab already wants, so recording
  // them changes nothing.
  useEffect(() => {
    if (!collapseSidebar) return;
    return observeSidebar((open) => {
      const tab = previous.current;
      if (tab === undefined || tab === null || live.current.inSplit) return;
      update((s) => {
        const sidebar = rememberSidebar(s.sidebar, tab, open);
        return sidebar === s.sidebar ? s : { ...s, sidebar };
      });
    });
  }, [active, collapseSidebar]);

  const activate = useCallback(
    (id: TabId) => {
      const { active, byId, nav, screen, threads } = live.current;
      const saved = getState().paths[id];
      if (id === THREADS) {
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
        if (saved === undefined || !navigateToPath(saved)) nav.actions.goHome();
        return;
      }
      const item = byId.get(id);
      if (id === active || item === undefined) return;
      syncSidebar(id);
      update((s) => adopt(s, id));
      if (saved !== undefined && navigateToPath(saved)) return;
      nav.actions.activate(id, { target: "current" });
    },
    [syncSidebar],
  );

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
      const { active, bbNavigate } = live.current;
      setSwitcher(null);
      if (active !== THREADS) syncSidebar(THREADS);
      // bb's own open: it focuses the thread's pane if a split shows it.
      bbNavigate.toThread(thread.id);
    },
    [syncSidebar],
  );

  /** New thread: bb's own, which opens the compose screen, on Threads. */
  const newThread = useCallback(() => {
    const { active, nav, bbNavigate } = live.current;
    setSwitcher(null);
    if (active !== THREADS) syncSidebar(THREADS);
    const item = nav.items.find((candidate) => candidate.action.kind === "new-thread");
    if (item !== undefined && !item.isDisabled) nav.actions.activate(item.id, { target: "current" });
    else bbNavigate.toCompose();
  }, [syncSidebar]);

  const closeTab = useCallback(
    (id: TabId) => {
      // Threads and pinned tabs stay; a pinned tab has to be unpinned first.
      if (id === THREADS || getState().pinned.includes(id)) return;
      const { active, shown, screen, closeOrder } = live.current;
      const next = successorAfterClose(shown, id, active, closeOrder, getState().recent);
      update((s) => close(s, [id]));
      // A tab on screen in a split closes with its pane, and bb chooses which
      // pane takes focus; there is no neighbour to switch to.
      if (closePanesOf(screen, [id])) return;
      if (next !== null && next !== active) activateSoon(next);
    },
    [activateSoon],
  );

  /**
   * Close a pinned tab with the close-tab command or bb's Close, as Arc does:
   * it stays pinned, forgets where it was left, and the rail moves past the
   * other pins. A middle-click and the batch closes still leave pinned tabs
   * alone.
   */
  const closePinned = useCallback(
    (id: TabId) => {
      const { pinned, recent } = getState();
      if (!pinned.includes(id)) return;
      const { active, shown, screen, closeOrder } = live.current;
      update((s) => resetPinned(s, id));
      if (id !== active) return;
      resetting.current = id;
      if (closePanesOf(screen, [id])) return;
      activateSoon(successorAfterPinClose(shown, pinned, id, closeOrder, recent));
    },
    [activateSoon],
  );

  // bb's Close on a lone plugin page would open New Thread and leave the tab
  // open behind Threads; it closes the tab instead, as the tab's own × does,
  // or resets a pinned one, as the close-tab command does.
  useEffect(
    () =>
      interceptPageClose(() => {
        const { active } = live.current;
        const action = pageCloseAction(active, getState().pinned);
        if (action === "tab") closeTab(active!);
        else if (action === "pin") closePinned(active!);
        return action !== null;
      }),
    [closeTab, closePinned],
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

  const closeTabsBelow = useCallback(
    (of: TabId) => {
      const { shown } = live.current;
      const { pinned } = getState();
      const below = of === THREADS ? shown : shown.slice(shown.indexOf(of) + 1);
      const closing = below.filter((id) => !pinned.includes(id));
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
    const { byId, splits } = live.current;
    if (id === THREADS) return threadIdFromPath(getState().paths[THREADS]) !== null;
    // Only what bb's split hook allows: plugin panels, not on a compact
    // viewport, not with splits off.
    return byId.has(id) && splits.get(id)?.isAvailable === true;
  }, []);

  /** Put `id` in a new pane beside the focused one. */
  const openInSplit = useCallback((id: TabId) => {
    const { nav, bbNavigate } = live.current;
    if (id === THREADS) {
      const threadId = threadIdFromPath(getState().paths[THREADS]);
      if (threadId !== null) bbNavigate.toThread(threadId, { split: true });
      return;
    }
    nav.actions.activate(id, { target: "split" });
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
      const canPair = (other: TabId) => canBeInPane(other) && (other === THREADS || shown.includes(other));
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
        closePinned,
        cycle: (direction) => {
          const { active, shown } = live.current;
          activateSoon(cycle([THREADS, ...shown], active, direction));
        },
        reopen: reopenTab,
        openPicker: () => setPickerOpen(true),
        isPinned: (id) => getState().pinned.includes(id),
        togglePin,
        openSwitcher: () => setSwitcher({ keyboard: true }),
        newThread,
      }),
    [activateSoon, closeTab, closePinned, reopenTab, togglePin, newThread],
  );

  // bb's rail column takes the wide width while the rail shows names.
  const wideWidth = useWideWidth();
  useLayoutEffect(() => {
    if (!wide) return;
    const root = document.documentElement;
    root.classList.add(WIDE_CLASS);
    root.style.setProperty(WIDTH_PROPERTY, `${wideWidth}px`);
    return () => {
      root.classList.remove(WIDE_CLASS);
      root.style.removeProperty(WIDTH_PROPERTY);
    };
  }, [wide, wideWidth]);

  const railRef = useRef<HTMLDivElement>(null);
  /**
   * Drag the rail's right edge: resize it while wide, show or hide names past
   * the snap points (lib/rail-width.ts). bb's sidebar follows each move
   * without its slide.
   */
  const onResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const start = { wide: isWide(), width: getWideWidth() };
    // bb's own width for the rail; used only when the drag starts narrow.
    const narrowWidth = railRef.current?.getBoundingClientRect().width ?? 48;
    const root = document.documentElement;
    root.classList.add(RESIZING_CLASS);
    const onMove = (move: PointerEvent) => {
      const next = dragRail(start, narrowWidth, move.clientX - startX);
      setWideWidth(next.width);
      setWide(next.wide);
    };
    const onUp = () => {
      root.classList.remove(RESIZING_CLASS);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  // Keep the tab in view visible when the rail scrolls.
  const tabRefs = useRef(new Map<string, HTMLElement>());
  useEffect(() => {
    if (active === null) return;
    tabRefs.current.get(active)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active, shown.length]);

  const drag = useTabDrag(tabRefs, live);
  const listRef = useRef<HTMLDivElement>(null);

  const onKeyDown = (event: ReactKeyboardEvent) => {
    const keys = ["ArrowUp", "ArrowDown", "Home", "End"];
    if (!keys.includes(event.key)) return;
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>(".bb-tab-nav-main") ?? []);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index === -1) return;
    event.preventDefault();
    const target =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[target]?.focus();
  };

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
    canCloseBelow:
      id === THREADS
        ? closable.length > 0
        : shown.slice(shown.indexOf(id) + 1).some((other) => closable.includes(other)),
    canReopen: reopenable(tabs, (id) => byId.has(id)) !== undefined,
    onClose: () => closeTab(id),
    onTogglePin: () => togglePin(id),
    onCloseOthers: () => closeOtherTabs(id),
    onCloseBelow: () => closeTabsBelow(id),
    onReopen: reopenTab,
    split: splitActionFor(id),
    onDetails: () => nav.actions.openDetails(id),
  });

  // What the rail draws as selected: the tab being switched to, until bb has
  // rendered it, then the tab the route belongs to.
  const selected = pending ?? active;
  const pinnedShown = shown.filter((id) => tabs.pinned.includes(id));
  const ordinaryShown = shown.filter((id) => !tabs.pinned.includes(id));
  const setTabRef = (id: TabId) => (el: HTMLDivElement | null) => {
    if (el === null) tabRefs.current.delete(id);
    else tabRefs.current.set(id, el);
  };
  const newThreadItem = nav.items.find((item) => item.action.kind === "new-thread");
  const newThreadTitle = newThreadItem?.shortcut ? `New thread (${newThreadItem.shortcut.label})` : "New thread";
  const savedThreadId = threadIdFromPath(tabs.paths[THREADS]);

  const destinationTab = (id: TabId) => {
    const item = byId.get(id)!;
    // Where the tab is inside its destination, shown on hover rather than
    // beside the name: a route remainder is not always readable, and a pin's
    // dot says it has moved without needing one.
    const saved = tabs.paths[id];
    const root = rootFor(routeTarget(item), saved);
    const away = awayFromHome(tabs, id, root);
    // A pin pinned at its panel's start resets there; only a deeper home is
    // worth naming.
    const home = away ? subPathOf(tabs.homes[id], root) : null;
    return (
      <DestinationTab
        key={id}
        item={item}
        wide={wide}
        selected={selected === id}
        onScreen={selected !== id && panesOf(screen, id).length > 0}
        pinned={tabs.pinned.includes(id)}
        away={away}
        where={subPathOf(saved, root)}
        pinNote={home === null ? null : `Pinned at ${home}`}
        dragging={drag.state?.id === id ? drag.state.dy : null}
        showShortcut={nav.isShortcutModifierHeld}
        screen={screen}
        menu={menuFor(id)}
        tabRef={setTabRef(id)}
        reportSplit={reportSplit}
        onPointerDown={(event) => drag.onPointerDown(event, id)}
        onActivate={(event) => {
          if (drag.consumeClick()) return;
          if (wantsSplit(event) && canBeInPane(id)) openInSplit(id);
          else activateSoon(id);
        }}
        onClose={() => closeTab(id)}
      />
    );
  };

  return (
    <div
      className="bb-tab-nav"
      ref={railRef}
      data-wide={wide ? "" : undefined}
      data-dragging={drag.state === null ? undefined : ""}
    >
      <div
        className="bb-tab-nav-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize tabs"
        title={wide ? "Drag to resize, double-click to reset" : "Drag to show names"}
        onPointerDown={onResizeStart}
        onDoubleClick={() => {
          setWideWidth(WIDE_DEFAULT);
          setWide(true);
        }}
      />
      <TabTooltipProvider>
        <div className="bb-tab-nav-list" ref={listRef} onKeyDown={onKeyDown}>
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
                <ThreadsTab
                  wide={wide}
                  selected={selected === THREADS}
                  active={active === THREADS}
                  onScreen={selected !== THREADS && panesOf(screen, THREADS).length > 0}
                  savedPath={tabs.paths[THREADS]}
                  savedThreadId={savedThreadId}
                  screen={screen}
                  tabRef={setTabRef(THREADS)}
                  newThreadTitle={newThreadTitle}
                  onNewThread={newThread}
                  onPointerDown={(event) => {
                    // Threads switches on press, as a browser tab does: it
                    // cannot be reordered, so there is nothing to wait for
                    // the release for.
                    if (!isPlainPress(event)) return;
                    pressedThreads.current = true;
                    setSwitcher(null);
                    activateSoon(THREADS);
                  }}
                  onClick={(event) => {
                    // The click that ends that press has already been
                    // handled; a keyboard activation has not.
                    if (pressedThreads.current) {
                      pressedThreads.current = false;
                      return;
                    }
                    if (wantsSplit(event) && canBeInPane(THREADS)) openInSplit(THREADS);
                    else activateSoon(THREADS);
                  }}
                />
              </SwitcherTrigger>
            </TabMenu>
          </ThreadSwitcher>
          {!wide && (
            <TabTooltip name={newThreadTitle} where={null} pin={null}>
              <button
                type="button"
                className="bb-tab-nav-new-thread bb-tab-nav-rail-button"
                aria-label="New thread"
                aria-keyshortcuts={newThreadItem?.shortcut?.ariaKeyShortcuts}
                onClick={newThread}
              >
                <ComposeGlyph />
              </button>
            </TabTooltip>
          )}
          {pinnedShown.length > 0 && <div className="bb-tab-nav-divider" aria-hidden="true" />}
          {pinnedShown.map(destinationTab)}
          <div className="bb-tab-nav-divider" aria-hidden="true" />
          {ordinaryShown.map(destinationTab)}
          <TabPicker
            wide={wide}
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            destinations={destinations}
            openIds={shown}
            pinnedIds={tabs.pinned}
            active={active}
            canReopen={reopenable(tabs, (id) => byId.has(id)) !== undefined}
            splitFor={splitActionFor}
            onPick={activateSoon}
            onTogglePin={togglePin}
            onReopen={reopenTab}
          />
        </div>
        <div className="bb-tab-nav-foot">
          <TabTooltip name={wide ? "Hide tab names" : "Show tab names"} where={null} pin={null}>
            <button
              type="button"
              className="bb-tab-nav-rail-button bb-tab-nav-width"
              aria-label={wide ? "Hide tab names" : "Show tab names"}
              aria-pressed={wide}
              onClick={() => setWide(!wide)}
            >
              <NamesGlyph wide={wide} />
              {wide && <span className="bb-tab-nav-label">Hide names</span>}
            </button>
          </TabTooltip>
        </div>
      </TabTooltipProvider>
    </div>
  );
}

interface ThreadsTabProps extends Omit<HTMLAttributes<HTMLDivElement>, "onPointerDown" | "onClick"> {
  wide: boolean;
  selected: boolean;
  active: boolean;
  onScreen: boolean;
  savedPath: string | undefined;
  savedThreadId: string | null;
  screen: readonly ScreenPane[] | null;
  tabRef: (el: HTMLDivElement | null) => void;
  newThreadTitle: string;
  onNewThread: () => void;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}

/**
 * Threads, at the top. Dragging it out into the page opens the thread it
 * returns to in a split, through bb's own drag for thread rows. It is the
 * trigger of the thread switcher and of its context menu, so it passes their
 * ref and handlers on to its row.
 */
const ThreadsTab = forwardRef<HTMLDivElement, ThreadsTabProps>(function ThreadsTab(props, ref) {
  const {
    wide,
    selected,
    active,
    onScreen,
    savedPath,
    savedThreadId,
    screen,
    tabRef,
    newThreadTitle,
    onNewThread,
    onPointerDown,
    onClick,
    ...trigger
  } = props;
  const split = experimental_useSidebarThreadSplit(savedThreadId ?? "");
  const setRef = (el: HTMLDivElement | null) => {
    tabRef(el);
    if (typeof ref === "function") ref(el);
    else if (ref !== null) ref.current = el;
  };
  return (
    <div
      {...trigger}
      className="bb-tab-nav-tab bb-tab-nav-threads"
      data-active={selected ? "" : undefined}
      data-visible={onScreen ? "" : undefined}
      ref={setRef}
    >
      <button
        type="button"
        className="bb-tab-nav-main"
        aria-current={selected ? "page" : undefined}
        aria-label={wide ? undefined : "Threads"}
        onPointerDown={(event) => {
          if (savedThreadId !== null) split.splitProps.onPointerDown?.(event);
          onPointerDown(event);
        }}
        onClick={onClick}
      >
        <span className="bb-tab-nav-icon">
          <ThreadsGlyph />
          {!wide && <ThreadsStatus compact />}
        </span>
        {wide && <ThreadsLabel active={active} savedPath={savedPath} />}
        {wide && <ThreadsStatus />}
        {wide && <PaneMap screen={screen} tab={THREADS} />}
      </button>
      {wide && (
        <button
          type="button"
          className="bb-tab-nav-new-thread"
          aria-label="New thread"
          title={newThreadTitle}
          onClick={onNewThread}
        >
          <ComposeGlyph />
        </button>
      )}
    </div>
  );
});

interface DestinationTabProps {
  item: NavItem;
  wide: boolean;
  selected: boolean;
  onScreen: boolean;
  pinned: boolean;
  away: boolean;
  where: string | null;
  pinNote: string | null;
  /** How far the tab follows the pointer while dragged, or null. */
  dragging: number | null;
  showShortcut: boolean;
  screen: readonly ScreenPane[] | null;
  menu: TabMenuProps;
  tabRef: (el: HTMLDivElement | null) => void;
  reportSplit: (id: string, split: TabSplit | null) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onActivate: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onClose: () => void;
}

/**
 * One destination's tab. It asks bb's split hook about itself: whether it
 * can open in a pane and which panes show it, reported to the rail, and the
 * drag that opens it in a split when it is pulled out into the page.
 */
function DestinationTab(props: DestinationTabProps) {
  const { item, wide, pinned } = props;
  const split = experimental_useSidebarNavigationSplit(item.id);
  const paneIds = split.layout?.panes.filter((pane) => pane.isMe).map((pane) => pane.paneId) ?? [];
  const paneKey = paneIds.join("\n");
  const { reportSplit } = props;
  useLayoutEffect(() => {
    reportSplit(item.id, { isAvailable: split.isAvailable, paneIds: paneKey === "" ? [] : paneKey.split("\n") });
  }, [reportSplit, item.id, split.isAvailable, paneKey]);
  useLayoutEffect(() => () => reportSplit(item.id, null), [reportSplit, item.id]);

  const badge = item.badge;
  const named = tabName(item.label, badge);
  const name = item.shortcut ? `${named} (${item.shortcut.label})` : named;
  return (
    <TabMenu {...props.menu}>
      <div
        className="bb-tab-nav-tab"
        data-active={props.selected ? "" : undefined}
        data-visible={props.onScreen ? "" : undefined}
        data-pinned={pinned ? "" : undefined}
        data-dragging={props.dragging === null ? undefined : ""}
        style={props.dragging === null ? undefined : { transform: `translateY(${props.dragging}px)` }}
        ref={props.tabRef}
      >
        <TabTooltip name={name} where={props.where} pin={props.pinNote}>
          <button
            type="button"
            className="bb-tab-nav-main"
            aria-current={props.selected ? "page" : undefined}
            aria-label={wide && badge === null ? undefined : named}
            aria-keyshortcuts={item.shortcut?.ariaKeyShortcuts}
            aria-busy={item.isLoading || undefined}
            disabled={item.isDisabled}
            onPointerDown={(event) => {
              split.splitProps.onPointerDown?.(event);
              props.onPointerDown(event);
            }}
            onClick={props.onActivate}
            onMouseDown={(event) => {
              // Middle-click closes; stop it starting autoscroll first.
              if (event.button === 1) event.preventDefault();
            }}
            onAuxClick={(event) => {
              if (event.button === 1 && !pinned) props.onClose();
            }}
          >
            <span className="bb-tab-nav-icon">
              <TabIcon item={item} />
              {props.away && <span className="bb-tab-nav-moved" aria-hidden="true" />}
              {!wide && badge !== null && <TabBadge badge={badge} size="rail" />}
            </span>
            {wide && <span className="bb-tab-nav-label">{item.label}</span>}
            {wide && badge !== null && <TabBadge badge={badge} size="list" />}
            {wide && props.showShortcut && item.shortcut !== null && (
              <kbd className="bb-tab-nav-shortcut">{item.shortcut.label}</kbd>
            )}
            {wide && <PaneMap screen={props.screen} tab={item.id} />}
          </button>
        </TabTooltip>
        {wide && !pinned && (
          <button
            type="button"
            className="bb-tab-nav-close"
            aria-label={`Close ${item.label}`}
            title="Close tab"
            onClick={props.onClose}
          >
            <CloseGlyph />
          </button>
        )}
      </div>
    </TabMenu>
  );
}

