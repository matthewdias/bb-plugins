// What uninstalling a plugin throws away, for the card to say before it is
// queued. `bb plugin remove` deletes a plugin's settings, secrets and
// schedules, and nothing brings them back; its data folder stays on disk.

export interface RemovalCost {
  /** Labels of settings changed from their defaults. */
  settings: string[];
  /** Labels of secret settings that hold a value. */
  secrets: string[];
  /** Whether it runs on a schedule, which goes with it. */
  scheduled: boolean;
}

interface SettingSchema {
  label: string;
  secret?: true;
  default?: unknown;
}

/** bb never returns a secret's value: a secret reads as `{ set: boolean }`. */
const isSetSecret = (value: unknown) =>
  typeof value === "object" && value !== null && (value as { set?: unknown }).set === true;

export function removalCost(
  settings: { schema: Record<string, SettingSchema>; values: Record<string, unknown> } | null,
  schedules: number,
): RemovalCost {
  const changed: string[] = [];
  const secrets: string[] = [];
  for (const [key, schema] of Object.entries(settings?.schema ?? {})) {
    const value = settings?.values[key];
    if (schema.secret === true) {
      if (isSetSecret(value)) secrets.push(schema.label);
    } else if (value !== undefined && JSON.stringify(value) !== JSON.stringify(schema.default)) {
      changed.push(schema.label);
    }
  }
  return { settings: changed, secrets, scheduled: schedules > 0 };
}

const list = (items: string[]) =>
  items.length <= 2 ? items.join(" and ") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

/** "Uninstalling deletes its 2 changed settings (Mode and Theme) and its API key." */
export function describeCost(cost: RemovalCost): string {
  const parts: string[] = [];
  if (cost.settings.length > 0) {
    parts.push(`${cost.settings.length === 1 ? "its changed setting" : `its ${cost.settings.length} changed settings`} (${list(cost.settings)})`);
  }
  if (cost.secrets.length > 0) parts.push(`${cost.secrets.length === 1 ? "its secret" : "its secrets"} ${list(cost.secrets)}`);
  if (cost.scheduled) parts.push("its scheduled work");
  return parts.length === 0
    ? "Uninstalling loses nothing you've set; it can be installed again from the store."
    : `Uninstalling deletes ${list(parts)}, for good.`;
}
