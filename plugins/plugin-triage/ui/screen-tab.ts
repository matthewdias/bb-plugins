// The Triage tab inside bb's Plugins screen, kept in the `tab` query
// parameter. Switching pushes a history entry, so Back walks tabs. The page
// re-reads the address on popstate, which Back, Forward and navigateInApp all
// fire; bb's own pushState navigations (a detail pane opening or closing)
// fire nothing, and leave the tab as it was.
import { useCallback, useEffect, useState } from "react";
import { searchForTab, tabFromSearch, type Tab } from "../lib/tabs";
import { navigateInApp } from "./navigate";

export function useScreenTab(): [Tab, (tab: Tab) => void] {
  const [tab, setTab] = useState<Tab>(() => tabFromSearch(window.location.search));
  useEffect(() => {
    const read = () => setTab(tabFromSearch(window.location.search));
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);
  const go = useCallback((next: Tab) => {
    navigateInApp(window.location.pathname + searchForTab(window.location.search, next));
  }, []);
  return [tab, go];
}
