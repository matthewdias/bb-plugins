// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";
import { DEFAULT_COMPLICATION_PRIORITY, MAX_STORED_PREFS, PREFS_CHANGED } from "../badges/complication-prefs";

async function host() {
  const fake = createFakePluginHost();
  await plugin(fake.bb);
  return fake;
}

const list = async (harness: Awaited<ReturnType<typeof host>>["harness"]) =>
  ((await harness.callRpc("complicationPrefs_list", {})) as { prefs: Record<string, unknown> }).prefs;

describe("settings", () => {
  it("declares the built-in badges' switches and nothing for follow-ups any more", async () => {
    const { harness } = await host();
    const keys = Object.keys(harness.registrations.settingsDescriptors);
    expect(keys).toContain("show_pullRequest");
    expect(keys).toContain("ports_priority");
    expect(keys.filter((key) => key.toLowerCase().includes("followups"))).toEqual([]);
  });
});

describe("complication settings", () => {
  it("starts empty: nothing is turned on until you turn it on", async () => {
    const { harness } = await host();
    expect(await list(harness)).toEqual({});
  });

  it("fills in the rest from defaults when one field is set, and keeps earlier fields", async () => {
    const { harness } = await host();
    await harness.callRpc("complicationPrefs_set", { id: "follow-up/progress", prefs: { enabled: true } });
    await harness.callRpc("complicationPrefs_set", { id: "follow-up/progress", prefs: { showText: true } });
    expect(await list(harness)).toEqual({
      "follow-up/progress": {
        enabled: true,
        priority: DEFAULT_COMPLICATION_PRIORITY,
        showText: true,
        hideWhenComplete: false,
      },
    });
  });

  it("tells every window after a write", async () => {
    const { harness } = await host();
    await harness.callRpc("complicationPrefs_set", { id: "follow-up/progress", prefs: { enabled: true } });
    expect(harness.realtimeSignals).toEqual([
      { channel: PREFS_CHANGED, payload: { id: "follow-up/progress" } },
    ]);
  });

  it("keeps settings across a reload", async () => {
    const { harness } = await host();
    await harness.callRpc("complicationPrefs_set", { id: "follow-up/progress", prefs: { priority: 1 } });
    const reloaded = await harness.reload(plugin);
    expect(await list(reloaded.harness)).toMatchObject({ "follow-up/progress": { priority: 1 } });
  });

  it("refuses an id that is not <pluginId>/<name>, and a field it does not know", async () => {
    const { harness } = await host();
    await expect(
      harness.callRpc("complicationPrefs_set", { id: "progress", prefs: { enabled: true } }),
    ).rejects.toThrow();
    await expect(
      harness.callRpc("complicationPrefs_set", { id: "a/b", prefs: { enabled: "yes" } }),
    ).rejects.toThrow();
    await expect(
      harness.callRpc("complicationPrefs_set", { id: "a/b", prefs: { urgent: true } }),
    ).rejects.toThrow();
    expect(await list(harness)).toEqual({});
    expect(harness.realtimeSignals).toEqual([]);
  });

  it("stops storing new ids at the cap, but still updates ones it has", async () => {
    const { harness } = await host();
    for (let index = 0; index < MAX_STORED_PREFS; index++) {
      await harness.callRpc("complicationPrefs_set", { id: `p${index}/c`, prefs: { enabled: true } });
    }
    await expect(
      harness.callRpc("complicationPrefs_set", { id: "one/more", prefs: { enabled: true } }),
    ).rejects.toThrow(/already stored/);
    await expect(
      harness.callRpc("complicationPrefs_set", { id: "p0/c", prefs: { enabled: false } }),
    ).resolves.toBeDefined();
  });
});
