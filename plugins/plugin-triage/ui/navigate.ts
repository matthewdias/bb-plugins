import { DEFAULT_TAB, searchForTab, type Tab } from "../lib/tabs";

/**
 * Go to a bb route without a reload. bb uses a browser router, which listens
 * for popstate, and the SDK's navigation reaches only this plugin's own
 * panels: pushing the path and announcing it is how the Triage row, the
 * install toast's Open settings button and a Saved card reach bb's own pages.
 */
export function navigateInApp(to: string): void {
  window.history.pushState({}, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/**
 * bb's detail pane for a store entry. bb opens it beside whichever list the
 * URL's `view` names, and its own cards keep that view, so this keeps Triage,
 * and the tab the details were opened from.
 */
export function pluginDetailsPath(pluginId: string, tab: Tab = DEFAULT_TAB): string {
  return `/plugins/${encodeURIComponent(pluginId)}${searchForTab("?view=triage", tab)}`;
}
