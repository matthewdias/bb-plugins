// The tab strip as data: which tabs are open, where each one was left, and
// what the sidebar should do when the user moves between them.
//
// Nothing here touches React, the DOM or the SDK, so every rule the strip
// follows is a function a test can call. A tab is identified by the nav item
// id bb already uses for the destination (`<pluginId>/<panelId>`,
// `__bb__/extensions`, ...), plus the one id bb has no item for: Threads.

/** The permanent first tab: the sidebar, the thread list and the thread in view. */
export const THREADS = "threads";

/**
 * bb's Settings, which has no nav item to borrow an id from. A tab like any
 * destination — open, pin, close — except that its own navigation is the
 * sidebar, which bb fills with Settings' sections on that route.
 */
export const SETTINGS = "__top-tabs__/settings";

export type TabId = string;

/** Whether the sidebar is open on each tab, Threads included. */
export type SidebarMemory = Readonly<Record<string, boolean>>;

export interface ClosedTab {
  id: string;
  /** Where the tab was when it closed, so reopening lands in the same place. */
  path: string | null;
  /** Its position in `open`, so reopening puts it back where it was. */
  index: number;
  /**
   * A pinned tab that was reset rather than closed. It is still open, so
   * reopening it gives back its location instead of a slot in the strip.
   */
  reset?: true;
}

export interface TabsState {
  /**
   * Destination tabs in strip order. Threads is implicit and always first;
   * pinned tabs always come next, so `open` lists them first.
   */
  open: readonly string[];
  /**
   * Tabs that stay in the strip: drawn as icons beside Threads, never closed
   * by a click or a batch close. Unpin one to close it. Always a subset of
   * `open`.
   */
  pinned: readonly string[];
  /** The last in-app location seen on each tab, Threads included. */
  paths: Readonly<Record<string, string>>;
  /**
   * Where each pinned tab was when it was pinned, which resetting it returns
   * to, as Arc's pinned tabs do. A pin made before the tab had a location has
   * none, and resets to the panel's start. Keys are always pinned tabs.
   */
  homes: Readonly<Record<string, string>>;
  /** Recently closed tabs, most recent first. */
  closed: readonly ClosedTab[];
  /**
   * Whether the user keeps the sidebar open on each tab: what it was the last
   * time they left the tab, or last set it to while there. It is the state to
   * restore on the way back, so collapsing the sidebar on a tab keeps it
   * collapsed there. A tab is missing until the strip has seen it.
   */
  sidebar: SidebarMemory;
  /**
   * Set once the strip has been filled from the sidebar's visible items, the
   * first time the plugin runs, so the destinations the user kept in the
   * sidebar are where they look for them.
   */
  seeded: boolean;
  /** Tabs in the order they were last in view, most recent first. */
  recent: readonly TabId[];
  /** Threads the Threads tab has shown, most recent first. */
  recentThreads: readonly string[];
}

export const EMPTY_STATE: TabsState = {
  open: [],
  pinned: [],
  paths: {},
  homes: {},
  closed: [],
  sidebar: {},
  seeded: false,
  recent: [],
  recentThreads: [],
};

export const RECENT_THREADS_LIMIT = 8;

export const RECENT_LIMIT = 10;

export const CLOSED_LIMIT = 10;

/**
 * A path the strip may navigate to: same-origin and absolute. Stored paths
 * come back out of localStorage, which anything on the page can write.
 */
export function isAppPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\") &&
    value.length <= 2048
  );
}

function isTabId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256;
}

/** Parse persisted state, keeping every well-formed part of it. */
export function parseState(raw: unknown): TabsState {
  if (typeof raw !== "object" || raw === null) return EMPTY_STATE;
  const record = raw as Record<string, unknown>;

  const open: string[] = [];
  if (Array.isArray(record.open)) {
    for (const id of record.open) {
      if (isTabId(id) && id !== THREADS && !open.includes(id)) open.push(id);
    }
  }

  const paths: Record<string, string> = {};
  if (typeof record.paths === "object" && record.paths !== null) {
    for (const [id, path] of Object.entries(record.paths)) {
      if (isTabId(id) && isAppPath(path)) paths[id] = path;
    }
  }

  const closed: ClosedTab[] = [];
  if (Array.isArray(record.closed)) {
    for (const entry of record.closed) {
      if (typeof entry !== "object" || entry === null) continue;
      const { id, path, index, reset } = entry as Record<string, unknown>;
      if (!isTabId(id) || id === THREADS) continue;
      closed.push({
        id,
        path: isAppPath(path) ? path : null,
        index: typeof index === "number" && Number.isInteger(index) && index >= 0 ? index : 0,
        ...(reset === true ? { reset: true as const } : {}),
      });
      if (closed.length === CLOSED_LIMIT) break;
    }
  }

  const pinned = Array.isArray(record.pinned)
    ? open.filter((id) => (record.pinned as unknown[]).includes(id))
    : [];

  const homes: Record<string, string> = {};
  if (typeof record.homes === "object" && record.homes !== null) {
    for (const [id, path] of Object.entries(record.homes)) {
      if (pinned.includes(id) && isAppPath(path)) homes[id] = path;
    }
  }

  return {
    open: pinnedFirst(open, pinned),
    pinned,
    paths,
    homes,
    closed,
    sidebar: parseSidebar(record),
    seeded: record.seeded === true,
    recent: Array.isArray(record.recent)
      ? [...new Set(record.recent.filter(isTabId))].slice(0, RECENT_LIMIT)
      : [],
    recentThreads: Array.isArray(record.recentThreads)
      ? [...new Set(record.recentThreads.filter(isTabId))].slice(0, RECENT_THREADS_LIMIT)
      : [],
  };
}

function parseSidebar(record: Record<string, unknown>): SidebarMemory {
  const sidebar: Record<string, boolean> = {};
  if (typeof record.sidebar === "object" && record.sidebar !== null) {
    for (const [id, open] of Object.entries(record.sidebar)) {
      if (isTabId(id) && typeof open === "boolean") sidebar[id] = open;
    }
  }
  // Before each tab had its own, only Threads remembered the sidebar.
  if (!(THREADS in sidebar) && typeof record.threadsSidebarOpen === "boolean") {
    sidebar[THREADS] = record.threadsSidebarOpen;
  }
  return sidebar;
}

/**
 * A destination as the router sees it: the nav item's id and action, which
 * is all bb tells a plugin about where an item leads.
 */
export interface RouteTarget {
  id: string;
  /** The nav item's `action.kind`. */
  kind: string;
  /** For `open-plugin-panel`, the panel's plugin and id; otherwise null. */
  pluginId: string | null;
  panelId: string | null;
}

export interface Route {
  /** `experimental_useSidebarNavigation().activeItemId`. */
  activeItemId: string | null;
  pathname: string;
}

/** Nav items that are places to go, as opposed to New thread and Search. */
export function isDestinationAction(kind: string): boolean {
  return kind !== "new-thread" && kind !== "search-threads";
}

/** bb's own page for one plugin, which its marketplace listings also use. */
const PLUGIN_PAGE_PATH = /^\/plugins\/[^/]+\/?$/;
/** A plugin panel: `/plugins/<plugin>/<panel path>`, always two segments. */
const PLUGIN_PANEL_PATH = /^\/plugins\/([^/]+)\/([^/]+)/;

function isPluginsPath(pathname: string): boolean {
  return pathname === "/plugins" || pathname.startsWith("/plugins/");
}

function isSettingsPath(pathname: string): boolean {
  return pathname === "/settings" || pathname.startsWith("/settings/");
}

/**
 * Whether `pathname` is on bb's own page for an action kind. bb reports no
 * active item on these pages, so the strip recognises them by route.
 */
/** The route kinds the strip recognises itself; `open-settings` is its own. */
const HOST_KINDS = new Set(["open-extensions", "open-skills", "open-settings"]);

function isHostRoute(kind: string, pathname: string): boolean {
  if (kind === "open-extensions") return pathname === "/plugins" || PLUGIN_PAGE_PATH.test(pathname);
  if (kind === "open-skills") return pathname === "/skills" || pathname.startsWith("/skills/");
  if (kind === "open-settings") return isSettingsPath(pathname);
  return false;
}

/**
 * Whether `pathname` can be a location of `target`.
 *
 * bb's idea of the active item and the browser's location can land a render
 * apart. Without this check a GitHub URL could be saved as the place the
 * Usage tab was left, and clicking Usage would open GitHub.
 */
export function pathFits(tab: TabId, target: RouteTarget | null, pathname: string): boolean {
  if (tab === THREADS) return !isPluginsPath(pathname) && !isSettingsPath(pathname);
  if (target === null) return false;
  if (target.pluginId !== null) return pathname.startsWith(`/plugins/${target.pluginId}/`);
  if (HOST_KINDS.has(target.kind)) return isHostRoute(target.kind, pathname);
  // A kind bb added after this was written: nothing to check it against.
  return true;
}

/**
 * The tab the route belongs to, or null for a route that belongs to none.
 *
 * bb's active item comes first, if the route fits it: it can trail the URL
 * by a render, and believing it then would put a tab you just closed straight
 * back. Where it reports none — its own Plugins and Skills pages, and panels
 * reached by a link — the route decides: a
 * `/plugins/<plugin>/<panel>` path belongs to that panel's tab. Everything
 * else is Threads (a thread, the compose screen, a project) except Settings,
 * which is reached from anywhere and is not a place a tab should hold.
 */
export function activeTabFor(route: Route, targets: readonly RouteTarget[]): TabId | null {
  const { pathname } = route;
  const reported = targets.find((target) => target.id === route.activeItemId);
  if (reported !== undefined && pathFits(reported.id, reported, pathname)) return reported.id;

  const host = targets.find((target) => isHostRoute(target.kind, pathname));
  if (host !== undefined) return host.id;

  const panel = PLUGIN_PANEL_PATH.exec(pathname);
  if (panel !== null) {
    const [, pluginId, panelPath] = panel;
    const ofPlugin = targets.filter((target) => target.pluginId === pluginId);
    // A panel's route segment is its `path`, which bb does not expose; it is
    // usually the panel id, and a plugin with one panel has no ambiguity.
    const exact = ofPlugin.find((target) => target.panelId === panelPath);
    if (exact !== undefined) return exact.id;
    return ofPlugin.length === 1 ? ofPlugin[0]!.id : null;
  }
  if (isPluginsPath(pathname) || isSettingsPath(pathname)) return null;
  return THREADS;
}

/**
 * Where a destination lives when bb cannot be asked to open it. Plugin panels
 * route as `/plugins/<plugin>/<path>`, and a panel's path is normally its id.
 */
export function defaultPathFor(target: RouteTarget): string | null {
  if (target.pluginId !== null && target.panelId !== null) {
    return `/plugins/${encodeURIComponent(target.pluginId)}/${encodeURIComponent(target.panelId)}`;
  }
  if (target.kind === "open-extensions") return "/plugins";
  if (target.kind === "open-skills") return "/skills";
  if (target.kind === "open-settings") return "/settings";
  return null;
}

/**
 * The start of a destination, as seen from `path`, a place on it. A panel's
 * route segment is its `path`, which bb does not expose and need not be its
 * id, so a panel's start is read off the place itself where it can be.
 */
export function rootFor(target: RouteTarget, path: string | undefined): string | null {
  const panel = path === undefined ? null : PLUGIN_PANEL_PATH.exec(path.split(/[?#]/, 1)[0] ?? path);
  if (target.pluginId !== null && panel !== null) {
    const [root, pluginId] = panel;
    if (pluginId === encodeURIComponent(target.pluginId)) return root;
  }
  return defaultPathFor(target);
}

/** The thread a Threads location shows, or null for compose and project pages. */
export function threadIdFromPath(path: string | undefined): string | null {
  if (path === undefined) return null;
  const match = /\/threads\/([A-Za-z0-9_-]+)(?:[/?#]|$)/.exec(path);
  return match?.[1] ?? null;
}

/** `open` with the pinned tabs moved to the front, each group keeping its order. */
function pinnedFirst(open: readonly string[], pinned: readonly string[]): string[] {
  return [...open.filter((id) => pinned.includes(id)), ...open.filter((id) => !pinned.includes(id))];
}

/**
 * Whether a move closes the Settings tab: the route left Settings, and the
 * strip did not take it there. bb's own ways out of Settings — Escape, Back
 * to app, the browser's back — treat Settings as a place you visit and
 * leave; a tab switch in the strip is the user moving between tabs, and
 * leaves it open.
 */
export function leavesSettings(
  previous: TabId | null | undefined,
  next: TabId | null,
  byStrip: boolean,
): boolean {
  return previous === SETTINGS && next !== SETTINGS && !byStrip;
}

/** Open a tab for a destination the user reached some other way. */
export function adopt(state: TabsState, id: TabId): TabsState {
  if (id === THREADS || state.open.includes(id)) return state;
  return { ...state, open: [...state.open, id] };
}

export function isPinned(state: TabsState, id: TabId): boolean {
  return state.pinned.includes(id);
}

/**
 * Pin a tab, opening it if needed. It joins the end of the pinned group, and
 * where it is now becomes its home, the place resetting it returns to.
 */
export function pin(state: TabsState, id: TabId): TabsState {
  if (id === THREADS || state.pinned.includes(id)) return state;
  const opened = adopt(state, id);
  const pinned = [...opened.pinned, id];
  const others = opened.open.filter((other) => !pinned.includes(other));
  const path = opened.paths[id];
  const homes = path === undefined ? opened.homes : { ...opened.homes, [id]: path };
  return { ...opened, pinned, homes, open: [...opened.pinned, id, ...others] };
}

/** Unpin a tab. It becomes the first ordinary tab, right where it was. */
export function unpin(state: TabsState, id: TabId): TabsState {
  if (!state.pinned.includes(id)) return state;
  const pinned = state.pinned.filter((other) => other !== id);
  const others = state.open.filter((other) => !state.pinned.includes(other));
  return { ...state, pinned, homes: withoutPath(state.homes, id), open: [...pinned, id, ...others] };
}

/** A path's pathname without a trailing slash, so `/a/` and `/a` match. */
function placeOf(path: string): string {
  const [pathname = path] = path.split(/[?#]/, 1);
  const rest = path.slice(pathname.length);
  return (pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname) + rest;
}

/**
 * Whether the pinned tab `id` has been taken away from its home: the place
 * it was pinned at, or `root`, the panel's start, for a pin that has none.
 * False for a tab that is not pinned, or has no location yet.
 */
export function awayFromHome(state: TabsState, id: TabId, root: string | null): boolean {
  if (!state.pinned.includes(id)) return false;
  const path = state.paths[id];
  const home = state.homes[id] ?? root;
  if (path === undefined || home === null) return false;
  return placeOf(path) !== placeOf(home);
}

/**
 * The part of `path` past the destination's root, for showing where a tab
 * is: `pulls/4` for `/plugins/gh/gh/pulls/4`. Null at the root itself, or
 * for a path outside it.
 */
export function subPathOf(path: string | undefined, root: string | null): string | null {
  if (path === undefined || root === null || !path.startsWith(root)) return null;
  const rest = path.slice(root.length);
  if (rest !== "" && !/^[/?#]/.test(rest)) return null;
  const trimmed = rest.replace(/^\/+/, "").replace(/\/+(?=[?#]|$)/, "");
  if (trimmed === "") return null;
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

/**
 * Note where `id` is. A reset pin the user has gone back to has been taken
 * as it is, so ⌃⇧T no longer gives back the location it forgot.
 */
export function recordPath(state: TabsState, id: TabId, path: string): TabsState {
  if (!isAppPath(path)) return state;
  // Checked even when the path has not changed: a reset pin comes back at
  // its home, which is already its path.
  const taken = state.closed.some((c) => c.id === id && c.reset);
  if (state.paths[id] === path && !taken) return state;
  const closed = taken ? state.closed.filter((c) => c.id !== id) : state.closed;
  return { ...state, paths: { ...state.paths, [id]: path }, closed };
}

/** Fill an empty strip once, from the destinations the sidebar showed. */
export function seed(state: TabsState, visibleDestinations: readonly string[]): TabsState {
  if (state.seeded) return state;
  let next: TabsState = { ...state, seeded: true };
  for (const id of visibleDestinations) next = adopt(next, id);
  return next;
}

function withoutPath(paths: Readonly<Record<string, string>>, id: string) {
  if (!(id in paths)) return paths;
  const { [id]: _removed, ...rest } = paths;
  return rest;
}

function remember(closed: readonly ClosedTab[], entries: readonly ClosedTab[]): ClosedTab[] {
  return [...entries, ...closed.filter((c) => !entries.some((e) => e.id === c.id))].slice(
    0,
    CLOSED_LIMIT,
  );
}

/**
 * Where closing the tab in view goes: to its right-hand neighbour, as a
 * browser does, or back to the tab in view before it, as VS Code does.
 */
export type CloseOrder = "position" | "recent";

/** The `recentAfterClose` setting. */
export function closeOrderOf(value: unknown): CloseOrder {
  return value === true ? "recent" : "position";
}

/** The tab most recently in view that is still open, other than `id`. */
function lastInView(
  open: readonly string[],
  recent: readonly TabId[],
  id: string,
  skip: readonly string[] = [],
): TabId | undefined {
  return recent.find(
    (other) => other !== id && !skip.includes(other) && (other === THREADS || open.includes(other)),
  );
}

/**
 * The tab to show after closing `id` while `active` is in view.
 *
 * Closing a background tab changes nothing. Closing the one in view moves to
 * its right-hand neighbour, as a browser does, then its left, then Threads.
 * In recent order it goes back to the tab in view before it instead, and to
 * the neighbour once no tab it remembers is still open.
 */
export function successorAfterClose(
  open: readonly string[],
  id: string,
  active: TabId | null,
  order: CloseOrder = "position",
  recent: readonly TabId[] = [],
): TabId | null {
  if (id !== active) return active;
  const index = open.indexOf(id);
  if (index === -1) return active;
  if (order === "recent") {
    const last = lastInView(open, recent, id);
    if (last !== undefined) return last;
  }
  return open[index + 1] ?? open[index - 1] ?? THREADS;
}

/**
 * The tab to show after the close-tab command leaves the pinned tab `id`.
 *
 * It moves past the other pins, as VS Code skips its pinned editors, so
 * pressing the shortcut again closes an ordinary tab rather than stepping
 * through every pin: the first ordinary tab, or in recent order the one most
 * recently in view, and Threads when there is none.
 */
export function successorAfterPinClose(
  open: readonly string[],
  pinned: readonly string[],
  id: string,
  order: CloseOrder = "position",
  recent: readonly TabId[] = [],
): TabId {
  if (order === "recent") {
    const last = lastInView(open, recent, id, pinned);
    if (last !== undefined) return last;
  }
  return open.find((other) => !pinned.includes(other)) ?? THREADS;
}

/**
 * Close a pinned tab without unpinning it, as Arc does: it stays in the
 * strip and goes back to its home, the place it was pinned at, or with no
 * home forgets where it was left, so it next opens at its start. The
 * location goes on the closed list, so ⌃⇧T can give it back.
 */
export function resetPinned(state: TabsState, id: TabId): TabsState {
  const path = state.paths[id];
  const home = state.homes[id];
  if (!state.pinned.includes(id) || path === undefined || path === home) return state;
  const entry: ClosedTab = { id, path, index: state.open.indexOf(id), reset: true };
  return {
    ...state,
    paths: home === undefined ? withoutPath(state.paths, id) : { ...state.paths, [id]: home },
    closed: remember(state.closed, [entry]),
  };
}

/**
 * What the strip does with bb's Close on a page shown on its own (bb 0.45+).
 *
 * bb opens New Thread there. For a destination tab that would leave the tab
 * open behind Threads, so the strip answers it as the close-tab command does:
 * it closes the tab, or resets a pinned one and leaves it, pinned. Null when
 * bb keeps its own behaviour: on Threads, where New Thread is where it should
 * go anyway, and on pages no tab holds.
 */
export function pageCloseAction(
  active: TabId | null,
  pinned: readonly string[],
): "tab" | "pin" | null {
  if (active === null || active === THREADS) return null;
  return pinned.includes(active) ? "pin" : "tab";
}

/**
 * What the close-tab command does: what bb's Close does on a destination tab
 * (see pageCloseAction), or, on Threads, which cannot close, press bb's Close
 * on the lone thread page so it opens New Thread. Null when there is nothing
 * to close: Threads with no Close on screen (a split, or the compose screen
 * itself).
 */
export function closeCommandAction(
  active: TabId | null,
  pinned: readonly string[],
  hasPageClose: boolean,
): "tab" | "pin" | "page" | null {
  if (active === THREADS) return hasPageClose ? "page" : null;
  return pageCloseAction(active, pinned);
}

/** Close tabs. Pinned tabs are skipped: unpin a tab to close it. */
export function close(state: TabsState, ids: readonly string[]): TabsState {
  const closing = ids.filter((id) => state.open.includes(id) && !state.pinned.includes(id));
  if (closing.length === 0) return state;
  // A batch is remembered leftmost first, so reopening it rebuilds the strip
  // left to right and every tab lands straight back in its own slot.
  const entries = closing
    .map((id) => ({ id, path: state.paths[id] ?? null, index: state.open.indexOf(id) }))
    .sort((a, b) => a.index - b.index);
  let paths = state.paths;
  for (const id of closing) paths = withoutPath(paths, id);
  return {
    ...state,
    open: state.open.filter((id) => !closing.includes(id)),
    paths,
    closed: remember(state.closed, entries),
  };
}

export function closeOthers(state: TabsState, keep: TabId): TabsState {
  return close(
    state,
    state.open.filter((id) => id !== keep),
  );
}

export function closeToRight(state: TabsState, of: TabId): TabsState {
  // Everything right of Threads is everything.
  const index = of === THREADS ? -1 : state.open.indexOf(of);
  if (of !== THREADS && index === -1) return state;
  return close(state, state.open.slice(index + 1));
}

/**
 * The most recently closed tab that can still open, or reset pin that is
 * still open. `isAvailable` filters out destinations whose plugin has since
 * gone away. A closed tab reopened another way since is passed over.
 */
export function reopenable(
  state: TabsState,
  isAvailable: (id: string) => boolean,
): ClosedTab | undefined {
  return state.closed.find(
    (c) => isAvailable(c.id) && state.open.includes(c.id) === (c.reset === true),
  );
}

/**
 * Reopen the most recently closed tab, or give a reset pin back its
 * location. See `reopenable`.
 */
export function reopen(
  state: TabsState,
  isAvailable: (id: string) => boolean,
): { state: TabsState; tab: ClosedTab | null } {
  const tab = reopenable(state, isAvailable);
  if (tab === undefined) return { state, tab: null };
  if (tab.reset) {
    return {
      state: {
        ...state,
        paths: tab.path === null ? state.paths : { ...state.paths, [tab.id]: tab.path },
        closed: state.closed.filter((c) => c !== tab),
      },
      tab,
    };
  }
  const open = [...state.open];
  // Back in its old slot, but never among the pinned tabs.
  const index = Math.max(state.pinned.length, Math.min(tab.index, open.length));
  open.splice(index, 0, tab.id);
  return {
    state: {
      ...state,
      open,
      paths: tab.path === null ? state.paths : { ...state.paths, [tab.id]: tab.path },
      closed: state.closed.filter((c) => c !== tab),
    },
    tab,
  };
}

/**
 * Move a tab to `toIndex` among the open tabs, kept within its own group:
 * dragging never pins or unpins a tab.
 */
export function move(state: TabsState, id: string, toIndex: number): TabsState {
  const from = state.open.indexOf(id);
  if (from === -1) return state;
  const pinnedCount = state.pinned.length;
  const [low, high] = state.pinned.includes(id)
    ? [0, pinnedCount - 1]
    : [pinnedCount, state.open.length - 1];
  const to = Math.max(low, Math.min(high, toIndex));
  if (from === to) return state;
  const open = [...state.open];
  open.splice(from, 1);
  open.splice(to, 0, id);
  return { ...state, open };
}

/**
 * Move a tab in front of `beforeId`, or to the end of its own group when
 * `beforeId` is null or belongs to the other group. A drag names the tab it
 * is over rather than an index, so tabs that are open but not drawn — their
 * plugin is not loaded — keep their places.
 */
export function moveBefore(state: TabsState, id: string, beforeId: string | null): TabsState {
  if (!state.open.includes(id)) return state;
  const group = state.pinned.includes(id);
  const without = state.open.filter((other) => other !== id);
  const sameGroup =
    beforeId !== null && without.includes(beforeId) && state.pinned.includes(beforeId) === group;
  const at = sameGroup
    ? without.indexOf(beforeId)
    : group
      ? state.pinned.length - 1
      : without.length;
  const open = [...without];
  open.splice(at, 0, id);
  return open.every((other, i) => other === state.open[i]) ? state : { ...state, open };
}

/** The neighbour of `active` in strip order, wrapping at both ends. */
export function cycle(order: readonly TabId[], active: TabId | null, direction: 1 | -1): TabId {
  if (order.length === 0) return THREADS;
  const index = active === null ? -1 : order.indexOf(active);
  if (index === -1) return direction === 1 ? order[0]! : order[order.length - 1]!;
  return order[(index + direction + order.length) % order.length]!;
}

export interface SidebarStepInput {
  /** The tab in view before, or undefined when this is the first look. */
  previous: TabId | null | undefined;
  next: TabId | null;
  sidebarOpen: boolean;
  /** Whether the sidebar was open on each tab when the user left it. */
  sidebar: SidebarMemory;
}

export interface SidebarStep {
  action: "collapse" | "expand" | null;
  sidebar: SidebarMemory;
}

/**
 * Whether the sidebar is open on a tab the strip has no memory of. Settings
 * opens it, because bb fills the sidebar with Settings' own sections there;
 * any other destination collapses it, so the page gets the whole window.
 * Threads has no default: the strip learns it from what it finds there.
 */
function sidebarDefault(tab: TabId): boolean | undefined {
  if (tab === THREADS) return undefined;
  return tab === SETTINGS;
}

/** `memory` with `tab` set to `open`, or `memory` itself if it already was. */
export function rememberSidebar(memory: SidebarMemory, tab: TabId, open: boolean): SidebarMemory {
  return memory[tab] === open ? memory : { ...memory, [tab]: open };
}

/**
 * What the sidebar should do when the tab in view changes.
 *
 * Each tab keeps the sidebar as the user left it there. Leaving a tab records
 * whether the sidebar was open; arriving on one — by switching, or by loading
 * the app there — opens or collapses it to match. A tab never seen before
 * starts from `sidebarDefault`. A route that belongs to no tab leaves the
 * sidebar alone.
 */
export function sidebarStep(input: SidebarStepInput): SidebarStep {
  const { previous, next, sidebarOpen } = input;
  let { sidebar } = input;
  if (previous === next || next === null) return { action: null, sidebar };
  if (previous !== undefined && previous !== null) {
    sidebar = rememberSidebar(sidebar, previous, sidebarOpen);
  }
  const want = sidebar[next] ?? sidebarDefault(next);
  // Never seen Threads: learn the preference instead of imposing one.
  if (want === undefined) return { action: null, sidebar: rememberSidebar(sidebar, next, sidebarOpen) };
  if (want === sidebarOpen) return { action: null, sidebar };
  return { action: want ? "expand" : "collapse", sidebar };
}

// ---------------------------------------------------------------- splits

export interface PaneRect {
  /** Fractions of the split area. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One pane of bb's split layout, as `useSidebarSplitLayout()` reports it. */
export interface SplitPane {
  paneId: string;
  rect: PaneRect;
  /** The thread the pane shows, or null for anything else. */
  threadId: string | null;
  isFocused: boolean;
}

export interface ScreenPane extends SplitPane {
  /** The tab whose content the pane shows, or null when no tab owns it. */
  tab: TabId | null;
}

/**
 * Which tab each pane of a split shows, or null when no split is on screen.
 *
 * A pane showing a thread belongs to Threads. Any other pane belongs to the
 * destination bb reports there (`destinationPanes`: destination id → the
 * panes holding it), or to no tab.
 *
 * bb keeps a split in memory while a page that cannot sit in a pane — its own
 * Plugins page, Settings — takes the whole view, and restores it afterwards.
 * So the split is on screen only while one of its panes shows the tab the
 * route belongs to. Which pane bb calls focused is no guide: it can trail the
 * route by a render, and a page that took the view inherits the focused slot.
 */
export function panesOnScreen(
  layout: readonly SplitPane[] | null,
  destinationPanes: ReadonlyMap<string, readonly string[]>,
  active: TabId | null,
): ScreenPane[] | null {
  if (layout === null || layout.length < 2 || active === null) return null;
  const screen = layout.map((pane): ScreenPane => {
    if (pane.threadId !== null) return { ...pane, tab: THREADS };
    for (const [id, paneIds] of destinationPanes) {
      if (paneIds.includes(pane.paneId)) return { ...pane, tab: id };
    }
    return { ...pane, tab: null };
  });
  return screen.some((pane) => pane.tab === active) ? screen : null;
}

/** The panes `tab` is on screen in. */
export function panesOf(screen: readonly ScreenPane[] | null, tab: TabId): ScreenPane[] {
  return screen === null ? [] : screen.filter((pane) => pane.tab === tab);
}

/**
 * The thread pane Threads should focus, or null when no pane shows a thread.
 * Prefer the thread the tab last showed, so a split of two threads returns
 * to the one the user was in.
 */
export function threadPaneFor(
  screen: readonly ScreenPane[] | null,
  savedThreadId: string | null,
): ScreenPane | null {
  const threads = panesOf(screen, THREADS);
  return threads.find((pane) => pane.threadId === savedThreadId) ?? threads[0] ?? null;
}

/** Note that `tab` is in view, for choosing a split partner or where a close goes. */
export function recordRecent(state: TabsState, tab: TabId): TabsState {
  if (state.recent[0] === tab) return state;
  return {
    ...state,
    recent: [tab, ...state.recent.filter((id) => id !== tab)].slice(0, RECENT_LIMIT),
  };
}

/**
 * The tab to put beside `tab` when the user splits the tab they are looking
 * at.
 *
 * bb will not show one destination in two panes, so splitting the tab in
 * view has to bring in something else. The obvious something is the tab the
 * user was on just before; failing that, `fallbacks` in order. `canPair`
 * says whether a tab can sit in a pane at all right now.
 */
export function splitPartner(
  tab: TabId,
  recent: readonly TabId[],
  fallbacks: readonly TabId[],
  canPair: (id: TabId) => boolean,
): TabId | null {
  for (const id of [...recent, ...fallbacks]) {
    if (id !== tab && canPair(id)) return id;
  }
  return null;
}

// ------------------------------------------------------- thread switcher

/** The parts of a sidebar thread the switcher sorts on. */
export interface ThreadFacts {
  id: string;
  status: string;
  indicator: string;
  hasPendingInteraction: boolean;
  isArchived: boolean;
  isHidden: boolean;
  updatedAt: number;
  latestAttentionAt: number | null;
}

export type ThreadGroup = "needs-you" | "running" | "finished";

/**
 * What a thread wants from the user, if anything, most urgent first: an
 * answer (it is waiting for input), patience (it is running), or a look (it
 * finished since the user last read it).
 */
export function threadGroup(thread: ThreadFacts): ThreadGroup | null {
  if (thread.isArchived || thread.isHidden) return null;
  if (thread.hasPendingInteraction || thread.indicator === "waiting-for-input") return "needs-you";
  if (thread.status === "active" || thread.status === "starting") return "running";
  if (thread.indicator === "unread-success" || thread.indicator === "unread-error") return "finished";
  return null;
}

export interface ThreadGroups<T> {
  needsYou: T[];
  running: T[];
  finished: T[];
  /** Threads recently shown, not already listed above. */
  recent: T[];
}

function lastStirred(thread: ThreadFacts): number {
  return thread.latestAttentionAt ?? thread.updatedAt;
}

/**
 * The switcher's sections. Each lists the thread that most recently wanted
 * attention first; Recent keeps the order the user visited threads in.
 */
export function groupThreads<T extends ThreadFacts>(
  threads: readonly T[],
  recentIds: readonly string[],
  recentLimit = 5,
): ThreadGroups<T> {
  const groups: ThreadGroups<T> = { needsYou: [], running: [], finished: [], recent: [] };
  const listed = new Set<string>();
  for (const thread of threads) {
    const group = threadGroup(thread);
    if (group === null) continue;
    listed.add(thread.id);
    if (group === "needs-you") groups.needsYou.push(thread);
    else if (group === "running") groups.running.push(thread);
    else groups.finished.push(thread);
  }
  const byRecency = (a: T, b: T) => lastStirred(b) - lastStirred(a);
  groups.needsYou.sort(byRecency);
  groups.running.sort(byRecency);
  groups.finished.sort(byRecency);
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  for (const id of recentIds) {
    if (groups.recent.length === recentLimit) break;
    const thread = byId.get(id);
    if (thread === undefined || listed.has(id) || thread.isArchived || thread.isHidden) continue;
    groups.recent.push(thread);
  }
  return groups;
}

/** Note that the Threads tab showed `threadId`. */
export function recordRecentThread(state: TabsState, threadId: string): TabsState {
  if (state.recentThreads[0] === threadId) return state;
  return {
    ...state,
    recentThreads: [threadId, ...state.recentThreads.filter((id) => id !== threadId)].slice(
      0,
      RECENT_THREADS_LIMIT,
    ),
  };
}

/** "now", "5m", "3h", "2d": how long ago, as briefly as a row allows. */
export function ago(then: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - then) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
