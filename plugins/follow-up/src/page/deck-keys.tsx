// Focus's number keys and Enter, handed to whichever part of the top card
// answers by them: a question's options or a pull of next steps. Nothing else
// takes them. An approval, a merge or a wrap-up has no key, because what it
// does has to be read and clicked.
import { createContext, useContext, useId, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";

export interface DeckKeyHandler {
  /** 1–9: pick that option or step. */
  pick: (n: number) => void;
  /** Enter: send what is picked. */
  send: () => void;
}

interface Registered {
  owner: string;
  handler: DeckKeyHandler;
}

const DeckKeysContext = createContext<RefObject<Registered | null> | null>(null);

/** Wraps the top card; Focus reads the handler back through the ref it passes. */
export function DeckKeysProvider({ slot, children }: { slot: RefObject<Registered | null>; children: ReactNode }) {
  return <DeckKeysContext.Provider value={slot}>{children}</DeckKeysContext.Provider>;
}

/** Keeps the keys from what it wraps: a card's workers, whose forms are theirs, not the card's. */
export function NoDeckKeys({ children }: { children: ReactNode }) {
  return <DeckKeysContext.Provider value={null}>{children}</DeckKeysContext.Provider>;
}

export function useDeckKeySlot() {
  return useRef<Registered | null>(null);
}

/**
 * Takes Focus's keys for this card, and says whether it has them, so the
 * card can show the numbers. Outside Focus, or inside NoDeckKeys, there is no
 * slot and nothing changes. A card has one part that answers by key; should
 * two ever register, the first keeps them.
 */
export function useDeckKeys(handler: DeckKeyHandler): boolean {
  const slot = useContext(DeckKeysContext);
  const owner = useId();
  // Every render refreshes the handler, so it always sees the latest picks.
  // In the commit itself, not after it: a key pressed the moment a new offer
  // is drawn must not still reach the handler of the offer it replaced.
  useLayoutEffect(() => {
    if (slot === null) return;
    if (slot.current === null || slot.current.owner === owner) slot.current = { owner, handler };
  });
  // Let go in the commit too, so the card that takes this one's place finds
  // the slot empty when it registers.
  useLayoutEffect(
    () => () => {
      if (slot !== null && slot.current?.owner === owner) slot.current = null;
    },
    [slot, owner],
  );
  return slot !== null;
}
