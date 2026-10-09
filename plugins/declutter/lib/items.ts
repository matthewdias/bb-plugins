// What Declutter can hide, how it finds each thing in bb's DOM, and the CSS
// that hides it.
//
// bb has no setting for any of this: it draws every thread-header control and
// message action that is registered, and every composer banner. So the only
// lever is CSS, keyed on what bb's markup publishes. Each selector below names
// an attribute bb sets on purpose (a data-* hook or an accessible name), never
// a class. If bb renames one, the cost is that an item shows again, not a
// broken app.
//
// An item is identified by what a person can see — the plugin that draws it
// and its accessible name — because bb gives these surfaces no stable ids:
//
//   header   a plugin's control: [data-bb-plugin=P] > [role=group][aria-label=L]
//            bb's own button:    button[aria-label=L] outside any plugin root
//            bb's split button:  [data-thread-header-responsive-action], named by
//                                its first button. Commit has no aria-label, only
//                                text, which CSS cannot match, so the overlay
//                                marks those (markTextNamed) and CSS hides the mark.
//   banner   [data-app-composer] > div > [data-bb-plugin=P]. One per plugin;
//            bb does not mark which of a plugin's banners is which.
//   message  [data-bb-chat-timestamp] > button[aria-label=L]. bb draws these
//            itself, plugin actions included, so only the label tells them
//            apart.

export const SURFACES = ["header", "banner", "message"] as const;
export type Surface = (typeof SURFACES)[number];

export interface Item {
  surface: Surface;
  /** The plugin that draws it, or null for bb's own (and for every message action). */
  pluginId: string | null;
  /** Its accessible name, shortcut hint removed. Null for banners, which have none. */
  label: string | null;
}

export const LABEL_MAX = 300;
export const PLUGIN_ID_MAX = 200;

/** One string per item, lossless, so the hidden list can be turned back into CSS. */
export function keyOf(item: Item): string {
  return JSON.stringify([item.surface, item.pluginId, item.label]);
}

export function itemOf(key: string): Item | null {
  try {
    const parsed: unknown = JSON.parse(key);
    if (!Array.isArray(parsed) || parsed.length !== 3) return null;
    const [surface, pluginId, label] = parsed as unknown[];
    if (!SURFACES.includes(surface as Surface)) return null;
    if (pluginId !== null && typeof pluginId !== "string") return null;
    if (label !== null && typeof label !== "string") return null;
    return { surface: surface as Surface, pluginId, label };
  } catch {
    return null;
  }
}

/**
 * bb appends the keyboard shortcut to some names: "Show right panel (⌘ J)",
 * "Open workspace in VS Code (⌘ O)". Dropped, so the item is the same on
 * every platform; `labelSelector` matches either form.
 */
export function cleanLabel(label: string): string {
  return label.replace(/\s+\([^()]*(?:[⌘⌥⇧⌃]|\bCtrl\b|\bAlt\b|\bShift\b)[^()]*\)$/u, "").trim();
}

const HEADER_ROW = '[data-testid="app-page-header-content-row"]';
const HEADER_PLUGINS = "[data-thread-header-workflow-actions] > [data-bb-plugin]";
const RESPONSIVE = "[data-thread-header-responsive-action]";
const BANNERS = "[data-app-composer] > div > [data-bb-plugin]";
const MESSAGE_BAR = "[data-bb-chat-timestamp]";

/** Set by the overlay on a split button named only by its text, when hidden. */
export const MARK_ATTR = "data-declutter-hidden";

/** A CSS string literal. */
function str(value: string): string {
  return `"${value.replace(/["\\]/g, "\\$&").replace(/\n/g, "\\a ")}"`;
}

/** Matches the clean label with or without bb's shortcut hint after it. */
function labelSelectors(prefix: string, label: string): string[] {
  return [`${prefix}[aria-label=${str(label)}]`, `${prefix}[aria-label^=${str(`${label} (`)}]`];
}

export function selectorsFor(item: Item): string[] {
  switch (item.surface) {
    case "header":
      if (item.label === null) return [];
      if (item.pluginId !== null) {
        return [
          `[data-thread-header-workflow-actions] > [data-bb-plugin=${str(item.pluginId)}] > [role="group"][aria-label=${str(item.label)}]`,
        ];
      }
      return [
        // A split button (Open in VS Code and its app chooser) is hidden whole.
        `${HEADER_ROW} ${RESPONSIVE}:has(${labelSelectors("button", item.label).join(", ")})`,
        ...labelSelectors("button", item.label).map(
          (button) => `${HEADER_ROW} ${button}:not([data-bb-plugin-root] *)`,
        ),
        `${HEADER_ROW} ${RESPONSIVE}[${MARK_ATTR}]`,
      ];
    case "banner":
      return item.pluginId === null
        ? []
        : [`[data-app-composer] > div > [data-bb-plugin=${str(item.pluginId)}]`];
    case "message":
      return item.label === null ? [] : labelSelectors(`${MESSAGE_BAR} > button`, item.label);
  }
}

/** The stylesheet that hides `items`. Empty when nothing is hidden. */
export function stylesheetFor(items: readonly Item[]): string {
  const selectors = [...new Set(items.flatMap(selectorsFor))];
  if (selectors.length === 0) return "";
  return `${selectors.join(",\n")} {\n  display: none !important;\n}\n`;
}

function attr(el: Element, name: string): string | null {
  const value = el.getAttribute(name)?.trim();
  return value ? value : null;
}

/** bb's split buttons under `root`, each named by its first button's label or text. */
function splitButtons(root: ParentNode): { el: Element; label: string }[] {
  const found: { el: Element; label: string }[] = [];
  for (const el of root.querySelectorAll(RESPONSIVE)) {
    if (el.closest("[data-bb-plugin-root]")) continue;
    const button = el.querySelector("button");
    const name = button && (attr(button, "aria-label") ?? button.textContent?.trim());
    if (name) found.push({ el, label: cleanLabel(name) });
  }
  return found;
}

/**
 * Marks the split buttons `items` hides, and unmarks the rest. Returns whether
 * any of `items` could need a mark, so the caller knows to keep re-running it
 * as bb re-renders the header.
 */
export function markTextNamed(root: ParentNode, items: readonly Item[]): boolean {
  const names = new Set(
    items.flatMap((item) => (item.surface === "header" && item.pluginId === null && item.label ? [item.label] : [])),
  );
  const want = new Set<Element>();
  if (names.size > 0) {
    for (const row of root.querySelectorAll(HEADER_ROW)) {
      for (const split of splitButtons(row)) if (names.has(split.label)) want.add(split.el);
    }
  }
  for (const el of root.querySelectorAll(`[${MARK_ATTR}]`)) if (!want.has(el)) el.removeAttribute(MARK_ATTR);
  for (const el of want) if (!el.hasAttribute(MARK_ATTR)) el.setAttribute(MARK_ATTR, "");
  return names.size > 0;
}

/**
 * Everything of the three kinds on screen now, hidden ones included: hiding
 * is `display: none`, so a hidden item is still in the DOM and still found.
 */
export function scan(root: ParentNode): Item[] {
  const found = new Map<string, Item>();
  const add = (item: Item) => {
    if (item.label !== null) item.label = item.label.slice(0, LABEL_MAX);
    if (item.pluginId !== null && item.pluginId.length > PLUGIN_ID_MAX) return;
    found.set(keyOf(item), item);
  };

  for (const group of root.querySelectorAll(`${HEADER_PLUGINS} > [role="group"][aria-label]`)) {
    const pluginId = attr(group.parentElement!, "data-bb-plugin");
    const label = attr(group, "aria-label");
    if (pluginId && label) add({ surface: "header", pluginId, label });
  }

  for (const row of root.querySelectorAll(HEADER_ROW)) {
    for (const button of row.querySelectorAll("button[aria-label]")) {
      if (button.closest(`[data-bb-plugin-root], ${RESPONSIVE}`)) continue;
      const label = attr(button, "aria-label");
      if (label) add({ surface: "header", pluginId: null, label: cleanLabel(label) });
    }
    for (const split of splitButtons(row)) add({ surface: "header", pluginId: null, label: split.label });
  }

  for (const banner of root.querySelectorAll(BANNERS)) {
    const pluginId = attr(banner, "data-bb-plugin");
    if (pluginId) add({ surface: "banner", pluginId, label: null });
  }

  for (const button of root.querySelectorAll(`${MESSAGE_BAR} > button[aria-label]`)) {
    const label = attr(button, "aria-label");
    if (label) add({ surface: "message", pluginId: null, label: cleanLabel(label) });
  }

  return [...found.values()];
}
