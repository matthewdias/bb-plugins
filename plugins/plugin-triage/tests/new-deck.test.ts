import { describe, expect, it } from "vitest";
import { buildNewDeck, buildSavedList, entryKey, entryLink } from "../lib/new-deck";
import { DAY, NOW, entry } from "./fixtures";

const cutoff = NOW - 14 * DAY;
const keys = (cards: { key: string }[]) => cards.map((card) => card.key);

describe("the New deck", () => {
  it("holds entries published since the cutoff, newest first", () => {
    const cards = buildNewDeck({
      entries: [
        entry({ entryId: "older", publishedAt: new Date(NOW - 3 * DAY).toISOString() }),
        entry({ entryId: "newest", publishedAt: new Date(NOW - DAY).toISOString() }),
        entry({ entryId: "too-old", publishedAt: new Date(NOW - 15 * DAY).toISOString() }),
        entry({ entryId: "undated", publishedAt: undefined }),
      ],
      decisions: {},
      cutoff,
    });
    expect(keys(cards)).toEqual(["newest@bb-community", "older@bb-community"]);
  });

  it("leaves out installed entries and ids another install already holds", () => {
    const cards = buildNewDeck({
      entries: [
        entry({ entryId: "mine", installed: true }),
        entry({ entryId: "taken", conflictingInstallSource: "path:/work/taken" }),
        entry({ entryId: "free" }),
      ],
      decisions: {},
      cutoff,
    });
    expect(keys(cards)).toEqual(["free@bb-community"]);
  });

  it("hides incompatible entries unless asked, and then says why", () => {
    const entries = [entry({ entryId: "needs-newer", compatible: false, incompatibleReason: "requires bb >=0.46" })];
    expect(buildNewDeck({ entries, decisions: {}, cutoff })).toEqual([]);
    const [card] = buildNewDeck({ entries, decisions: {}, cutoff, includeIncompatible: true });
    expect(card!.incompatibleReason).toBe("requires bb >=0.46");
  });

  it("leaves out decided entries", () => {
    const entries = [entry({ entryId: "a" }), entry({ entryId: "b" }), entry({ entryId: "c" }), entry({ entryId: "d" })];
    const cards = buildNewDeck({
      entries,
      decisions: {
        "a@bb-community": { action: "install", at: NOW },
        "b@bb-community": { action: "dismiss", at: NOW },
        "c@bb-community": { action: "save", at: NOW },
      },
      cutoff,
    });
    expect(keys(cards)).toEqual(["d@bb-community"]);
  });

  it("brings a dismissed entry back once its listing changes, and only a dismissed one", () => {
    const updatedAt = new Date(NOW).toISOString();
    const cards = buildNewDeck({
      entries: [
        entry({ entryId: "dismissed", updatedAt }),
        entry({ entryId: "saved", updatedAt }),
        entry({ entryId: "unchanged", updatedAt: new Date(NOW - 2 * DAY).toISOString() }),
      ],
      decisions: {
        "dismissed@bb-community": { action: "dismiss", at: NOW - DAY },
        "saved@bb-community": { action: "save", at: NOW - DAY },
        "unchanged@bb-community": { action: "dismiss", at: NOW - DAY },
      },
      cutoff,
    });
    expect(keys(cards)).toEqual(["dismissed@bb-community"]);
    expect(cards[0]!.resurfaced).toBe(true);
  });

  it("tells one marketplace's entry from another's with the same id", () => {
    const cards = buildNewDeck({
      entries: [entry({ entryId: "same" }), entry({ entryId: "same", marketplace: "acme" })],
      decisions: { "same@bb-community": { action: "dismiss", at: NOW } },
      cutoff,
    });
    expect(keys(cards)).toEqual(["same@acme"]);
  });

  it("carries the last install failure onto the card", () => {
    const [card] = buildNewDeck({
      entries: [entry({ entryId: "flaky" })],
      decisions: {},
      cutoff,
      failures: { "flaky@bb-community": "build failed" },
    });
    expect(card!.lastFailure).toBe("build failed");
  });
});

describe("links", () => {
  it("go to getbb.app for BB Community and to the repository otherwise", () => {
    expect(entryLink(entry({ entryId: "a b" }))).toBe("https://getbb.app/marketplace/a%20b");
    expect(entryLink(entry({ entryId: "x", marketplace: "acme", repositoryUrl: "https://git.acme/x" }))).toBe(
      "https://git.acme/x",
    );
    expect(entryLink(entry({ entryId: "y", marketplace: "bb-official", repositoryUrl: null }))).toBeNull();
  });

  it("key on entry and marketplace", () => {
    expect(entryKey({ entryId: "x", marketplace: "acme" })).toBe("x@acme");
  });
});

describe("the Saved list", () => {
  it("lists saved entries, most recently saved first, dropping installed and vanished ones", () => {
    const cards = buildSavedList(
      [entry({ entryId: "first" }), entry({ entryId: "second" }), entry({ entryId: "installed", installed: true })],
      {
        "first@bb-community": { action: "save", at: NOW - 2 * DAY },
        "second@bb-community": { action: "save", at: NOW - DAY },
        "installed@bb-community": { action: "save", at: NOW },
        "vanished@bb-community": { action: "save", at: NOW },
        "dismissed@bb-community": { action: "dismiss", at: NOW },
      },
    );
    expect(keys(cards)).toEqual(["second@bb-community", "first@bb-community"]);
  });

  it("keeps a saved entry however old it is", () => {
    const old = entry({ entryId: "old", publishedAt: new Date(NOW - 400 * DAY).toISOString() });
    expect(keys(buildSavedList([old], { "old@bb-community": { action: "save", at: NOW } }))).toEqual(["old@bb-community"]);
  });
});
