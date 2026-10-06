// What Plugin Triage keeps of a plugin it removed, so Restore can put it back.
// `bb plugin remove` deletes a plugin's settings, secrets and schedules; this
// is taken just before, from bb's own records. Secrets can't be read back and
// schedules are declared in code, so those are named, not kept: restore says
// what won't come back.

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface GraveyardEntry {
  id: string;
  pluginId: string;
  displayName: string;
  icon: string | null;
  iconUrl: string | null;
  removedAt: number;
  /** The source exactly as it was requested, to install again. */
  source: string;
  subdirectory: string | null;
  /** Settings that were not the default, secrets excluded. */
  settings: Record<string, JsonValue>;
  /** Labels of secret settings it had; these won't come back. */
  secrets: string[];
}

/** Most recent first, at most this many. */
export const GRAVEYARD_KEPT = 50;

interface SettingSchema {
  label: string;
  secret?: true;
  default?: unknown;
}

export interface SnapshotInput {
  id: string;
  now: number;
  plugin: { id: string; name: string | null; icon: string | null; iconUrl: string | null };
  source: { requested: string; subdirectory?: string };
  settings: { schema: Record<string, SettingSchema>; values: Record<string, JsonValue> } | null;
}

export function snapshot(input: SnapshotInput): GraveyardEntry {
  const settings: Record<string, JsonValue> = {};
  const secrets: string[] = [];
  for (const [key, schema] of Object.entries(input.settings?.schema ?? {})) {
    if (schema.secret === true) {
      secrets.push(schema.label);
      continue;
    }
    const value = input.settings?.values[key];
    // Defaults come back by themselves; only what was changed is kept.
    if (value !== undefined && JSON.stringify(value) !== JSON.stringify(schema.default)) settings[key] = value;
  }
  return {
    id: input.id,
    pluginId: input.plugin.id,
    displayName: input.plugin.name ?? input.plugin.id,
    icon: input.plugin.icon,
    iconUrl: input.plugin.iconUrl,
    removedAt: input.now,
    source: input.source.requested,
    subdirectory: input.source.subdirectory ?? null,
    settings,
    secrets,
  };
}

export function bury(graveyard: readonly GraveyardEntry[], entry: GraveyardEntry): GraveyardEntry[] {
  return [entry, ...graveyard.filter((other) => other.pluginId !== entry.pluginId)].slice(0, GRAVEYARD_KEPT);
}
