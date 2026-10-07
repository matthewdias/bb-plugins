// The Triage page, drawn inside bb's Plugins screen: the New deck, and the
// list of plugins saved for later.
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useBbNavigate, useRpc, experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { rpcContract } from "../lib/contract";
import type { NewCard } from "../lib/new-deck";
import { TABS, type Tab } from "../lib/tabs";
import { vetPrompt } from "../lib/source";
import { CardStack } from "./CardStack";
import { decide, planFor, undoLast, type Plan } from "./decisions";
import { EntryCard } from "./EntryCard";
import { navigateInApp, pluginDetailsPath } from "./navigate";
import { SavedList } from "./SavedList";
import { CleanupPanel } from "./CleanupPanel";
import { QueueBar } from "./QueueBar";
import { UpdatesPanel } from "./UpdatesPanel";
import { triageStore } from "./triage-store";

const TAB_LABELS: Record<Tab, string> = { new: "New", updates: "Updates", cleanup: "Cleanup", saved: "Saved" };

function usePlan(card: NewCard | null) {
  const rpc = useRpc<typeof rpcContract>();
  const [plan, setPlan] = useState<{ key: string; plan: Plan | null; error: string | null } | null>(null);
  useEffect(() => {
    if (card === null) return;
    let live = true;
    planFor(rpc, card).then(
      (value) => live && setPlan({ key: card.key, plan: value, error: null }),
      (cause) => live && setPlan({ key: card.key, plan: null, error: cause instanceof Error ? cause.message : String(cause) }),
    );
    return () => {
      live = false;
    };
  }, [card, rpc]);
  return plan !== null && card !== null && plan.key === card.key ? plan : null;
}

/**
 * The tab comes from the address, so Back walks tabs and a reload or a link
 * keeps one; whoever hosts the page reads it and changes it (`onTab`).
 * `heading` is off where bb's own title bar already says Triage.
 */
export function TriagePage({ tab, onTab, heading = true }: { tab: Tab; onTab: (tab: Tab) => void; heading?: boolean }) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const deck = useSyncExternalStore(triageStore.subscribe, triageStore.getSnapshot);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    void triageStore.load(rpc);
  }, [rpc]);

  const top = deck.cards[0] ?? null;
  useEffect(() => setExpanded(false), [top?.key]);
  const plan = usePlan(top);

  const vet = useCallback(
    (card: NewCard, sourceLabel: string | null) => {
      navigate.toCompose({
        initialPrompt: vetPrompt({
          displayName: card.displayName,
          entryId: card.entryId,
          marketplaceDisplayName: card.marketplaceDisplayName,
          author: card.author?.name ?? null,
          source: card.source,
          sourceLabel,
          link: card.link,
        }),
        focusPrompt: true,
      });
    },
    [navigate],
  );

  const open = useCallback((card: NewCard) => {
    if (card.link !== null) navigate.openUrl(card.link);
  }, [navigate]);

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
          deck.cards.length === 0 ? (
            <Empty />
          ) : (
            <CardStack
              cards={deck.cards}
              keyboard={tab === "new"}
              scrollable={expanded}
              onDecide={(card, direction) => void decide(rpc, card, direction)}
              onUndo={() => void undoLast(rpc)}
              onDetails={() => setExpanded((value) => !value)}
              render={(card, isTop) => (
                <EntryCard
                  card={card}
                  top={isTop}
                  plan={isTop ? plan?.plan ?? null : null}
                  planError={isTop ? plan?.error ?? null : null}
                  expanded={isTop && expanded}
                  onToggleDetails={() => setExpanded((value) => !value)}
                  onVet={() => vet(card, plan?.plan?.summary?.label ?? null)}
                  onOpen={() => open(card)}
                />
              )}
            />
          )
        )}
        {deck.status === "ready" && tab === "updates" && (
          <UpdatesPanel rpc={rpc} updates={deck.updates} keyboard={tab === "updates"} />
        )}
        {deck.status === "ready" && tab === "cleanup" && (
          <CleanupPanel rpc={rpc} cleanup={deck.cleanup} keyboard={tab === "cleanup"} />
        )}
        {deck.status === "ready" && tab === "saved" && (
          <SavedList
            cards={deck.saved}
            onDetails={(card) => navigateInApp(pluginDetailsPath(card.pluginId, "saved"))}
            onInstall={(card) => void decide(rpc, card, "right")}
            onRemove={(card) => void decide(rpc, card, "left")}
            onOpen={open}
            onVet={(card) => vet(card, null)}
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

function Empty() {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-2 pt-16 text-center">
      <Icon name="CircleCheck" className="size-8 text-muted-foreground" aria-hidden />
      <p className="text-sm font-medium">You're all caught up</p>
      <p className="text-xs text-muted-foreground">New plugins appear here as they're published.</p>
    </div>
  );
}
