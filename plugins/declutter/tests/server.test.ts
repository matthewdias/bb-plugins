// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";
import { keyOf, type Item } from "../lib/items";
import { CHANGED } from "../lib/state";

async function host() {
  const fake = createFakePluginHost();
  await plugin(fake.bb);
  return fake.harness;
}

type Harness = Awaited<ReturnType<typeof host>>;
interface State {
  items: { key: string; item: Item; firstSeen: number }[];
  hidden: string[];
}

const state = async (harness: Harness) => (await harness.callRpc("state_get", null)) as State;
const report = async (harness: Harness, items: Item[]) =>
  ((await harness.callRpc("items_report", { items })) as { added: number }).added;
const hide = async (harness: Harness, item: Item, hidden = true) =>
  ((await harness.callRpc("hidden_set", { key: keyOf(item), hidden })) as { hidden: string[] }).hidden;

const side: Item = { surface: "header", pluginId: "side-chats", label: "Side chats" };
const copy: Item = { surface: "message", pluginId: null, label: "Copy message" };
const banner: Item = { surface: "banner", pluginId: "follow-up", label: null };

describe("the catalog", () => {
  it("adds what is new, once, and tells every window", async () => {
    const harness = await host();
    expect(await report(harness, [side, copy])).toBe(2);
    expect(await report(harness, [copy, banner])).toBe(1);
    expect((await state(harness)).items.map((entry) => entry.item)).toEqual([side, copy, banner]);
    expect(harness.realtimeSignals).toEqual([
      { channel: CHANGED, payload: null },
      { channel: CHANGED, payload: null },
    ]);
  });

  it("stays quiet when nothing is new", async () => {
    const harness = await host();
    await report(harness, [side]);
    await report(harness, [side]);
    expect(harness.realtimeSignals).toHaveLength(1);
  });

  it("keeps both of two windows' reports when they race", async () => {
    const harness = await host();
    await Promise.all([report(harness, [side]), report(harness, [copy]), report(harness, [banner])]);
    expect((await state(harness)).items).toHaveLength(3);
  });

  it("refuses an item that is not one of the three kinds", async () => {
    const harness = await host();
    await expect(
      harness.callRpc("items_report", { items: [{ surface: "footer", pluginId: null, label: "x" }] }),
    ).rejects.toThrow();
  });
});

describe("hiding", () => {
  it("hides, shows again, and tells every window each time", async () => {
    const harness = await host();
    expect(await hide(harness, side)).toEqual([keyOf(side)]);
    expect(await hide(harness, copy)).toEqual([keyOf(side), keyOf(copy)]);
    expect(await hide(harness, side, false)).toEqual([keyOf(copy)]);
    expect((await state(harness)).hidden).toEqual([keyOf(copy)]);
    expect(harness.realtimeSignals).toHaveLength(3);
  });

  it("does not list an item twice when hidden twice", async () => {
    const harness = await host();
    await hide(harness, side);
    expect(await hide(harness, side)).toEqual([keyOf(side)]);
  });

  it("keeps every toggle when several land at once", async () => {
    const harness = await host();
    await Promise.all([hide(harness, side), hide(harness, copy), hide(harness, banner)]);
    expect((await state(harness)).hidden.sort()).toEqual([keyOf(side), keyOf(copy), keyOf(banner)].sort());
  });

  it("refuses a key that names no item", async () => {
    const harness = await host();
    await expect(harness.callRpc("hidden_set", { key: "nope", hidden: true })).rejects.toThrow(/Not an item key/);
    expect((await state(harness)).hidden).toEqual([]);
  });

  it("shows everything again", async () => {
    const harness = await host();
    await hide(harness, side);
    await hide(harness, copy);
    expect(await harness.callRpc("hidden_reset", null)).toEqual({ hidden: [] });
    expect((await state(harness)).hidden).toEqual([]);
  });
});
