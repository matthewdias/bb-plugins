import { describe, expect, it } from "vitest";
import { GRAVEYARD_KEPT, bury, snapshot } from "../lib/graveyard";

describe("the Graveyard", () => {
  const base = {
    id: "g1",
    now: 1000,
    plugin: { id: "notes", name: "Notes", icon: null, iconUrl: null },
    source: { requested: "git:https://github.com/acme/plugins.git@semver:notes/:*", subdirectory: "plugins/notes" },
  };

  it("keeps the source as requested, and the settings that were changed", () => {
    const entry = snapshot({
      ...base,
      settings: {
        schema: {
          theme: { label: "Theme", default: "light" },
          width: { label: "Width", default: 300 },
          apiKey: { label: "API key", secret: true },
        },
        values: { theme: "dark", width: 300, apiKey: "sk-should-not-be-kept" },
      },
    });
    expect(entry).toMatchObject({
      pluginId: "notes",
      displayName: "Notes",
      source: "git:https://github.com/acme/plugins.git@semver:notes/:*",
      subdirectory: "plugins/notes",
      settings: { theme: "dark" },
      secrets: ["API key"],
    });
    expect(JSON.stringify(entry)).not.toContain("sk-should-not-be-kept");
  });

  it("copes with a plugin that has no settings", () => {
    expect(snapshot({ ...base, settings: null })).toMatchObject({ settings: {}, secrets: [] });
  });

  it("keeps one entry per plugin, newest first, and only so many", () => {
    const entry = (id: string, pluginId: string) => snapshot({ ...base, id, plugin: { ...base.plugin, id: pluginId }, settings: null });
    let graveyard = bury([], entry("1", "a"));
    graveyard = bury(graveyard, entry("2", "b"));
    graveyard = bury(graveyard, entry("3", "a"));
    expect(graveyard.map((g) => g.id)).toEqual(["3", "2"]);
    for (let i = 0; i < GRAVEYARD_KEPT + 5; i++) graveyard = bury(graveyard, entry(`x${i}`, `p${i}`));
    expect(graveyard).toHaveLength(GRAVEYARD_KEPT);
  });
});
