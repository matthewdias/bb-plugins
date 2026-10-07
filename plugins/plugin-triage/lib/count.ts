// The number shown on the Triage sidebar item and on the Triage row in bb's
// Plugins screen: cards waiting in the decks you chose, plus anything queued
// from them that hasn't run. Pure, so the tests and both places agree.
import type { Job } from "./queue.ts";

export interface CountedDecks {
  new: boolean;
  updates: boolean;
  cleanup: boolean;
}

/** The settings that choose the decks, and what each is when unset. */
export const COUNT_SETTINGS = {
  countNew: { deck: "new", default: true },
  countUpdates: { deck: "updates", default: true },
  countCleanup: { deck: "cleanup", default: false },
} as const;

export function countedDecks(values: Record<string, unknown> | undefined): CountedDecks {
  const decks = { new: false, updates: false, cleanup: false };
  for (const [key, setting] of Object.entries(COUNT_SETTINGS)) {
    const value = values?.[key];
    decks[setting.deck] = typeof value === "boolean" ? value : setting.default;
  }
  return decks;
}

const DECK_OF_JOB: Record<Job["kind"], keyof CountedDecks> = { install: "new", update: "updates", remove: "cleanup" };

export interface CountInput {
  cards: readonly unknown[];
  updates: { cards: readonly unknown[] };
  cleanup: { cards: readonly unknown[] };
  queue: { jobs: readonly Pick<Job, "kind">[] };
}

export function waitingCount(deck: CountInput, decks: CountedDecks): number {
  let count = 0;
  if (decks.new) count += deck.cards.length;
  if (decks.updates) count += deck.updates.cards.length;
  if (decks.cleanup) count += deck.cleanup.cards.length;
  // Queued items count too: a queue nobody ran is still waiting on you.
  for (const job of deck.queue.jobs) if (decks[DECK_OF_JOB[job.kind]]) count += 1;
  return count;
}

export const countText = (count: number) => (count > 99 ? "99+" : String(count));
