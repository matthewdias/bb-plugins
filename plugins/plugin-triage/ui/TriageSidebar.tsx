// Plugin Triage's own item in bb's sidebar. bb has no way to badge its own
// Plugins item, so this one carries the count, and opening it goes to the
// Triage tab inside the Plugins screen, where the page lives.
import { useEffect, useSyncExternalStore } from "react";
import { useSettings } from "@get-bb/plugin-sdk/app";
import { countText, countedDecks, waitingCount } from "../lib/count";
import { TRIAGE_HREF } from "../screen/dom";
import { navigateInApp } from "./navigate";
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

/** The item's page: hands over to the Triage tab, leaving no step for Back. */
export function TriageSidebarPanel() {
  useEffect(() => {
    navigateInApp(TRIAGE_HREF, { replace: true });
  }, []);
  return null;
}
