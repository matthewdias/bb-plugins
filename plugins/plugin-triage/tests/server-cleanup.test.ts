// The Cleanup deck over RPC, against the SDK's fake host: usage sampling,
// trying without a plugin, keeping, uninstalling through the queue, and the
// Graveyard's restore.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";
import type { CleanupCard } from "../lib/cleanup-deck";
import { TRIAL_MS } from "../lib/cleanup-deck";
import type { GraveyardEntry } from "../lib/graveyard";

const NOW = Date.parse("2026-10-06T12:00:00Z");
const SELF = "plugin-triage";

interface Fake {
  id: string;
  enabled: boolean;
  status: string;
  count: number;
}

async function host(options: { remove?: (id: string) => unknown } = {}) {
  const installed: Fake[] = [
    { id: "off", enabled: false, status: "disabled", count: 0 },
    { id: "broken", enabled: true, status: "error", count: 0 },
    { id: "fine", enabled: true, status: "running", count: 3 },
    { id: SELF, enabled: false, status: "disabled", count: 0 },
  ];
  const { bb, harness } = createFakePluginHost({ pluginId: SELF, settings: { useGitHubLogin: false } });
  harness.sdk.stub("plugins.list", () => ({
    plugins: installed.map((p) => ({
      id: p.id,
      name: p.id,
      description: null,
      icon: null,
      iconUrl: null,
      enabled: p.enabled,
      status: p.status,
      statusDetail: p.status === "error" ? "boom" : null,
      source: `git:https://github.com/acme/${p.id}.git`,
      providerIds: [],
      capabilities: [{ kind: "agent-tool", label: "t" }],
      handlerStats: { count: p.count, errorCount: 0, maxMs: 0, totalMs: 0 },
    })),
  }));
  const find = (id: string) => installed.find((p) => p.id === id)!;
  harness.sdk.stub("plugins.disable", ({ pluginId }: { pluginId: string }) => {
    find(pluginId).enabled = false;
    return {};
  });
  harness.sdk.stub("plugins.enable", ({ pluginId }: { pluginId: string }) => {
    find(pluginId).enabled = true;
    return {};
  });
  harness.sdk.stub("plugins.getSource", ({ pluginId }: { pluginId: string }) => ({ requested: `git:https://github.com/acme/${pluginId}.git@*`, subdirectory: "plugins/x" }));
  harness.sdk.stub("plugins.getSettings", () => ({
    ok: true,
    schema: { mode: { type: "string", label: "Mode", default: "a" }, token: { type: "string", label: "Token", secret: true } },
    values: { mode: "b", token: "secret-value" },
  }));
  harness.sdk.stub("plugins.remove", ({ pluginId }: { pluginId: string }) => {
    const answer = options.remove?.(pluginId);
    if (answer instanceof Error) throw answer;
    installed.splice(installed.findIndex((p) => p.id === pluginId), 1);
    return { ok: true };
  });
  harness.sdk.stub("plugins.install", ({ source }: { source: string }) => {
    const id = /acme\/([^.]+)\.git/.exec(source)![1]!;
    installed.push({ id, enabled: true, status: "running", count: 0 });
    return { id };
  });
  harness.sdk.stub("plugins.updateSettings", () => ({ ok: true }));
  await plugin(bb);
  const service = harness.runService("queue");
  const rpc = async <T,>(method: string, input: unknown = {}) => (await harness.callRpc(method, input)) as T;
  const deck = () => rpc<{ cards: CleanupCard[]; graveyard: GraveyardEntry[] }>("cleanup_deck");
  const cards = async () => (await deck()).cards.map((c) => [c.pluginId, c.reason.kind]);
  const decide = (pluginId: string, action: string) => rpc<{ previous: unknown }>("cleanup_decide", { pluginId, displayName: pluginId, action });
  const advance = async (ms: number) => {
    await vi.advanceTimersByTimeAsync(ms);
    for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(0);
  };
  const run = async () => {
    await rpc("queue_start");
    await advance(10);
  };
  await advance(0);
  return { harness, service, installed, find, rpc, deck, cards, decide, advance, run };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("the Cleanup deck over RPC", () => {
  it("deals the broken and the turned-off, never itself", async () => {
    const { cards, service } = await host();
    expect(await cards()).toEqual([
      ["broken", "broken"],
      ["off", "disabled"],
    ]);
    service.controller.abort();
  });

  it("samples usage hourly, so a quiet plugin shows up after a month", async () => {
    const { harness, cards, find, service } = await host();
    vi.setSystemTime(NOW + 31 * 24 * 60 * 60 * 1000);
    await harness.runSchedule("usage");
    // "fine" was active at the first sample (count 3), a month ago.
    expect(await cards()).toContainEqual(["fine", "idle"]);
    find("fine").count = 4;
    await harness.runSchedule("usage");
    expect(await cards()).not.toContainEqual(["fine", "idle"]);
    service.controller.abort();
  });

  it("tries without a plugin: turns it off now, and asks again in two weeks", async () => {
    const { decide, cards, find, service } = await host();
    await decide("broken", "trial");
    expect(find("broken").enabled).toBe(false);
    expect(await cards()).toEqual([["off", "disabled"]]);
    vi.setSystemTime(NOW + TRIAL_MS);
    expect(await cards()).toEqual([
      ["broken", "trial"],
      ["off", "disabled"],
    ]);
    service.controller.abort();
  });

  it("turns a plugin back on at once, and keeps it out of the deck", async () => {
    const { decide, cards, find, service } = await host();
    await decide("off", "enable");
    expect(find("off").enabled).toBe(true);
    expect(await cards()).toEqual([["broken", "broken"]]);
    service.controller.abort();
  });

  it("undoes trying without, turning the plugin back on", async () => {
    const { rpc, decide, cards, find, service } = await host();
    const { previous } = await decide("broken", "trial");
    expect(await rpc("cleanup_undo", { pluginId: "broken", action: "trial", restore: previous })).toEqual({ undone: true, reason: null });
    expect(find("broken").enabled).toBe(true);
    expect(await cards()).toContainEqual(["broken", "broken"]);
    service.controller.abort();
  });

  it("uninstalls only on Run all, keeping settings for restore but never secrets", async () => {
    const { harness, decide, deck, cards, run, installed, service } = await host();
    await decide("off", "remove");
    expect(await cards()).toEqual([["broken", "broken"]]);
    expect(harness.sdk.callsTo("plugins.remove")).toHaveLength(0);
    await run();
    expect(harness.sdk.callsTo("plugins.remove")).toEqual([[{ pluginId: "off" }]]);
    expect(installed.some((p) => p.id === "off")).toBe(false);
    const [entry] = (await deck()).graveyard;
    expect(entry).toMatchObject({ pluginId: "off", source: "git:https://github.com/acme/off.git@*", subdirectory: "plugins/x", settings: { mode: "b" }, secrets: ["Token"] });
    expect(JSON.stringify(entry)).not.toContain("secret-value");
    service.controller.abort();
  });

  it("restores from the Graveyard: the same source, then the settings", async () => {
    const { harness, rpc, decide, deck, run, installed, service } = await host();
    await decide("off", "remove");
    await run();
    const [entry] = (await deck()).graveyard;
    expect(await rpc("graveyard_restore", { id: entry!.id })).toEqual({ pluginId: "off", secrets: ["Token"] });
    expect(harness.sdk.callsTo("plugins.install")).toEqual([[{ source: "git:https://github.com/acme/off.git@*", subdirectory: "plugins/x" }]]);
    expect(harness.sdk.callsTo("plugins.updateSettings")).toEqual([[{ pluginId: "off", values: { mode: "b" } }]]);
    expect(installed.some((p) => p.id === "off")).toBe(true);
    expect((await deck()).graveyard).toEqual([]);
    service.controller.abort();
  });

  it("keeps no Graveyard entry when the removal fails, and puts the card back", async () => {
    const { decide, deck, cards, run, service } = await host({ remove: () => new Error("in use") });
    await decide("off", "remove");
    await run();
    expect((await deck()).graveyard).toEqual([]);
    expect(await cards()).toContainEqual(["off", "disabled"]);
    service.controller.abort();
  });

  it("takes a queued removal off the queue, restoring a keep it replaced", async () => {
    const { rpc, decide, cards, service } = await host();
    vi.setSystemTime(NOW);
    await decide("off", "keep");
    // Kept, so out of the deck; the next deal brings it back to remove.
    vi.setSystemTime(NOW + 91 * 24 * 60 * 60 * 1000);
    await decide("off", "remove");
    expect(await rpc("unqueue", { key: "remove:off" })).toEqual({ removed: true, reason: null });
    vi.setSystemTime(NOW + 1);
    expect(await cards()).toEqual([["broken", "broken"]]);
    service.controller.abort();
  });

  it("forgets a Graveyard entry on request", async () => {
    const { rpc, decide, deck, run, service } = await host();
    await decide("off", "remove");
    await run();
    const [entry] = (await deck()).graveyard;
    await rpc("graveyard_forget", { id: entry!.id });
    expect((await deck()).graveyard).toEqual([]);
    service.controller.abort();
  });
});
