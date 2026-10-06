import type { CatalogEntry } from "../lib/new-deck";

export const NOW = Date.parse("2026-10-06T12:00:00Z");
export const DAY = 24 * 60 * 60 * 1000;

export function entry(overrides: Partial<CatalogEntry> & { entryId: string }): CatalogEntry {
  return {
    pluginId: overrides.entryId,
    marketplace: "bb-community",
    marketplaceDisplayName: "BB Community",
    official: true,
    displayName: overrides.entryId,
    description: `${overrides.entryId} does a thing.`,
    icon: "Puzzle",
    iconUrl: null,
    author: { name: "someone", github: "someone", url: "https://github.com/someone" },
    category: "Productivity",
    installs: 3,
    publishedAt: new Date(NOW - DAY).toISOString(),
    screenshots: [],
    repositoryUrl: `https://github.com/someone/${overrides.entryId}`,
    source: `git:https://github.com/someone/${overrides.entryId}.git@semver:^0.1.0`,
    compatible: true,
    incompatibleReason: null,
    installed: false,
    conflictingInstallSource: null,
    ...overrides,
  };
}
