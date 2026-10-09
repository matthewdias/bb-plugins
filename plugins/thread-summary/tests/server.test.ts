// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";
import { CHIPS_KEY, CHIP_STYLES, HIDDEN_CHANGED, MAX_HIDDEN, chipStyleOf, normalizeHidden, withHidden } from "../lib/hidden";

async function host() {
  const fake = createFakePluginHost();
  await plugin(fake.bb);
  return fake;
}

type Harness = Awaited<ReturnType<typeof host>>["harness"];
const list = async (harness: Harness) =>
  ((await harness.callRpc("hiddenProviders_list", {})) as { hidden: string[] }).hidden;
const set = (harness: Harness, id: string, hidden: boolean) =>
  harness.callRpc("hiddenProviders_set", { id, hidden });

describe("settings", () => {
  it("declares one three-way chips choice, Text by default, and no old switch", async () => {
    const { harness } = await host();
    expect(CHIPS_KEY).toBe("chips");
    expect(harness.registrations.settingsDescriptors[CHIPS_KEY]).toMatchObject({
      type: "select",
      options: ["Text", "Icons only", "Off"],
      default: "Text",
    });
    expect(Object.keys(harness.registrations.settingsDescriptors)).toEqual([CHIPS_KEY]);
  });
});

describe("chipStyleOf", () => {
  it("maps each choice", () => {
    expect(CHIP_STYLES).toEqual({ text: "Text", icons: "Icons only", off: "Off" });
    expect(chipStyleOf("Text")).toBe("text");
    expect(chipStyleOf("Icons only")).toBe("icons");
    expect(chipStyleOf("Off")).toBe("off");
  });

  it("reads anything else as Text, the default", () => {
    for (const raw of [undefined, null, "", "off", "icons", false, true, 0]) expect(chipStyleOf(raw)).toBe("text");
  });
});

describe("hidden providers", () => {
  it("starts with nothing hidden", async () => {
    const { harness } = await host();
    expect(await list(harness)).toEqual([]);
  });

  it("hides and shows again, keeping the others", async () => {
    const { harness } = await host();
    await set(harness, "follow-up/progress", true);
    await set(harness, "thread-summary/git", true);
    await set(harness, "follow-up/progress", false);
    expect(await list(harness)).toEqual(["thread-summary/git"]);
  });

  it("hides a provider once however often it is asked", async () => {
    const { harness } = await host();
    await set(harness, "thread-summary/git", true);
    await set(harness, "thread-summary/git", true);
    expect(await list(harness)).toEqual(["thread-summary/git"]);
  });

  it("tells every window after a write", async () => {
    const { harness } = await host();
    await set(harness, "thread-summary/git", true);
    expect(harness.realtimeSignals).toEqual([{ channel: HIDDEN_CHANGED, payload: { id: "thread-summary/git" } }]);
  });

  it("keeps the list across a reload", async () => {
    const { harness } = await host();
    await set(harness, "thread-summary/git", true);
    const reloaded = await harness.reload(plugin);
    expect(await list(reloaded.harness)).toEqual(["thread-summary/git"]);
  });

  it("refuses an id that is not <pluginId>/<name>", async () => {
    const { harness } = await host();
    await expect(set(harness, "not an id", true)).rejects.toThrow();
    expect(await list(harness)).toEqual([]);
  });

  it("refuses to grow past its cap, but still shows one again", async () => {
    const { harness } = await host();
    for (let index = 0; index < MAX_HIDDEN; index += 1) await set(harness, `p${index}/x`, true);
    await expect(set(harness, "one-more/x", true)).rejects.toThrow(/Already hiding/);
    await set(harness, "p0/x", false);
    expect(await list(harness)).toHaveLength(MAX_HIDDEN - 1);
  });
});

describe("normalizeHidden", () => {
  it("keeps well-formed ids once each, and nothing from a malformed store", () => {
    expect(normalizeHidden(["a/b", "a/b", "bad", 3, "c/d"])).toEqual(["a/b", "c/d"]);
    expect(normalizeHidden({ "a/b": true })).toEqual([]);
    expect(normalizeHidden(undefined)).toEqual([]);
  });

  it("withHidden adds at the end and removes in place", () => {
    expect(withHidden(["a/b"], "c/d", true)).toEqual(["a/b", "c/d"]);
    expect(withHidden(["a/b", "c/d"], "a/b", false)).toEqual(["c/d"]);
  });
});
