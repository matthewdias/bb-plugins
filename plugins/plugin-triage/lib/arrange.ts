// How the grid lays a tab out: its order, and whether it splits the cards
// into groups by category or by the store they come from. Pure, so the order
// is tested apart from the page. The deck never uses it: it deals in its own
// order, which undo relies on to put a card back on top.
import type { CatalogEntry } from "./new-deck.ts";

/** "deal" is the deck's own order: newest first on New, by reason on Cleanup. */
export type SortKey = "deal" | "name" | "published" | "installs";
export type SortDirection = "asc" | "desc";
export type Grouping = "none" | "category" | "source";

export interface Arrangement {
  sort: SortKey;
  direction: SortDirection;
  group: Grouping;
}

export const DEFAULT_ARRANGEMENT: Arrangement = { sort: "deal", direction: "desc", group: "none" };

/** What a card says about itself for sorting and grouping. */
export interface Facts {
  name: string;
  published: string | null;
  installs: number | null;
  category: string | null;
  /** The store it is listed in, by its display name. */
  source: string | null;
}

/** Where a card with no category, or in no store, goes: after the rest. */
export const NO_CATEGORY = "No category";
export const NO_SOURCE = "Not in a store";

/** Name reads A–Z first; a count or a date reads biggest or newest first. */
export const defaultDirection = (sort: SortKey): SortDirection => (sort === "name" ? "asc" : "desc");

export interface Group<T> {
  /** Null when the cards are not grouped. */
  label: string | null;
  cards: T[];
}

/** Missing values sort last whichever way the rest go. */
function compareMaybe(a: number | null, b: number | null, sign: number): number {
  if (a === null || b === null) return (a === null ? 1 : 0) - (b === null ? 1 : 0);
  return (a - b) * sign;
}

function time(iso: string | null): number | null {
  if (iso === null) return null;
  const at = Date.parse(iso);
  return Number.isNaN(at) ? null : at;
}

/**
 * The cards in the order and groups asked for. `sorts` are the orders the tab
 * offers; any other falls back to the deck's. Ties keep the deck's order.
 */
export function arrange<T>(
  cards: readonly T[],
  how: Arrangement,
  facts: (card: T) => Facts,
  sorts: readonly SortKey[],
): Group<T>[] {
  const sort = sorts.includes(how.sort) ? how.sort : "deal";
  const sign = how.direction === "asc" ? 1 : -1;
  const known = cards.map((card, index) => ({ card, index, facts: facts(card) }));
  known.sort((a, b) => {
    let order = 0;
    if (sort === "name") order = a.facts.name.localeCompare(b.facts.name, undefined, { sensitivity: "base" }) * sign;
    else if (sort === "published") order = compareMaybe(time(a.facts.published), time(b.facts.published), sign);
    else if (sort === "installs") order = compareMaybe(a.facts.installs, b.facts.installs, sign);
    return order || a.index - b.index;
  });

  if (how.group === "none") return [{ label: null, cards: known.map((item) => item.card) }];

  const missing = how.group === "category" ? NO_CATEGORY : NO_SOURCE;
  const groups = new Map<string, T[]>();
  for (const item of known) {
    const label = (how.group === "category" ? item.facts.category : item.facts.source) ?? missing;
    const group = groups.get(label);
    if (group === undefined) groups.set(label, [item.card]);
    else group.push(item.card);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => Number(a === missing) - Number(b === missing) || a.localeCompare(b))
    .map(([label, grouped]) => ({ label, cards: grouped }));
}

/** An installed plugin's store listing: where it is from, and what kind of plugin it is. */
export interface Listing {
  category: string | null;
  store: string | null;
}

/**
 * Each plugin's listing, by plugin id. A plugin listed in more than one store
 * takes the listing bb marks as the one installed.
 */
export function listingsByPlugin(entries: readonly CatalogEntry[]): Map<string, Listing> {
  const out = new Map<string, Listing>();
  for (const entry of entries) {
    if (out.has(entry.pluginId) && !entry.installed) continue;
    out.set(entry.pluginId, { category: entry.category ?? null, store: entry.marketplaceDisplayName });
  }
  return out;
}
