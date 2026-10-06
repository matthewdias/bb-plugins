// The Cleanup deck: installed plugins worth a second look, broken ones first,
// then ones put aside to try without, then ones you turned off (not bb's own,
// which ship off), then ones with no activity in a month. Pure, so the server and the tests build the same deck.
import { liveJob, type Job } from "./queue.ts";
import type { Observations } from "./usage.ts";

const DAY = 24 * 60 * 60 * 1000;
/** No activity for this long, watched at least this long, is idle. */
export const IDLE_MS = 30 * DAY;
/** "Keep" puts a card away for this long. */
export const KEEP_MS = 90 * DAY;
/** "Try without it" disables a plugin and asks again after this long. */
export const TRIAL_MS = 14 * DAY;

/** The fields of an installed plugin this deck reads. */
export interface Installed {
  id: string;
  name: string | null;
  description: string | null;
  icon: string | null;
  iconUrl: string | null;
  enabled: boolean;
  status: string;
  statusDetail: string | null;
  source: string;
  sourceDisplay?: string;
  provenance?: string;
  providerIds: string[];
  capabilities?: { kind: string; label: string }[];
  cliCommand?: { name: string } | null;
  services?: unknown[];
  schedules?: unknown[];
}

export type CleanupDecision =
  | { action: "keep"; at: number; until: number }
  | { action: "trial"; at: number; until: number };

/** Keyed by plugin id. */
export type CleanupDecisions = Record<string, CleanupDecision>;

export type CleanupReason =
  | { kind: "broken"; status: string; detail: string | null }
  /** Disabled through "try without it", and the time is up. */
  | { kind: "trial"; since: number }
  /** Disabled; `since` null when it already was when Triage started watching. */
  | { kind: "disabled"; since: number | null }
  | { kind: "idle"; lastActiveAt: number | null; watchedSince: number };

export interface CleanupCard {
  key: string;
  pluginId: string;
  displayName: string;
  description: string | null;
  icon: string | null;
  iconUrl: string | null;
  enabled: boolean;
  source: string;
  /** What it adds: agent tools, skills, a CLI command… */
  surfaces: string[];
  reason: CleanupReason;
}

const BROKEN = new Set(["error", "incompatible", "missing", "degraded"]);

export const cleanupKey = (pluginId: string) => `remove:${pluginId}`;

/**
 * Never dealt: this plugin; anything installed from a local folder, which is
 * someone's working copy; providers, which threads run on; and the plugins
 * bb's own sidebar and environments are made of.
 */
export function isProtected(plugin: Installed, selfId: string): boolean {
  return (
    plugin.id === selfId ||
    plugin.source.startsWith("path:") ||
    plugin.providerIds.length > 0 ||
    plugin.id.startsWith("environment-") ||
    plugin.id === "navigation"
  );
}

/** One of the plugins bundled with bb. */
export function isBuiltIn(plugin: Installed): boolean {
  return plugin.provenance === "builtin" || plugin.source.startsWith("builtin:");
}

/** Whether bb's handler count can show this plugin in use at all. */
export function hasUsageSignal(plugin: Installed): boolean {
  return (
    (plugin.capabilities?.length ?? 0) > 0 ||
    (plugin.cliCommand ?? null) !== null ||
    (plugin.services?.length ?? 0) > 0 ||
    (plugin.schedules?.length ?? 0) > 0
  );
}

function surfaces(plugin: Installed): string[] {
  const kinds = new Map<string, number>();
  for (const capability of plugin.capabilities ?? []) kinds.set(capability.kind, (kinds.get(capability.kind) ?? 0) + 1);
  const out: string[] = [];
  const named: Record<string, [string, string]> = {
    "agent-tool": ["an agent tool", "agent tools"],
    skill: ["a skill", "skills"],
    theme: ["a theme", "themes"],
    "thread-integration": ["a thread integration", "thread integrations"],
  };
  for (const [kind, n] of kinds) {
    const [one, many] = named[kind] ?? [kind, kind];
    out.push(n === 1 ? one : `${n} ${many}`);
  }
  if (plugin.cliCommand) out.push(`bb ${plugin.cliCommand.name}`);
  if ((plugin.schedules?.length ?? 0) > 0) out.push("scheduled work");
  return out;
}

export interface CleanupDeckInput {
  plugins: readonly Installed[];
  observations: Observations;
  decisions: CleanupDecisions;
  jobs: readonly Job[];
  now: number;
  selfId: string;
}

const ORDER: Record<CleanupReason["kind"], number> = { broken: 0, trial: 1, disabled: 2, idle: 3 };

export function buildCleanupDeck(input: CleanupDeckInput): CleanupCard[] {
  const cards: CleanupCard[] = [];
  for (const plugin of input.plugins) {
    if (isProtected(plugin, input.selfId)) continue;
    const key = cleanupKey(plugin.id);
    if (liveJob(input.jobs, key) !== null) continue;
    const decision = input.decisions[plugin.id];
    const seen = input.observations[plugin.id];

    let reason: CleanupReason | null = null;
    if (decision?.action === "trial" && !plugin.enabled) {
      // Put aside to try without: quiet until the time is up.
      if (input.now < decision.until) continue;
      reason = { kind: "trial", since: decision.at };
    } else if (decision?.action === "keep" && input.now < decision.until) {
      continue;
    } else if (plugin.enabled && BROKEN.has(plugin.status)) {
      reason = { kind: "broken", status: plugin.status, detail: plugin.statusDetail };
    } else if (!plugin.enabled) {
      // bb ships some of its own plugins turned off; off, they cost nothing,
      // and dealing them would only bring them back every ninety days.
      if (isBuiltIn(plugin)) continue;
      reason = { kind: "disabled", since: seen === undefined || seen.disabledBeforeWatching ? null : seen.disabledSince };
    } else if (
      seen !== undefined &&
      hasUsageSignal(plugin) &&
      input.now - seen.firstSeenAt >= IDLE_MS &&
      (seen.lastActiveAt === null || input.now - seen.lastActiveAt >= IDLE_MS)
    ) {
      reason = { kind: "idle", lastActiveAt: seen.lastActiveAt, watchedSince: seen.firstSeenAt };
    }
    if (reason === null) continue;

    cards.push({
      key,
      pluginId: plugin.id,
      displayName: plugin.name ?? plugin.id,
      description: plugin.description,
      icon: plugin.icon,
      iconUrl: plugin.iconUrl,
      enabled: plugin.enabled,
      source: plugin.sourceDisplay ?? plugin.source,
      surfaces: surfaces(plugin),
      reason,
    });
  }
  cards.sort((a, b) => ORDER[a.reason.kind] - ORDER[b.reason.kind] || a.displayName.localeCompare(b.displayName));
  return cards;
}
