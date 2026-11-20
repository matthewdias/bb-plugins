// Installed plugins and the subset that Triage still counts as cleanup suggestions.
import type { Listing } from "./arrange.ts";
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

export const CLEANUP_ACTIONS = ["keep", "trial", "extend", "enable", "remove"] as const;
export type CleanupAction = (typeof CLEANUP_ACTIONS)[number];

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
  | { kind: "enabled" }
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
  suggested: boolean;
  protected: boolean;
  removalPending: boolean;
  /** Its store listing, for the grid's groups; the server adds it from the catalog. */
  listing?: Listing | null;
}

const BROKEN = new Set(["error", "incompatible", "missing", "degraded"]);

export const cleanupKey = (pluginId: string) => `remove:${pluginId}`;

/**
 * Read-only in Triage: this plugin; anything installed from a local folder, which is
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

function suggestion(plugin: Installed, input: CleanupDeckInput): CleanupReason | null {
  const decision = input.decisions[plugin.id];
  const seen = input.observations[plugin.id];
  if (decision?.action === "trial" && !plugin.enabled) {
    return input.now < decision.until ? null : { kind: "trial", since: decision.at };
  }
  if (decision?.action === "keep" && input.now < decision.until) return null;
  if (plugin.enabled && BROKEN.has(plugin.status)) {
    return { kind: "broken", status: plugin.status, detail: plugin.statusDetail };
  }
  if (!plugin.enabled) return isBuiltIn(plugin) ? null : disabledReason(seen);
  if (
    seen !== undefined &&
    hasUsageSignal(plugin) &&
    input.now - seen.firstSeenAt >= IDLE_MS &&
    (seen.lastActiveAt === null || input.now - seen.lastActiveAt >= IDLE_MS)
  ) {
    return { kind: "idle", lastActiveAt: seen.lastActiveAt, watchedSince: seen.firstSeenAt };
  }
  return null;
}

function disabledReason(seen: Observations[string] | undefined): CleanupReason {
  return { kind: "disabled", since: seen === undefined || seen.disabledBeforeWatching ? null : seen.disabledSince };
}

export function buildInstalledDeck(input: CleanupDeckInput): CleanupCard[] {
  return input.plugins.map((plugin): CleanupCard => {
    const key = cleanupKey(plugin.id);
    const protectedPlugin = isProtected(plugin, input.selfId);
    const removalPending = liveJob(input.jobs, key) !== null;
    const suggested = protectedPlugin || removalPending ? null : suggestion(plugin, input);
    const reason = suggested ?? (
      !plugin.enabled ? disabledReason(input.observations[plugin.id])
      : BROKEN.has(plugin.status) ? { kind: "broken", status: plugin.status, detail: plugin.statusDetail }
      : { kind: "enabled" }
    );
    return {
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
      suggested: suggested !== null,
      protected: protectedPlugin,
      removalPending,
    };
  }).sort((a, b) => a.displayName.localeCompare(b.displayName));
}
