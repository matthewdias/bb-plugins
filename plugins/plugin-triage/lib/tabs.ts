// Which Triage tab an address shows, and the address of each tab. The page
// lives in two places: bb's Plugins screen, where the tab is a `tab` query
// parameter beside `view=triage`, and Plugin Triage's own sidebar item, where
// it is the path under the item's page. New is the default and stays out of
// the address, so a plain link to Triage opens on New.

export const TABS = ["new", "updates", "cleanup", "saved"] as const;
export type Tab = (typeof TABS)[number];

export const DEFAULT_TAB: Tab = "new";

const isTab = (value: string): value is Tab => (TABS as readonly string[]).includes(value);

/** The tab a query string names; New when it names none, or one that doesn't exist. */
export function tabFromSearch(search: string): Tab {
  const value = new URLSearchParams(search).get("tab");
  return value !== null && isTab(value) ? value : DEFAULT_TAB;
}

/** The query string for `tab`, keeping the rest (`view=triage`). */
export function searchForTab(search: string, tab: Tab): string {
  const params = new URLSearchParams(search);
  if (tab === DEFAULT_TAB) params.delete("tab");
  else params.set("tab", tab);
  const next = params.toString();
  return next === "" ? "" : `?${next}`;
}

/** The tab the sidebar item's sub-path names: `updates`, or `updates/` from a typed URL. */
export function tabFromSubPath(subPath: string): Tab {
  const value = subPath.split("/")[0] ?? "";
  return isTab(value) ? value : DEFAULT_TAB;
}

export function subPathForTab(tab: Tab): string {
  return tab === DEFAULT_TAB ? "" : tab;
}
