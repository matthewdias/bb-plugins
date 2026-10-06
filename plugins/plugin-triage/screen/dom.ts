// Reading and marking up bb's Plugins screen: its sidebar, where the Triage
// row goes, and its main panel, where the page is drawn. Anchors are the
// sidebar links' targets and the panel's id, never minified class names.
//
// Other plugins add rows to the same sidebar (Plugin Shelf adds My plugins),
// so nothing here assumes this plugin's row is the only addition, and nothing
// touches a node this plugin did not make, beyond the highlight on bb's own
// rows.
export const TRIAGE_HREF = "/plugins?view=triage";
export const ROW_ATTR = "data-plugin-triage-row";
export const ROOT_ATTR = "data-plugin-triage-root";
export const ACTIVE_ATTR = "data-plugin-triage-active";
const STYLE_ATTR = "data-plugin-triage-style";

export const BROWSE_HREF = "/plugins";
export const INSTALLED_HREF = "/plugins?view=installed";
const PANEL_ID = "extensions-main-panel";
/** The class bb adds to a sidebar row for the current page. */
export const ACTIVE_ROW_CLASS = "bg-sidebar-accent";

/**
 * The Plugins screen, or one entry's detail pane open beside it
 * (`/plugins/<id>`, which keeps the list's `view`), showing Triage. A deeper
 * path is a plugin's own panel, not this screen.
 */
export function isTriageView(location: { pathname: string; search: string }): boolean {
  return (
    /^\/plugins(\/[^/]+)?\/?$/.test(location.pathname) &&
    new URLSearchParams(location.search).get("view") === "triage"
  );
}

export interface PluginsSidebar {
  parent: HTMLElement;
  /** bb's Installed plugins row; added rows follow it. */
  installed: HTMLAnchorElement;
  browse: HTMLAnchorElement;
}

/**
 * The Installed plugins row, but only beside a Browse plugins row: that pair
 * is what makes it bb's Plugins sidebar rather than any other link to the
 * same page.
 */
export function findPluginsSidebar(doc: Document): PluginsSidebar | null {
  for (const installed of doc.querySelectorAll<HTMLAnchorElement>(`a[href="${INSTALLED_HREF}"]`)) {
    const parent = installed.parentElement;
    const browse = parent?.querySelector<HTMLAnchorElement>(`:scope > a[href="${BROWSE_HREF}"]`);
    if (parent && browse) return { parent, installed, browse };
  }
  return null;
}

/** A row added to the Plugins sidebar by any plugin: a view bb does not draw. */
function isAddedRow(node: Element): boolean {
  if (!(node instanceof HTMLAnchorElement)) return false;
  const href = node.getAttribute("href") ?? "";
  return href.startsWith("/plugins?view=") && href !== INSTALLED_HREF;
}

/**
 * Where the Triage row goes: after Installed and after every row other
 * plugins added there, so the order is the same whichever loaded first.
 */
export function insertionPoint(sidebar: PluginsSidebar): Element {
  let after: Element = sidebar.installed;
  let next = after.nextElementSibling;
  while (next !== null && isAddedRow(next) && !next.hasAttribute(ROW_ATTR)) {
    after = next;
    next = next.nextElementSibling;
  }
  return after;
}

export function buildRow(template: HTMLAnchorElement, onClick: (event: MouseEvent) => void): HTMLAnchorElement {
  const row = template.cloneNode(true) as HTMLAnchorElement;
  row.setAttribute(ROW_ATTR, "");
  row.setAttribute("href", TRIAGE_HREF);
  row.removeAttribute("data-discover");
  row.removeAttribute("aria-current");
  row.classList.remove(ACTIVE_ROW_CLASS);
  const label = row.querySelector("span.truncate") ?? row;
  label.textContent = "Triage";
  row.addEventListener("click", onClick);
  return row;
}

/** The count of waiting cards, drawn at the row's end. Null clears it. */
export function setRowCount(row: HTMLAnchorElement, count: number | null): void {
  const attr = `${ROW_ATTR}-count`;
  let badge = row.querySelector<HTMLElement>(`[${attr}]`);
  if (count === null || count <= 0) {
    badge?.remove();
    row.style.removeProperty("padding-right");
    return;
  }
  // bb's rows pad only the left, since none of its own ends in anything; the
  // count would sit against the right edge. Mirror the left padding there.
  const left = row.ownerDocument.defaultView?.getComputedStyle(row).paddingLeft ?? "";
  const right = Number.parseFloat(left) > 0 ? left : "0.5rem";
  if (row.style.paddingRight !== right) row.style.paddingRight = right;
  if (badge === null) {
    badge = row.ownerDocument.createElement("span");
    badge.setAttribute(attr, "");
    badge.style.marginLeft = "auto";
    badge.style.fontSize = "11px";
    badge.style.fontVariantNumeric = "tabular-nums";
    badge.style.opacity = "0.7";
    row.append(badge);
  }
  const text = count > 99 ? "99+" : String(count);
  if (badge.textContent !== text) badge.textContent = text;
}

export function setCurrent(row: HTMLAnchorElement, current: boolean): void {
  if (current) {
    if (row.getAttribute("aria-current") !== "page") row.setAttribute("aria-current", "page");
    if (!row.classList.contains(ACTIVE_ROW_CLASS)) row.classList.add(ACTIVE_ROW_CLASS);
  } else {
    if (row.hasAttribute("aria-current")) row.removeAttribute("aria-current");
    if (row.classList.contains(ACTIVE_ROW_CLASS)) row.classList.remove(ACTIVE_ROW_CLASS);
  }
}

export function findPanel(doc: Document): HTMLElement | null {
  return doc.getElementById(PANEL_ID);
}

/**
 * bb keeps rendering Browse into the panel while the page is shown there, and
 * may replace those nodes at any time, so they are hidden by a rule rather
 * than one by one.
 */
export function ensureStyle(doc: Document): void {
  if (doc.querySelector(`style[${STYLE_ATTR}]`)) return;
  const style = doc.createElement("style");
  style.setAttribute(STYLE_ATTR, "");
  style.textContent =
    `[${ACTIVE_ATTR}] > :not([${ROOT_ATTR}]) { display: none !important; }\n` +
    `[${ROOT_ATTR}] { height: 100%; min-height: 0; display: flex; flex-direction: column; }`;
  doc.head.append(style);
}

export function removeStyle(doc: Document): void {
  doc.querySelector(`style[${STYLE_ATTR}]`)?.remove();
}
