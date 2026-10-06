// What a swipe started on, and whether it is ours to take.
//
// Everything here is read from bb's DOM, so it is the part that breaks when bb
// changes, and it breaks to "not ours": no gesture rather than a wrong one.
//
// - Thread rows carry `data-sidebar-thread-id`. bb's keyboard shortcuts find
//   rows by it, and the SDK requires every replacement thread list to set it,
//   so row swipes work with bb's list and with any other.
// - The main pane is `main[data-sidebar="inset"]`, on desktop and on a phone.
// - bb's own opt-outs are honored, and `data-no-swipe-controls` is ours, for
//   anything another plugin wants left alone.

export const ROW_SELECTOR = "[data-sidebar-thread-id]";

/**
 * The element that is the whole row. bb's anchor is only the title: the row
 * container around it also holds the status glyph and the hover actions, and
 * carries Tailwind's `group/thread-row` class. Another list can name its own
 * with `data-swipe-controls-row`. With neither, the anchor is the row.
 */
const SURFACE_SELECTOR = '[data-swipe-controls-row], [class~="group/thread-row"]';
export const INSET_SELECTOR = '[data-sidebar="inset"]';

const EDITABLE = [
  "input",
  "textarea",
  "select",
  '[contenteditable="true"]',
  '[contenteditable=""]',
  '[contenteditable="plaintext-only"]',
  '[role="slider"]',
].join(", ");

const OPT_OUT = "[data-no-swipe-controls]";

/** bb's markers for regions that keep horizontal drags to themselves. */
const BB_OPT_OUTS = "[data-no-sidebar-swipe], [data-no-secondary-panel-swipe], [data-vaul-no-drag]";

export interface RowTarget {
  /** The whole row: what slides. */
  element: HTMLElement;
  threadId: string;
}

function elementOf(target: EventTarget | null): Element | null {
  if (target === null || typeof target !== "object") return null;
  const node = target as Node;
  if (node.nodeType === 1) return node as Element;
  return node.parentElement ?? null;
}

/** The row an anchor belongs to. */
export function rowSurface(anchor: Element): HTMLElement {
  return anchor.closest<HTMLElement>(SURFACE_SELECTOR) ?? (anchor as HTMLElement);
}

/** The thread row a gesture started on, unless it started in a field inside it. */
export function rowTarget(target: EventTarget | null): RowTarget | null {
  const element = elementOf(target);
  if (element === null || element.closest(`${EDITABLE}, ${OPT_OUT}`) !== null) return null;
  const anchor =
    element.closest(ROW_SELECTOR) ?? element.closest(SURFACE_SELECTOR)?.querySelector(ROW_SELECTOR) ?? null;
  const threadId = anchor?.getAttribute("data-sidebar-thread-id") ?? "";
  return anchor !== null && threadId !== "" ? { element: rowSurface(anchor), threadId } : null;
}

/**
 * The main pane, when a gesture started somewhere in it that a back or
 * forward swipe may take. Our own row marks are on sidebar rows, never in
 * here, so honoring `data-no-sidebar-swipe` does not fight them.
 */
export function insetTarget(target: EventTarget | null): Element | null {
  const element = elementOf(target);
  if (element === null) return null;
  if (element.closest(`${EDITABLE}, ${OPT_OUT}, ${BB_OPT_OUTS}`) !== null) return null;
  return element.closest(INSET_SELECTOR);
}

function scrollsX(element: Element): boolean {
  const overflow = getComputedStyle(element).overflowX;
  if (overflow !== "auto" && overflow !== "scroll" && overflow !== "overlay") return false;
  return element.scrollWidth > element.clientWidth + 1;
}

/**
 * Whether something between `target` and `boundary` would still scroll
 * sideways for `deltaX`. A code block or diff scrolled to its edge lets the
 * swipe through, as a browser's own back-swipe does; one with room to go
 * keeps it.
 */
export function canScrollX(target: EventTarget | null, deltaX: number, boundary: Element): boolean {
  let element = elementOf(target);
  while (element !== null) {
    if (scrollsX(element)) {
      const max = element.scrollWidth - element.clientWidth;
      if (deltaX > 0 && element.scrollLeft < max - 1) return true;
      if (deltaX < 0 && element.scrollLeft > 0) return true;
    }
    if (element === boundary) return false;
    element = element.parentElement;
  }
  return false;
}
