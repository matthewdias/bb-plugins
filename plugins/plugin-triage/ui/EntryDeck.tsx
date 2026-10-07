// A deck of catalog entries: the New deck, and the plugins saved for later.
// Both deal the same cards, which open the same way; only what the swipes
// mean differs.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../lib/contract";
import type { NewCard } from "../lib/new-deck";
import { vetPrompt } from "../lib/source";
import { CardStack, NEW_ACTIONS, type DeckActions } from "./CardStack";
import { decide, planFor, undoLast, type DeckName, type Plan } from "./decisions";
import { EntryCard } from "./EntryCard";

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
}

export function EntryDeck({ deck, cards, keyboard, empty }: EntryDeckProps) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [expanded, setExpanded] = useState(false);
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
