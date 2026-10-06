// Plugin Triage's own item in bb's sidebar. bb has no way to badge its own
// Plugins item, so this one carries the count, and opening it shows the
// Triage page itself. It must not redirect into the Plugins screen: bb's
// "Back to app" returns to the last page outside that screen, which would be
// this one, and a redirect would send you straight back in.
import { useSyncExternalStore } from "react";
import { experimental_Icon as Icon, useSettings } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { countText, countedDecks, waitingCount } from "../lib/count";
import { TRIAGE_HREF } from "../screen/dom";
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

/** The item's page: the Triage page, under bb's title bar. */
export function TriageSidebarPanel() {
  return <TriagePage heading={false} />;
}

/** In bb's title bar over the item's page: the same Triage, in the Plugins screen. */
export function TriageSidebarHeader() {
  return (
    <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => navigateInApp(TRIAGE_HREF)}>
      <Icon name="ArrowUpRight" aria-hidden />
      Open in Plugins
    </Button>
  );
}
