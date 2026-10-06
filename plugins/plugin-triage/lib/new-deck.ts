// The New deck: catalog entries published since triage began that are not
// installed and not yet decided, newest first. Pure, so the server and the
// tests build the same deck from the same inputs.

/** The fields of a `catalog.search` result this plugin reads. */
export interface CatalogEntry {
  entryId: string;
  pluginId: string;
  marketplace: string;
  marketplaceDisplayName: string;
  official: boolean;
  displayName: string;
  description: string;
  overview?: string;
  icon: string | null;
  iconUrl: string | null;
  author: { name: string; github?: string | null; url: string | null } | null;
  category?: string;
  installs?: number | null;
  publishedAt?: string;
  updatedAt?: string;
  screenshots?: string[];
  repositoryUrl?: string | null;
  source: string;
  compatible: boolean;
  incompatibleReason: string | null;
  installed: boolean;
  conflictingInstallSource: string | null;
}

export type DecisionAction = "install" | "dismiss" | "save";

export interface Decision {
  action: DecisionAction;
  /** Epoch ms. */
  at: number;
}

/** Keyed by `entryKey`. */
export type Decisions = Record<string, Decision>;

export interface NewCard {
  key: string;
  entryId: string;
  pluginId: string;
  marketplace: string;
  marketplaceDisplayName: string;
  official: boolean;
  displayName: string;
  description: string;
  overview: string | null;
  icon: string | null;
  iconUrl: string | null;
  /** `github` is the handle, for the avatar bb's own cards show. */
  author: { name: string; url: string | null; github: string | null } | null;
  category: string | null;
  installs: number | null;
  publishedAt: string | null;
  screenshots: string[];
  source: string;
  compatible: boolean;
  incompatibleReason: string | null;
  /** Where "Open page" goes: the store's web page, else the repository. */
  link: string | null;
  /** Back because the listing changed after it was dismissed. */
  resurfaced: boolean;
  /** The last install attempt from this deck failed with this message. */
  lastFailure: string | null;
}

/** How far back the first visit reaches. Older entries never enter the deck. */
export const FIRST_RUN_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

const COMMUNITY_MARKETPLACE = "bb-community";

export function entryKey(entry: { entryId: string; marketplace: string }): string {
  return `${entry.entryId}@${entry.marketplace}`;
}

/**
 * BB Community entries have a page on getbb.app; anything else falls back to
 * its repository, and bundled plugins usually have neither.
 */
export function entryLink(entry: Pick<CatalogEntry, "entryId" | "marketplace" | "repositoryUrl">): string | null {
  if (entry.marketplace === COMMUNITY_MARKETPLACE) {
    return `https://getbb.app/marketplace/${encodeURIComponent(entry.entryId)}`;
  }
  return entry.repositoryUrl ?? null;
}

export function toCard(
  entry: CatalogEntry,
  extra: { resurfaced?: boolean; lastFailure?: string | null } = {},
): NewCard {
  return {
    key: entryKey(entry),
    entryId: entry.entryId,
    pluginId: entry.pluginId,
    marketplace: entry.marketplace,
    marketplaceDisplayName: entry.marketplaceDisplayName,
    official: entry.official,
    displayName: entry.displayName,
    description: entry.description,
    overview: entry.overview ?? null,
    icon: entry.icon,
    iconUrl: entry.iconUrl,
    author:
      entry.author === null
        ? null
        : { name: entry.author.name, url: entry.author.url, github: entry.author.github ?? null },
    category: entry.category ?? null,
    installs: entry.installs ?? null,
    publishedAt: entry.publishedAt ?? null,
    screenshots: entry.screenshots ?? [],
    source: entry.source,
    compatible: entry.compatible,
    incompatibleReason: entry.incompatibleReason,
    link: entryLink(entry),
    resurfaced: extra.resurfaced ?? false,
    lastFailure: extra.lastFailure ?? null,
  };
}

function time(iso: string | undefined): number | null {
  if (iso === undefined) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/** Installed, or its id taken by another install: either way, nothing to decide. */
function isPresent(entry: CatalogEntry): boolean {
  return entry.installed || entry.conflictingInstallSource !== null;
}

export interface NewDeckInput {
  entries: readonly CatalogEntry[];
  decisions: Decisions;
  /** Epoch ms; entries published before it are not new. */
  cutoff: number;
  /** Install failures by entry key, newest message. */
  failures?: Record<string, string>;
  includeIncompatible?: boolean;
}

export function buildNewDeck(input: NewDeckInput): NewCard[] {
  const cards: { card: NewCard; published: number }[] = [];
  for (const entry of input.entries) {
    if (isPresent(entry)) continue;
    if (!entry.compatible && input.includeIncompatible !== true) continue;
    const published = time(entry.publishedAt);
    if (published === null || published < input.cutoff) continue;

    const key = entryKey(entry);
    const decision = input.decisions[key];
    let resurfaced = false;
    if (decision !== undefined) {
      // A dismissal holds until the listing itself changes; an install or a
      // save is never undone by the catalog.
      const updated = time(entry.updatedAt);
      if (decision.action !== "dismiss" || updated === null || updated <= decision.at) continue;
      resurfaced = true;
    }
    cards.push({
      card: toCard(entry, { resurfaced, lastFailure: input.failures?.[key] ?? null }),
      published,
    });
  }
  cards.sort((a, b) => b.published - a.published || a.card.key.localeCompare(b.card.key));
  return cards.map(({ card }) => card);
}

/** Saved entries that are still worth showing, most recently saved first. */
export function buildSavedList(entries: readonly CatalogEntry[], decisions: Decisions): NewCard[] {
  const byKey = new Map(entries.map((entry) => [entryKey(entry), entry]));
  return Object.entries(decisions)
    .filter(([, decision]) => decision.action === "save")
    .sort(([, a], [, b]) => b.at - a.at)
    .flatMap(([key]) => {
      const entry = byKey.get(key);
      // Gone from the catalog, or installed some other way since.
      if (entry === undefined || isPresent(entry)) return [];
      return [toCard(entry)];
    });
}
