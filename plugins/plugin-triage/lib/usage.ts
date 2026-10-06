// What Plugin Triage has seen of each installed plugin's use, sampled from
// bb's handler counts. bb has no "last used" record, and its handler count is
// held in memory: it survives a plugin reload and starts again from zero when
// the bb server restarts. So a sample compares counts, treats a drop as a
// restart, and remembers only when a plugin was last seen doing something.
//
// Handlers are server-side work: agent tools, CLI commands, hooks, RPCs. A
// plugin that only draws UI never moves the count, so it has no usage signal
// and the Cleanup deck never calls it idle.

export interface Observation {
  /** When Plugin Triage first saw this plugin installed (epoch ms). */
  firstSeenAt: number;
  /** The handler count at the last sample. */
  lastCount: number;
  /** When its count last went up, or null if never since being watched. */
  lastActiveAt: number | null;
  /** When it was first seen disabled, for the current spell; null while enabled. */
  disabledSince: number | null;
  /** Whether that spell began before Plugin Triage was watching. */
  disabledBeforeWatching: boolean;
}

/** Keyed by plugin id. */
export type Observations = Record<string, Observation>;

export interface PluginSample {
  id: string;
  enabled: boolean;
  handlerStats: { count: number };
}

export function observe(previous: Observations, plugins: readonly PluginSample[], now: number): Observations {
  const next: Observations = {};
  for (const plugin of plugins) {
    const count = plugin.handlerStats.count;
    const seen = previous[plugin.id];
    if (seen === undefined) {
      // A count already above zero means it did something since the server
      // started, which is as recent as this can tell.
      next[plugin.id] = {
        firstSeenAt: now,
        lastCount: count,
        lastActiveAt: count > 0 ? now : null,
        disabledSince: plugin.enabled ? null : now,
        disabledBeforeWatching: !plugin.enabled,
      };
      continue;
    }
    // Up: used since the last sample. Down: the server restarted, and
    // anything above zero has happened since.
    const active = count > seen.lastCount || (count < seen.lastCount && count > 0);
    next[plugin.id] = {
      firstSeenAt: seen.firstSeenAt,
      lastCount: count,
      lastActiveAt: active ? now : seen.lastActiveAt,
      disabledSince: plugin.enabled ? null : (seen.disabledSince ?? now),
      disabledBeforeWatching: plugin.enabled ? false : seen.disabledSince === null ? false : seen.disabledBeforeWatching,
    };
  }
  // Plugins no longer installed are dropped.
  return next;
}
