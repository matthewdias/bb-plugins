// Every place this plugin depends on bb's DOM rather than its plugin API.
//
// The SDK has no way to read or set whether the sidebar is open, and no slot
// that reserves room above the app. So the sidebar is read from the
// attributes bb's sidebar primitive publishes (`data-side`, `data-state`,
// `data-collapsible`) and toggled by clicking bb's own toggle — never by
// restyling it — so the collapse animates, the page header makes room for the
// toggle, and bb's state stays the single source of truth. Each lookup
// returns null when its element is missing, and every caller treats null as
// "leave it alone": if bb renames these, the strip keeps working and only the
// automatic collapse stops.
//
// The room above the app is reserved in top-tabs.css, for the same reason and
// with the same failure mode.

const SIDEBAR = '[data-side="left"][data-collapsible]';
const TRIGGER = '[data-sidebar="trigger"]';

/** bb's `md` breakpoint: below it the sidebar is a drawer and the strip hides. */
export const COMPACT_QUERY = "(max-width: 767px)";

/** Whether the sidebar is expanded, or null when it cannot be found. */
export function isSidebarOpen(): boolean | null {
  const sidebar = document.querySelector(SIDEBAR);
  if (sidebar === null) return null;
  const state = sidebar.getAttribute("data-state");
  if (state === "expanded") return true;
  if (state === "collapsed") return false;
  return null;
}

/**
 * Call `onChange` whenever the sidebar opens or closes. Watches only the
 * sidebar's own `data-state`, never the whole document.
 */
export function observeSidebar(onChange: (open: boolean) => void): () => void {
  const sidebar = document.querySelector(SIDEBAR);
  if (sidebar === null) return () => {};
  const observer = new MutationObserver(() => {
    const open = isSidebarOpen();
    if (open !== null) onChange(open);
  });
  observer.observe(sidebar, { attributes: true, attributeFilter: ["data-state"] });
  return () => observer.disconnect();
}

/**
 * Close one pane of a split with its own header button. Closing a tab that is
 * on screen closes the view too, as it would in a browser; bb then decides
 * which pane takes focus. Returns false when the button cannot be found.
 */
export function closePane(paneId: string): boolean {
  const pane = document.querySelector(`[data-split-pane-id="${CSS.escape(paneId)}"]`);
  const button = pane?.querySelector<HTMLElement>('button[aria-label="Close pane"]');
  if (button == null) return false;
  button.click();
  return true;
}

/** Where bb lays out its pages, beside the sidebar and below the strip. */
export function contentRect(): DOMRect | null {
  return document.querySelector('[data-testid="app-layout-content-shell"]')?.getBoundingClientRect() ?? null;
}

const INSTANT_CLASS = "bb-top-tabs-instant-sidebar";

/**
 * Click bb's sidebar toggle. Returns false when it cannot be found.
 *
 * `instant` switches off bb's 200ms slide for this one toggle (see
 * top-tabs.css). The strip toggles the sidebar as part of switching tabs, and
 * an animated width there means the page being switched to lays itself out
 * again on every frame of the slide; a browser tab switch does not animate
 * either. A toggle the user makes by hand still slides.
 */
export function toggleSidebar(options: { instant?: boolean } = {}): boolean {
  const trigger = document.querySelector<HTMLElement>(TRIGGER);
  if (trigger === null) return false;
  if (options.instant === true) {
    const root = document.documentElement;
    root.classList.add(INSTANT_CLASS);
    // Two frames: the class has to outlive the render that applies the new
    // width, however long that render blocks the main thread.
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove(INSTANT_CLASS)));
  }
  trigger.click();
  return true;
}
