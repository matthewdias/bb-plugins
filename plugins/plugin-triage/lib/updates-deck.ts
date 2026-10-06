// The Updates deck: installed plugins with a newer compatible version, less
// the ones queued, skipped at this version, or snoozed. Pure, so the server
// and the tests build the same deck from bb's update results.
import { failuresByKey, liveJob, type Job, type VersionLabel } from "./queue.ts";

/** bb's per-plugin update result, as far as this plugin reads it. */
export interface UpdateResult {
  id: string;
  outcome: "update-available" | "current" | "incompatible" | "pinned" | "unavailable";
  installed: VersionLabel;
  candidate?: VersionLabel;
  blocked?: { version: string; reasons: string[] };
  detail?: string;
}

/** The fields of an installed plugin this deck reads. */
export interface InstalledPlugin {
  id: string;
  name: string | null;
  description: string | null;
  icon: string | null;
  iconUrl: string | null;
  enabled: boolean;
  updateState?: { lastFailure?: { at: number; detail: string; version: string } };
}

export type UpdateDecision =
  | { action: "queue"; version: string; at: number }
  | { action: "skip"; version: string; at: number }
  | { action: "snooze"; version: string; at: number; until: number };

/** Keyed by plugin id. */
export type UpdateDecisions = Record<string, UpdateDecision>;

export interface UpdateCard {
  key: string;
  pluginId: string;
  displayName: string;
  description: string | null;
  icon: string | null;
  iconUrl: string | null;
  enabled: boolean;
  from: VersionLabel & { short: string };
  to: VersionLabel & { short: string };
  /** A newer release bb would not pick, and why. */
  blocked: { version: string; reasons: string[] } | null;
  lastFailure: string | null;
  /** The commits between the two versions, when both are commits on GitHub. */
  compareUrl: string | null;
  /** This plugin: its update reloads it, so it runs last. */
  isSelf: boolean;
}

export interface Unavailable {
  pluginId: string;
  displayName: string;
  detail: string | null;
}

export const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

export const updateKey = (pluginId: string) => `update:${pluginId}`;

/**
 * bb labels a version with its whole source ("https://github.com/a/b.git@
 * notes/v1.2.0 (0123456789ab)"); a card has room for what follows the @.
 */
export function shortVersion(label: VersionLabel): string {
  const at = label.display.lastIndexOf("@");
  return at > 0 ? label.display.slice(at + 1) : label.display;
}

const SHA = /^[0-9a-f]{40}$/i;
const GITHUB_REPO = /^(https?:\/\/(?:www\.)?github\.com\/[^/\s@]+\/[^/\s@]+?)(?:\.git)?@/i;

export function compareUrl(from: VersionLabel, to: VersionLabel): string | null {
  if (!SHA.test(from.version) || !SHA.test(to.version)) return null;
  const repo = GITHUB_REPO.exec(to.display)?.[1] ?? GITHUB_REPO.exec(from.display)?.[1];
  return repo === undefined ? null : `${repo}/compare/${from.version}...${to.version}`;
}

/** Whether a decision keeps this card out of the deck right now. */
function settled(decision: UpdateDecision | undefined, candidate: string, now: number): boolean {
  if (decision === undefined) return false;
  switch (decision.action) {
    case "queue":
      // Only while its job lives; a finished or cancelled one lets it back.
      return false;
    case "skip":
      return decision.version === candidate;
    case "snooze":
      return decision.until > now;
  }
}

export interface UpdatesDeckInput {
  results: readonly UpdateResult[];
  plugins: readonly InstalledPlugin[];
  decisions: UpdateDecisions;
  jobs: readonly Job[];
  now: number;
  selfId: string;
}

export function buildUpdatesDeck(input: UpdatesDeckInput): { cards: UpdateCard[]; unavailable: Unavailable[] } {
  const byId = new Map(input.plugins.map((plugin) => [plugin.id, plugin]));
  const failures = failuresByKey(input.jobs);
  const nameOf = (id: string) => byId.get(id)?.name ?? id;
  const cards: UpdateCard[] = [];
  const unavailable: Unavailable[] = [];

  for (const result of input.results) {
    if (result.outcome === "unavailable") {
      unavailable.push({ pluginId: result.id, displayName: nameOf(result.id), detail: result.detail ?? null });
      continue;
    }
    if (result.outcome !== "update-available" || result.candidate === undefined) continue;
    const key = updateKey(result.id);
    if (liveJob(input.jobs, key) !== null) continue;
    if (settled(input.decisions[result.id], result.candidate.version, input.now)) continue;

    const plugin = byId.get(result.id);
    const failed = plugin?.updateState?.lastFailure;
    cards.push({
      key,
      pluginId: result.id,
      displayName: nameOf(result.id),
      description: plugin?.description ?? null,
      icon: plugin?.icon ?? null,
      iconUrl: plugin?.iconUrl ?? null,
      enabled: plugin?.enabled ?? true,
      from: { ...result.installed, short: shortVersion(result.installed) },
      to: { ...result.candidate, short: shortVersion(result.candidate) },
      blocked: result.blocked ?? null,
      lastFailure:
        failures[key] ?? (failed !== undefined && failed.version === result.candidate.version ? failed.detail : null),
      compareUrl: compareUrl(result.installed, result.candidate),
      isSelf: result.id === input.selfId,
    });
  }

  // Alphabetical, with this plugin last: its own update is applied last.
  cards.sort((a, b) => Number(a.isSelf) - Number(b.isSelf) || a.displayName.localeCompare(b.displayName));
  unavailable.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return { cards, unavailable };
}
