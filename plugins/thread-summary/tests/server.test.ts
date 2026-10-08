// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";
import { HIDDEN_CHANGED, MAX_HIDDEN, SHOW_CHIPS_KEY, normalizeHidden, withHidden } from "../lib/hidden";

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
  it("declares the chips switch, on by default", async () => {
    const { harness } = await host();
    expect(harness.registrations.settingsDescriptors[SHOW_CHIPS_KEY]).toMatchObject({
      type: "boolean",
      default: true,
    });
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
