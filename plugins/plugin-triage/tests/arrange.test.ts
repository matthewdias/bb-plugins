import { describe, expect, it } from "vitest";
import { DEFAULT_ARRANGEMENT, NO_CATEGORY, NO_SOURCE, arrange, listingsByPlugin, type Arrangement, type Facts } from "../lib/arrange";
import { entry } from "./fixtures";

type Card = Facts & { id: string };
const card = (id: string, facts: Partial<Facts> = {}): Card => ({
  id,
  name: id,
  published: null,
  installs: null,
  category: null,
  source: null,
  ...facts,
});
const ALL = ["deal", "name", "published", "installs"] as const;
const ids = (groups: { label: string | null; cards: Card[] }[]) => groups.map((group) => [group.label, group.cards.map((c) => c.id)]);
const how = (overrides: Partial<Arrangement>): Arrangement => ({ ...DEFAULT_ARRANGEMENT, ...overrides });

describe("arranging the grid", () => {
  const cards = [
    card("beta", { published: "2026-10-02T00:00:00Z", installs: 5, category: "Utilities", source: "BB Community" }),
    card("Alpha", { published: "2026-10-05T00:00:00Z", installs: null, category: null, source: "Acme" }),
    card("gamma", { published: null, installs: 40, category: "Code & Reviews", source: "BB Community" }),
  ];

  it("keeps the deck's order by default, in one group", () => {
    expect(ids(arrange(cards, DEFAULT_ARRANGEMENT, (c) => c, ALL))).toEqual([[null, ["beta", "Alpha", "gamma"]]]);
  });

  it("sorts by name either way, ignoring case", () => {
    expect(ids(arrange(cards, how({ sort: "name", direction: "asc" }), (c) => c, ALL))[0]![1]).toEqual(["Alpha", "beta", "gamma"]);
    expect(ids(arrange(cards, how({ sort: "name", direction: "desc" }), (c) => c, ALL))[0]![1]).toEqual(["gamma", "beta", "Alpha"]);
  });

  it("puts a missing date or count last, whichever way the rest go", () => {
    expect(ids(arrange(cards, how({ sort: "published", direction: "desc" }), (c) => c, ALL))[0]![1]).toEqual(["Alpha", "beta", "gamma"]);
    expect(ids(arrange(cards, how({ sort: "published", direction: "asc" }), (c) => c, ALL))[0]![1]).toEqual(["beta", "Alpha", "gamma"]);
    expect(ids(arrange(cards, how({ sort: "installs", direction: "desc" }), (c) => c, ALL))[0]![1]).toEqual(["gamma", "beta", "Alpha"]);
    expect(ids(arrange(cards, how({ sort: "installs", direction: "asc" }), (c) => c, ALL))[0]![1]).toEqual(["beta", "gamma", "Alpha"]);
  });

  it("falls back to the deck's order for a sort the tab doesn't offer", () => {
    expect(ids(arrange(cards, how({ sort: "installs" }), (c) => c, ["deal", "name"]))[0]![1]).toEqual(["beta", "Alpha", "gamma"]);
  });

  it("groups by category A–Z, the uncategorised last, sorted within", () => {
    expect(ids(arrange(cards, how({ group: "category", sort: "name", direction: "asc" }), (c) => c, ALL))).toEqual([
      ["Code & Reviews", ["gamma"]],
      ["Utilities", ["beta"]],
      [NO_CATEGORY, ["Alpha"]],
    ]);
  });

  it("groups by the store a plugin comes from, those in none last", () => {
    const loose = card("delta");
    expect(ids(arrange([...cards, loose], how({ group: "source" }), (c) => c, ALL))).toEqual([
      ["Acme", ["Alpha"]],
      ["BB Community", ["beta", "gamma"]],
      [NO_SOURCE, ["delta"]],
    ]);
  });
});

describe("installed plugins' listings", () => {
  it("takes the listing bb marks installed when a plugin is in two stores", () => {
    const listings = listingsByPlugin([
      entry({ entryId: "x", pluginId: "x", marketplaceDisplayName: "Acme", category: "Utilities" }),
      entry({ entryId: "x2", pluginId: "x", marketplaceDisplayName: "BB Community", category: "Thread Management", installed: true }),
      entry({ entryId: "y", pluginId: "y", marketplaceDisplayName: "Acme", category: undefined }),
    ]);
    expect(listings.get("x")).toEqual({ category: "Thread Management", store: "BB Community" });
    expect(listings.get("y")).toEqual({ category: null, store: "Acme" });
    // Whichever store the catalog lists first.
    const reversed = listingsByPlugin([
      entry({ entryId: "x2", pluginId: "x", marketplaceDisplayName: "BB Community", category: "Thread Management", installed: true }),
      entry({ entryId: "x", pluginId: "x", marketplaceDisplayName: "Acme", category: "Utilities" }),
    ]);
    expect(reversed.get("x")).toEqual({ category: "Thread Management", store: "BB Community" });
  });
});
