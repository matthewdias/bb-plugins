// The sync loop for bb's Plugins screen: keeps a Triage row in its sidebar
// and, on /plugins?view=triage, a container in its main panel for the page to
// be portaled into. Kept apart from React so it can be driven under jsdom.
//
// Every pass recomputes the highlight from the URL alone and remembers
// nothing. Another plugin doing the same thing (Plugin Shelf moves bb's
// highlight to its own row, and puts back whatever it took on leaving) can
// therefore never leave this row lit on the wrong page: the next pass, which
// that very attribute change triggers, puts it right.
import {
  ACTIVE_ATTR,
  BROWSE_HREF,
  INSTALLED_HREF,
  ROOT_ATTR,
  ROW_ATTR,
  TRIAGE_HREF,
  buildRow,
  ensureStyle,
  findPanel,
  findPluginsSidebar,
  insertionPoint,
  isTriageView,
  removeStyle,
  setCurrent,
  setRowCount,
  type PluginsSidebar,
} from "./dom";

export interface ScreenEngineDeps {
  signal: AbortSignal;
  doc: Document;
  location: () => { pathname: string; search: string };
  /** Defer a pass. Returns a cancel function. `requestAnimationFrame` in bb. */
  defer: (run: () => void) => () => void;
  /** Navigate inside bb without a reload. */
  navigate: (to: string) => void;
  /** The container to portal the page into, or null when it is not shown. */
  onPanel: (container: HTMLElement | null) => void;
}

export interface ScreenEngine {
  /** Run a pass now, skipping the scheduler. Tests use this. */
  syncNow: () => void;
  /** Show a count on the row, or clear it with null. */
  setCount: (count: number | null) => void;
  dispose: () => void;
}

/** bb's own row for this location, if the location is one of bb's views. */
function nativeRowFor(sidebar: PluginsSidebar, location: { pathname: string; search: string }): HTMLAnchorElement | null {
  if (location.pathname !== BROWSE_HREF) return null;
  const view = new URLSearchParams(location.search).get("view");
  if (view === null) return sidebar.browse;
  if (`${BROWSE_HREF}?view=${view}` === INSTALLED_HREF) return sidebar.installed;
  return null;
}

export function startScreenEngine(deps: ScreenEngineDeps): ScreenEngine {
  const { signal, doc, defer } = deps;
  let pending = false;
  let cancel: (() => void) | null = null;
  let container: HTMLElement | null = null;
  let count: number | null = null;

  function onClick(event: MouseEvent): void {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    deps.navigate(TRIAGE_HREF);
  }

  function setContainer(next: HTMLElement | null): void {
    if (next === container) return;
    container = next;
    deps.onPanel(next);
  }

  function syncRow(triage: boolean): void {
    const sidebar = findPluginsSidebar(doc);
    if (sidebar === null) return;
    const { parent } = sidebar;
    let row = parent.querySelector<HTMLAnchorElement>(`:scope > [${ROW_ATTR}]`);
    if (row === null) {
      const template = sidebar.installed.hasAttribute("aria-current") ? sidebar.browse : sidebar.installed;
      row = buildRow(template, onClick);
    }
    const after = insertionPoint(sidebar);
    if (after.nextElementSibling !== row) after.after(row);
    setRowCount(row, count);
    setCurrent(row, triage);

    if (triage) {
      // bb still thinks Browse is current here; so may another plugin's row.
      for (const other of parent.querySelectorAll<HTMLAnchorElement>(`:scope > a[aria-current="page"]`)) {
        if (other !== row) setCurrent(other, false);
      }
      return;
    }
    // Leaving for a page bb's router does not redraw the sidebar for (Browse,
    // when bb thought Browse was current all along) leaves no row lit. Light
    // bb's row for the URL, but only when nothing is: a page another plugin
    // draws lights its own row, and that is not this plugin's to change.
    const native = nativeRowFor(sidebar, deps.location());
    if (native !== null && parent.querySelector(`:scope > a[aria-current="page"]`) === null) {
      setCurrent(native, true);
    }
  }

  function syncPanel(triage: boolean): void {
    const panel = triage ? findPanel(doc) : null;
    if (panel === null) {
      clearPanel();
      return;
    }
    ensureStyle(doc);
    if (!panel.hasAttribute(ACTIVE_ATTR)) panel.setAttribute(ACTIVE_ATTR, "");
    let root = panel.querySelector<HTMLElement>(`:scope > [${ROOT_ATTR}]`);
    if (root === null) {
      root = doc.createElement("div");
      root.setAttribute(ROOT_ATTR, "");
      panel.append(root);
    }
    setContainer(root);
  }

  function clearPanel(): void {
    for (const panel of doc.querySelectorAll(`[${ACTIVE_ATTR}]`)) panel.removeAttribute(ACTIVE_ATTR);
    for (const root of doc.querySelectorAll(`[${ROOT_ATTR}]`)) root.remove();
    setContainer(null);
  }

  function syncNow(): void {
    if (signal.aborted) return;
    const triage = isTriageView(deps.location());
    syncRow(triage);
    syncPanel(triage);
  }

  function schedule(): void {
    if (signal.aborted || pending) return;
    pending = true;
    // A flag rather than the cancel handle, because a defer that runs its
    // callback at once returns the handle after the pass has already finished.
    const handle = defer(() => {
      pending = false;
      cancel = null;
      syncNow();
    });
    cancel = pending ? handle : null;
  }

  // bb's router changes the URL with pushState, which fires no event, but
  // every route change redraws part of the page, so DOM changes are the cue.
  // Highlight changes count too: they are how another plugin's row takes or
  // gives back the current-page state.
  const observer = new MutationObserver(schedule);
  observer.observe(doc.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-current"],
  });
  const win = doc.defaultView;
  win?.addEventListener("popstate", schedule);
  schedule();

  function setCount(next: number | null): void {
    if (next === count) return;
    count = next;
    schedule();
  }

  function dispose(): void {
    observer.disconnect();
    win?.removeEventListener("popstate", schedule);
    cancel?.();
    cancel = null;
    pending = false;
    const triage = isTriageView(deps.location());
    for (const row of doc.querySelectorAll(`[${ROW_ATTR}]`)) row.remove();
    clearPanel();
    removeStyle(doc);
    // Unloaded while its page was shown: give bb's Browse row its light back.
    if (triage) {
      const sidebar = findPluginsSidebar(doc);
      if (sidebar && sidebar.parent.querySelector(`:scope > a[aria-current="page"]`) === null) {
        setCurrent(sidebar.browse, true);
      }
    }
  }

  signal.addEventListener("abort", dispose, { once: true });
  return { syncNow, setCount, dispose };
}
