// The decks as the page and the sidebar row see them. One module-level store,
// because the overlay (mounted once per window, for the row's count and the
// install toasts) and the page (mounted only on the Triage view) must agree,
// and a decision made on the page has to move the count at once.
import type { PluginRpcClient } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../lib/contract";
import type { NewCard } from "../lib/new-deck";
import type { Job, RemoveJob, UpdateJob } from "../lib/queue";
import type { Unavailable, UpdateCard } from "../lib/updates-deck";
import type { CleanupCard } from "../lib/cleanup-deck";

export type TriageRpc = PluginRpcClient<typeof rpcContract>;

export interface UpdatesState {
  cards: UpdateCard[];
  unavailable: Unavailable[];
  history: UpdateJob[];
}

export interface CleanupState {
  cards: CleanupCard[];
  /** Finished removals, newest first. */
  history: RemoveJob[];
}

/** Installs and updates queued or under way, in the order they will run. */
export interface QueueState {
  jobs: Job[];
  /** Whether Run all has started them. */
  running: boolean;
}

export interface DeckState {
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  cards: NewCard[];
  saved: NewCard[];
  updates: UpdatesState;
  cleanup: CleanupState;
  queue: QueueState;
  includeIncompatible: boolean;
}

const NO_UPDATES: UpdatesState = { cards: [], unavailable: [], history: [] };
const NO_QUEUE: QueueState = { jobs: [], running: false };
const NO_CLEANUP: CleanupState = { cards: [], history: [] };

let state: DeckState = {
  status: "idle",
  error: null,
  cards: [],
  saved: [],
  updates: NO_UPDATES,
  cleanup: NO_CLEANUP,
  queue: NO_QUEUE,
  includeIncompatible: false,
};
const listeners = new Set<() => void>();
let generation = 0;
let queueRequest = 0;
let queueApplied = 0;

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

  /** Refresh the queue as soon as its own request returns. */
  async loadQueue(rpc: TriageRpc): Promise<void> {
    const mine = ++queueRequest;
    try {
      const queue = await rpc.call("queue_status", {});
      if (mine <= queueApplied) return;
      queueApplied = mine;
      set({ queue });
    } catch {
      // Keep showing the last known queue until the next refresh.
    }
  },

  removeQueuedJob(key: string): void {
    // An in-flight response might still include the job we just took off.
    queueApplied = ++queueRequest;
    const jobs = state.queue.jobs.filter((job) => job.key !== key);
    set({ queue: { ...state.queue, jobs } });
  },

  /** Refetch the decks and queue independently. */
  async load(rpc: TriageRpc): Promise<void> {
    const mine = ++generation;
    if (state.status === "idle" || state.status === "error") set({ status: "loading", error: null });
    const queue = triageStore.loadQueue(rpc);
    try {
      const [deck, saved, updates, cleanup] = await Promise.all([
        rpc.call("deck_new", { includeIncompatible: state.includeIncompatible }),
        rpc.call("deck_saved", {}),
        rpc.call("updates_deck", {}),
        rpc.call("cleanup_deck", {}),
      ]);
      if (mine !== generation) return;
      set({ status: "ready", error: null, cards: deck.cards, saved: saved.cards, updates, cleanup });
    } catch (cause) {
      if (mine !== generation) return;
      set({ status: "error", error: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      await queue;
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
    set({
      cards: [card, ...state.cards.filter((other) => other.key !== card.key)],
    });
  },

  /** Take an update card off the Updates deck before the server answers. */
  takeUpdate(key: string): void {
    generation++;
    set({ updates: { ...state.updates, cards: state.updates.cards.filter((card) => card.key !== key) } });
  },

  /** Put an update card back on top, as undo does. */
  putBackUpdate(card: UpdateCard): void {
    generation++;
    set({
      updates: {
        ...state.updates,
        cards: [card, ...state.updates.cards.filter((other) => other.key !== card.key)],
      },
    });
  },

  /** Restore an installed card after undo. */
  putBackCleanup(card: CleanupCard): void {
    generation++;
    set({
      cleanup: { ...state.cleanup, cards: [card, ...state.cleanup.cards.filter((other) => other.key !== card.key)] },
    });
  },

  /** Move a saved card to the back of the Saved deck; it stays saved. */
  laterSaved(key: string): void {
    const card = state.saved.find((other) => other.key === key);
    if (card === undefined) return;
    generation++;
    set({ saved: [...state.saved.filter((other) => other.key !== key), card] });
  },

  /** Put a card on top of the Saved deck. */
  addSaved(card: NewCard): void {
    set({
      saved: [card, ...state.saved.filter((other) => other.key !== card.key)],
    });
  },
};

/** Tests only. */
export function resetTriageStore(): void {
  generation++;
  queueApplied = ++queueRequest;
  state = { status: "idle", error: null, cards: [], saved: [], updates: NO_UPDATES, cleanup: NO_CLEANUP, queue: NO_QUEUE, includeIncompatible: false };
  for (const listener of listeners) listener();
}
