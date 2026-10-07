// Plugin Triage's own item in bb's sidebar. bb has no way to badge its own
// Plugins item, so this one carries the count, and opening it shows the
// Triage page itself. It must not redirect into the Plugins screen: bb's
// "Back to app" returns to the last page outside that screen, which would be
// this one, and a redirect would send you straight back in.
import { useSyncExternalStore } from "react";
import { experimental_Icon as Icon, useBbNavigate, useSettings, type PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { countText, countedDecks, waitingCount } from "../lib/count";
import { subPathForTab, tabFromSubPath } from "../lib/tabs";
import { BROWSE_HREF } from "../screen/dom";
import { navigateInApp } from "./navigate";
import { TriagePage } from "./TriagePage";
import { triageStore } from "./triage-store";

/** How many cards are waiting, by the decks the settings count; null until loaded. */
export function useWaitingCount(): number | null {
  const deck = useSyncExternalStore(triageStore.subscribe, triageStore.getSnapshot);
  const { values } = useSettings();
  return deck.status === "ready" ? waitingCount(deck, countedDecks(values)) : null;
}

/** The sidebar item's trailing count. */
export function TriageSidebarCount() {
  const count = useWaitingCount();
  if (count === null || count <= 0) return null;
  return (
    <span className="text-[11px] tabular-nums text-muted-foreground" aria-label={`${count} waiting in Triage`}>
      {countText(count)}
    </span>
  );
}

/** The item's path, as registered in app.tsx. */
export const SIDEBAR_PATH = "triage";

/**
 * The item's page: the Triage page, under bb's title bar. The tab is the path
 * under the item's page, `/plugins/plugin-triage/triage/updates`, and switching
 * goes through bb's panel navigation, so Back walks tabs here too.
 */
export function TriageSidebarPanel({ subPath }: PluginNavPanelProps) {
  const navigate = useBbNavigate();
  return (
    <TriagePage
      tab={tabFromSubPath(subPath)}
      onTab={(tab) => navigate.toPluginPanel(SIDEBAR_PATH, { subPath: subPathForTab(tab) })}
      heading={false}
    />
  );
}

/** In bb's title bar over the item's page: a way into the Plugins screen, at Browse plugins. */
export function TriageSidebarHeader() {
  return (
    <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => navigateInApp(BROWSE_HREF)}>
      <Icon name="ArrowUpRight" aria-hidden />
      Browse plugins
    </Button>
  );
}
