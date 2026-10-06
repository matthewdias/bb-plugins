// The decks as the page and the sidebar row see them. One module-level store,
// because the overlay (mounted once per window, for the row's count and the
// install toasts) and the page (mounted only on the Triage view) must agree,
// and a decision made on the page has to move the count at once.
import type { PluginRpcClient } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../lib/contract";
import type { NewCard } from "../lib/new-deck";

export type TriageRpc = PluginRpcClient<typeof rpcContract>;

export interface DeckState {
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  cards: NewCard[];
  saved: NewCard[];
  includeIncompatible: boolean;
}

let state: DeckState = {
  status: "idle",
  error: null,
  cards: [],
  saved: [],
  includeIncompatible: false,
};
const listeners = new Set<() => void>();
let generation = 0;

function set(next: Partial<DeckState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

export const triageStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): DeckState {
    return state;
  },

  /** Refetch both lists. A newer load wins over an older one still in flight. */
  async load(rpc: TriageRpc): Promise<void> {
    const mine = ++generation;
    if (state.status === "idle" || state.status === "error") set({ status: "loading", error: null });
    try {
      const [deck, saved] = await Promise.all([
        rpc.call("deck_new", { includeIncompatible: state.includeIncompatible }),
        rpc.call("deck_saved", {}),
      ]);
      if (mine !== generation) return;
      set({ status: "ready", error: null, cards: deck.cards, saved: saved.cards });
    } catch (cause) {
      if (mine !== generation) return;
      set({ status: "error", error: cause instanceof Error ? cause.message : String(cause) });
    }
  },

  setIncludeIncompatible(rpc: TriageRpc, include: boolean): void {
    set({ includeIncompatible: include });
    void triageStore.load(rpc);
  },

  /** Take a card off the deck (and the saved list) before the server answers. */
  take(key: string): void {
    // Invalidate a load already in flight, which predates this decision.
    generation++;
    set({
      cards: state.cards.filter((card) => card.key !== key),
      saved: state.saved.filter((card) => card.key !== key),
    });
  },

  /** Put a card back on top, as undo does. */
  putBack(card: NewCard): void {
    generation++;
    set({ cards: [card, ...state.cards.filter((other) => other.key !== card.key)] });
  },

  addSaved(card: NewCard): void {
    set({ saved: [card, ...state.saved.filter((other) => other.key !== card.key)] });
  },
};

/** Tests only. */
export function resetTriageStore(): void {
  generation++;
  state = { status: "idle", error: null, cards: [], saved: [], includeIncompatible: false };
  for (const listener of listeners) listener();
}
