// A deck of catalog entries: the New deck, and the plugins saved for later.
// Both deal the same cards, which open the same way; only what the swipes
// mean differs. Laid out as a grid, every card shows at once instead.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import type { Facts } from "../lib/arrange";
import type { rpcContract } from "../lib/contract";
import type { NewCard } from "../lib/new-deck";
import { vetPrompt } from "../lib/source";
import { CardGrid, GridCard } from "./CardGrid";
import { CardStack, NEW_ACTIONS, type DeckActions } from "./CardStack";
import { decide, planFor, undoLast, type DeckName, type Plan } from "./decisions";
import { EntryCard, PluginIcon, ago } from "./EntryCard";
import type { Layout } from "./layout";

export const SAVED_ACTIONS: DeckActions = {
  right: { label: "Install", name: "Install", icon: "Download", hint: "install" },
  left: { label: "Forget", name: "Remove from Saved", icon: "X", hint: "forget" },
  up: { label: "Later", name: "Move to the back", icon: "Clock", hint: "later" },
};

const ACTIONS: Record<DeckName, DeckActions> = { new: NEW_ACTIONS, saved: SAVED_ACTIONS };

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

export interface EntryDeckProps {
  deck: DeckName;
  cards: readonly NewCard[];
  keyboard: boolean;
  /** Shown when the deck is empty. */
  empty: ReactNode;
  layout?: Layout;
}

/** A grid card's byline: who, how many have it, and when it came out. */
function byline(card: NewCard): string {
  const published = ago(card.publishedAt);
  return [
    card.author?.name ?? card.marketplaceDisplayName,
    card.installs === null ? null : `${card.installs.toLocaleString()} ${card.installs === 1 ? "install" : "installs"}`,
    published,
  ]
    .filter((part) => part !== null)
    .join(" · ");
}

function entryFacts(card: NewCard): Facts {
  return {
    name: card.displayName,
    published: card.publishedAt,
    installs: card.installs,
    category: card.category,
    source: card.marketplaceDisplayName,
  };
}

function note(card: NewCard): { text: string; tone?: "warn" } | null {
  if (!card.compatible) return { text: card.incompatibleReason ?? "Not compatible with this bb", tone: "warn" };
  if (card.lastFailure !== null) return { text: `Last install failed: ${card.lastFailure}`, tone: "warn" };
  if (card.resurfaced) return { text: "Updated since you dismissed it" };
  return null;
}

/** A card previewed from the grid: the deck's card, opened in full. */
function EntryPreview({ card, onVet }: { card: NewCard; onVet: (card: NewCard, sourceLabel: string | null) => void }) {
  const navigate = useBbNavigate();
  const [expanded, setExpanded] = useState(true);
  const plan = usePlan(card);
  return (
    <EntryCard
      card={card}
      top
      plan={plan?.plan ?? null}
      planError={plan?.error ?? null}
      expanded={expanded}
      onToggleDetails={() => setExpanded((value) => !value)}
      onVet={() => onVet(card, plan?.plan?.summary?.label ?? null)}
      onOpen={() => card.link !== null && navigate.openUrl(card.link)}
    />
  );
}

export function EntryDeck({ deck, cards, keyboard, empty, layout = "deck" }: EntryDeckProps) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [expanded, setExpanded] = useState(false);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const top = cards[0] ?? null;
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

  if (top === null) return <>{empty}</>;
  if (layout === "grid") {
    return (
      <CardGrid
        cards={cards}
        facts={entryFacts}
        sorts={["name", "published", "installs"]}
        noun={deck === "new" ? ["new plugin", "new plugins"] : ["saved plugin", "saved plugins"]}
        onUndo={() => void undoLast(rpc)}
        keyboard={keyboard}
        actions={() => ACTIONS[deck]}
        onDecide={(card, direction) => void decide(rpc, card, direction, deck)}
        previewKey={previewKey}
        onPreview={setPreviewKey}
        renderPreview={(card) => <EntryPreview key={card.key} card={card} onVet={vet} />}
        render={(card) => (
          <GridCard
            title={card.displayName}
            leading={<PluginIcon card={card} compact />}
            description={card.description}
            note={note(card)}
            byline={byline(card)}
            actions={ACTIONS[deck]}
            onDecide={(direction) => void decide(rpc, card, direction, deck)}
            openLabel={`Preview ${card.displayName}`}
            onOpen={() => setPreviewKey(card.key)}
          />
        )}
      />
    );
  }
  return (
    <CardStack
      cards={cards}
      actions={ACTIONS[deck]}
      keyboard={keyboard}
      scrollable={expanded}
      onDecide={(card, direction) => void decide(rpc, card, direction, deck)}
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
          onOpen={() => card.link !== null && navigate.openUrl(card.link)}
        />
      )}
    />
  );
}
