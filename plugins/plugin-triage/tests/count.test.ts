import { describe, expect, it } from "vitest";
import { countText, countedDecks, waitingCount, type CountInput } from "../lib/count";

const deck = (over: Partial<CountInput> = {}): CountInput => ({
  cards: [1, 2],
  updates: { cards: [1] },
  cleanup: { cards: [1, 2, 3] },
  queue: { jobs: [{ kind: "install" }, { kind: "update" }, { kind: "remove" }] },
  ...over,
});

describe("the count on the Triage sidebar item and row", () => {
  it("counts new plugins and updates by default, each with what's queued from it", () => {
    expect(countedDecks(undefined)).toEqual({ new: true, updates: true, cleanup: false });
    // 2 new + 1 update + a queued install and a queued update.
    expect(waitingCount(deck(), countedDecks(undefined))).toBe(5);
  });

  it("counts only the decks the settings choose", () => {
    expect(waitingCount(deck(), countedDecks({ countNew: false, countUpdates: false, countCleanup: true }))).toBe(4);
    expect(waitingCount(deck(), countedDecks({ countNew: true, countUpdates: false }))).toBe(3);
    expect(waitingCount(deck(), countedDecks({ countNew: false, countUpdates: false }))).toBe(0);
  });

  it("falls back to the default for a setting that isn't a boolean", () => {
    expect(countedDecks({ countNew: "yes", countCleanup: 1 })).toEqual({ new: true, updates: true, cleanup: false });
  });

  it("caps the text at 99+", () => {
    expect(countText(7)).toBe("7");
    expect(countText(100)).toBe("99+");
  });
});
