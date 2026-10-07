// The Triage page, drawn inside bb's Plugins screen: the New deck, Updates,
// Cleanup, and the plugins saved for later, each dealt as a deck.
import { useEffect, useSyncExternalStore } from "react";
import { useRpc, experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { rpcContract } from "../lib/contract";
import { TABS, type Tab } from "../lib/tabs";
import { EntryDeck } from "./EntryDeck";
import { CleanupPanel } from "./CleanupPanel";
import { QueueBar } from "./QueueBar";
import { UpdatesPanel } from "./UpdatesPanel";
import { triageStore } from "./triage-store";

const TAB_LABELS: Record<Tab, string> = { new: "New", updates: "Updates", cleanup: "Cleanup", saved: "Saved" };

/**
 * The tab comes from the address, so Back walks tabs and a reload or a link
 * keeps one; whoever hosts the page reads it and changes it (`onTab`).
 * `heading` is off where bb's own title bar already says Triage.
 */
export function TriagePage({ tab, onTab, heading = true }: { tab: Tab; onTab: (tab: Tab) => void; heading?: boolean }) {
  const rpc = useRpc<typeof rpcContract>();
  const deck = useSyncExternalStore(triageStore.subscribe, triageStore.getSnapshot);

  useEffect(() => {
    void triageStore.load(rpc);
  }, [rpc]);

  const queued = deck.status === "ready" && deck.queue.jobs.length > 0;
  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3 sm:gap-4 sm:px-6 sm:py-4">
        {/* bb's own title bar already says Plugins, and the row says Triage;
            on a phone the space is worth more than the heading. */}
        {heading && <h1 className="hidden text-lg font-semibold sm:block">Triage</h1>}
        <nav className="flex min-w-0 shrink overflow-x-auto rounded-lg border border-border p-0.5 [scrollbar-width:none]" aria-label="Decks">
          {TABS.map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={tab === id}
              onClick={() => id !== tab && onTab(id)}
              className={cn(
                "flex h-7 shrink-0 items-center gap-1.5 rounded-md px-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground",
                tab === id && "bg-state-active text-foreground",
              )}
            >
              {TAB_LABELS[id]}
              <span className="tabular-nums opacity-70">
                {
                  {
                    new: deck.cards.length,
                    updates: deck.updates.cards.length,
                    cleanup: deck.cleanup.cards.length,
                    saved: deck.saved.length,
                  }[id]
                }
              </span>
            </button>
          ))}
        </nav>
        {tab === "new" && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto text-xs text-muted-foreground"
            aria-pressed={deck.includeIncompatible}
            onClick={() => triageStore.setIncludeIncompatible(rpc, !deck.includeIncompatible)}
            title="Also show plugins that need a newer bb"
          >
            {deck.includeIncompatible && <Icon name="Check" aria-hidden />}
            <span className="hidden sm:inline">Show incompatible</span>
            <span className="sm:hidden">Incompatible</span>
          </Button>
        )}
      </header>

      {/* The queue floats over the bottom of the page rather than sitting
          above the deck, so the first decision that fills it moves nothing.
          While it's there, the page gets room to scroll out from under it. */}
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-4 sm:px-6 sm:pt-6",
          queued ? "pb-[calc(max(1rem,env(safe-area-inset-bottom))+5rem)]" : "pb-[max(1rem,env(safe-area-inset-bottom))]",
        )}
        data-testid="triage-scroll"
      >
        {deck.status === "error" && (
          <div className="mx-auto max-w-md space-y-3 text-center text-sm">
            <p>Couldn't load the catalog: {deck.error}</p>
            <Button variant="outline" size="sm" onClick={() => void triageStore.load(rpc)}>
              Try again
            </Button>
          </div>
        )}
        {deck.status === "loading" && <p className="text-center text-sm text-muted-foreground">Loading…</p>}
        {deck.status === "ready" && tab === "new" && (
          <EntryDeck
            key="new"
            deck="new"
            cards={deck.cards}
            keyboard
            empty={<Empty title="You're all caught up" detail="New plugins appear here as they're published." />}
          />
        )}
        {deck.status === "ready" && tab === "updates" && (
          <UpdatesPanel rpc={rpc} updates={deck.updates} keyboard={tab === "updates"} />
        )}
        {deck.status === "ready" && tab === "cleanup" && (
          <CleanupPanel rpc={rpc} cleanup={deck.cleanup} keyboard={tab === "cleanup"} />
        )}
        {deck.status === "ready" && tab === "saved" && (
          <EntryDeck
            key="saved"
            deck="saved"
            cards={deck.saved}
            keyboard
            empty={<Empty title="Nothing saved" detail="Drag a new plugin up, or press ↑, to keep it here for later." />}
          />
        )}
      </div>
      {deck.status === "ready" && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
          <div className="pointer-events-auto">
            <QueueBar rpc={rpc} queue={deck.queue} />
          </div>
        </div>
      )}
    </div>
  );
}

function Empty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-2 pt-16 text-center">
      <Icon name="CircleCheck" className="size-8 text-muted-foreground" aria-hidden />
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}
