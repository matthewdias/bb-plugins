// The Updates deck over RPC, against the SDK's fake host: queueing, the
// batch, this plugin's own update last, failures, undo, skip and snooze.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";
import type { UpdateJob } from "../lib/queue";
import type { UpdateCard } from "../lib/updates-deck";

const NOW = Date.parse("2026-10-06T12:00:00Z");
const SELF = "plugin-triage";

type Deck = { cards: UpdateCard[]; queued: UpdateJob[]; running: boolean; history: UpdateJob[] };

const label = (v: string) => ({ version: v, display: `https://github.com/acme/x.git@v${v} (${v})` });

async function host(apply: (pluginId: string) => unknown = () => ({ applied: true, outcome: "updated", from: label("1"), to: label("2") })) {
  const ids = ["alpha", "beta", SELF];
  const { bb, harness } = createFakePluginHost({ pluginId: SELF });
  harness.sdk.stub("plugins.listUpdateResults", () =>
    ids.map((id) => ({ id, outcome: "update-available", installed: label("1"), candidate: label("2") })),
  );
  harness.sdk.stub("plugins.list", () => ({
    plugins: ids.map((id) => ({ id, name: id, description: null, icon: null, iconUrl: null, enabled: true })),
  }));
  harness.sdk.stub("plugins.applyUpdate", (args: { pluginId: string }) => apply(args.pluginId));
  harness.sdk.stub("plugins.checkUpdates", () => [{}, {}]);
  await plugin(bb);
  const service = harness.runService("queue");
  const rpc = async <T,>(method: string, input: unknown = {}) => (await harness.callRpc(method, input)) as T;
  const deck = () => rpc<Deck>("updates_deck");
  const cards = async () => (await deck()).cards.map((card) => card.pluginId);
  const decide = (pluginId: string, action: "queue" | "skip" | "snooze") =>
    rpc<{ previous: unknown }>("update_decide", { pluginId, displayName: pluginId, action, from: label("1"), to: label("2") });
  const applied = () => harness.sdk.callsTo("plugins.applyUpdate").map(([args]) => (args as { pluginId: string }).pluginId);
  const advance = async (ms: number) => {
    await vi.advanceTimersByTimeAsync(ms);
    for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(0);
  };
  return { harness, service, rpc, deck, cards, decide, applied, advance };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("the Updates deck over RPC", () => {
  it("lists every plugin with an update, this one last", async () => {
    const { cards, service } = await host();
    expect(await cards()).toEqual(["alpha", "beta", SELF]);
    service.controller.abort();
  });

  it("holds queued updates until the batch starts", async () => {
    const { decide, deck, applied, advance, service } = await host();
    await decide("alpha", "queue");
    await decide("beta", "queue");
    await advance(60_000);
    const before = await deck();
    expect(before.cards.map((c) => c.pluginId)).toEqual([SELF]);
    expect(before.queued.map((j) => j.pluginId)).toEqual(["alpha", "beta"]);
    expect(before.running).toBe(false);
    expect(applied()).toEqual([]);
    service.controller.abort();
  });

  it("runs the batch one at a time, this plugin's update last, and records each", async () => {
    const { rpc, decide, deck, applied, advance, service } = await host();
    await decide(SELF, "queue");
    await decide("alpha", "queue");
    await decide("beta", "queue");
    expect(await rpc("updates_start")).toEqual({ started: 3 });
    expect((await deck()).running).toBe(true);
    await advance(10);
    expect(applied()).toEqual(["alpha", "beta", SELF]);
    const after = await deck();
    expect(after.queued).toEqual([]);
    expect(after.running).toBe(false);
    expect(after.history.map((j) => [j.pluginId, j.state, j.result])).toEqual(
      expect.arrayContaining([
        ["alpha", "done", "updated"],
        ["beta", "done", "updated"],
        [SELF, "done", "updated"],
      ]),
    );
    service.controller.abort();
  });

  it("puts a rolled-back update's card back, carrying why", async () => {
    const { rpc, decide, deck, advance, service } = await host((id) =>
      id === "alpha" ? { applied: false, outcome: "rolled-back", from: label("1"), detail: "activation failed" } : { applied: true, outcome: "updated", from: label("1"), to: label("2") },
    );
    await decide("alpha", "queue");
    await rpc("updates_start");
    await advance(10);
    const after = await deck();
    const card = after.cards.find((c) => c.pluginId === "alpha");
    expect(card?.lastFailure).toBe("bb rolled it back: activation failed");
    expect(after.history[0]).toMatchObject({ pluginId: "alpha", state: "failed" });
    service.controller.abort();
  });

  it("counts an update bb finds already current as done", async () => {
    const { rpc, decide, deck, advance, service } = await host(() => ({ applied: false, outcome: "current", from: label("2") }));
    await decide("alpha", "queue");
    await rpc("updates_start");
    await advance(10);
    expect((await deck()).history[0]).toMatchObject({ pluginId: "alpha", state: "done", result: "current" });
    service.controller.abort();
  });

  it("is undone before the batch starts, and the card comes back", async () => {
    const { rpc, decide, cards, applied, advance, service } = await host();
    await decide("alpha", "queue");
    expect(await rpc("update_undo", { pluginId: "alpha" })).toEqual({ undone: true, reason: null });
    await rpc("updates_start");
    await advance(10);
    expect(applied()).toEqual([]);
    expect(await cards()).toContain("alpha");
    service.controller.abort();
  });

  it("can't be undone once it is updating", async () => {
    let finish: (value: unknown) => void = () => {};
    const { rpc, decide, advance, service } = await host(() => new Promise((resolve) => (finish = resolve)));
    await decide("alpha", "queue");
    await rpc("updates_start");
    await advance(10);
    const result = await rpc<{ undone: boolean; reason: string }>("update_undo", { pluginId: "alpha" });
    expect(result).toEqual({ undone: false, reason: "It's already updating." });
    finish({ applied: true, outcome: "updated", from: label("1"), to: label("2") });
    service.controller.abort();
  });

  it("skips a version and snoozes for a week", async () => {
    const { decide, cards, service } = await host();
    await decide("alpha", "skip");
    await decide("beta", "snooze");
    expect(await cards()).toEqual([SELF]);
    vi.setSystemTime(NOW + 8 * 24 * 60 * 60 * 1000);
    expect(await cards()).toEqual(["beta", SELF]);
    service.controller.abort();
  });

  it("finishes this plugin's own update after it reloads mid-update", async () => {
    let finish: (value: unknown) => void = () => {};
    const first = await host(() => new Promise((resolve) => (finish = resolve)));
    await first.decide(SELF, "queue");
    await first.rpc("updates_start");
    await first.advance(10);

    // The update replaced this plugin: the old load is stopped, and its call
    // returns into a stale handle.
    first.service.controller.abort();
    const next = await first.harness.lifecycle.reload(plugin);
    finish({ applied: true, outcome: "updated", from: label("1"), to: label("2") });
    next.harness.sdk.stub("plugins.listUpdateResults", () => []);
    next.harness.sdk.stub("plugins.list", () => ({ plugins: [] }));
    next.harness.sdk.stub("plugins.applyUpdate", () => ({ applied: false, outcome: "current", from: label("2") }));
    const service = next.harness.runService("queue");
    await first.advance(10);
    const deck = (await next.harness.callRpc("updates_deck", {})) as Deck;
    expect(deck.history[0]).toMatchObject({ pluginId: SELF, state: "done", result: "current" });
    service.controller.abort();
  });

  it("checks for updates on request", async () => {
    const { rpc, harness, service } = await host();
    expect(await rpc("updates_check", { pluginId: "alpha" })).toEqual({ checked: 2 });
    expect(harness.sdk.callsTo("plugins.checkUpdates")).toEqual([[{ pluginId: "alpha" }]]);
    service.controller.abort();
  });
});
