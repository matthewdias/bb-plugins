// The Updates deck over RPC, against the SDK's fake host: queueing, the
// batch, this plugin's own update last, failures, undo, skip and snooze.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";
import type { UpdateJob } from "../lib/queue";
import type { UpdateCard } from "../lib/updates-deck";

const NOW = Date.parse("2026-10-06T12:00:00Z");
const SELF = "plugin-triage";

type Deck = { cards: UpdateCard[]; history: UpdateJob[] };
type Queue = { jobs: UpdateJob[]; running: boolean };

const label = (v: string) => ({ version: v, display: `https://github.com/acme/x.git@v${v} (${v})` });

async function host(
  apply: (pluginId: string) => unknown = () => ({ applied: true, outcome: "updated", from: label("1"), to: label("2") }),
  login = false,
) {
  const ids = ["alpha", "beta", SELF];
  // Never this machine's real gh login: tests that want one set GH_TOKEN.
  const { bb, harness } = createFakePluginHost({ pluginId: SELF, settings: { useGitHubLogin: login } });
  harness.sdk.stub("plugins.listUpdateResults", () =>
    ids.map((id) => ({ id, outcome: "update-available", installed: label("1"), candidate: label("2") })),
  );
  harness.sdk.stub("plugins.list", () => ({
    plugins: ids.map((id) => ({ id, name: id, description: null, icon: null, iconUrl: null, enabled: true })),
  }));
  harness.sdk.stub("plugins.applyUpdate", (args: { pluginId: string }) => apply(args.pluginId));
  // A fresh check offers what the deck showed, unless a test moves it.
  const offers = new Map<string, string>();
  harness.sdk.stub("plugins.checkUpdates", (args?: { pluginId?: string }) =>
    args?.pluginId === undefined
      ? [{}, {}]
      : [{ id: args.pluginId, outcome: "update-available", installed: label("1"), candidate: label(offers.get(args.pluginId) ?? "2") }],
  );
  await plugin(bb);
  const service = harness.runService("queue");
  const rpc = async <T,>(method: string, input: unknown = {}) => (await harness.callRpc(method, input)) as T;
  const deck = () => rpc<Deck>("updates_deck");
  const queue = () => rpc<Queue>("queue_status");
  const cards = async () => (await deck()).cards.map((card) => card.pluginId);
  const decide = (pluginId: string, action: "queue" | "skip" | "snooze") =>
    rpc<{ previous: unknown }>("update_decide", { pluginId, displayName: pluginId, action, from: label("1"), to: label("2") });
  const applied = () => harness.sdk.callsTo("plugins.applyUpdate").map(([args]) => (args as { pluginId: string }).pluginId);
  const advance = async (ms: number) => {
    await vi.advanceTimersByTimeAsync(ms);
    for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(0);
  };
  return { harness, service, rpc, deck, cards, decide, applied, advance, offers, queue };
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

  it("clears queued updates, dealing their cards again", async () => {
    const { rpc, decide, cards, applied, advance, service } = await host();
    await decide("alpha", "queue");
    await decide("beta", "queue");
    expect(await cards()).toEqual([SELF]);
    expect(await rpc("queue_clear", {})).toEqual({ removed: 2 });
    expect(await cards()).toEqual(["alpha", "beta", SELF]);
    await rpc("queue_start");
    await advance(10);
    expect(applied()).toEqual([]);
    service.controller.abort();
  });

  it("holds queued updates until the batch starts", async () => {
    const { decide, deck, queue, applied, advance, service } = await host();
    await decide("alpha", "queue");
    await decide("beta", "queue");
    await advance(60_000);
    const before = await deck();
    expect(before.cards.map((c) => c.pluginId)).toEqual([SELF]);
    expect((await queue()).jobs.map((j) => j.pluginId)).toEqual(["alpha", "beta"]);
    expect((await queue()).running).toBe(false);
    expect(applied()).toEqual([]);
    service.controller.abort();
  });

  it("runs the batch one at a time, this plugin's update last, and records each", async () => {
    const { rpc, decide, deck, queue, applied, advance, service } = await host();
    await decide(SELF, "queue");
    await decide("alpha", "queue");
    await decide("beta", "queue");
    expect(await rpc("queue_start")).toEqual({ started: 3 });
    expect((await queue()).running).toBe(true);
    await advance(10);
    expect(applied()).toEqual(["alpha", "beta", SELF]);
    const after = await deck();
    expect((await queue()).jobs).toEqual([]);
    expect((await queue()).running).toBe(false);
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
    await rpc("queue_start");
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
    await rpc("queue_start");
    await advance(10);
    expect((await deck()).history[0]).toMatchObject({ pluginId: "alpha", state: "done", result: "current" });
    service.controller.abort();
  });

  it("is undone before the batch starts, and the card comes back", async () => {
    const { rpc, decide, cards, applied, advance, service } = await host();
    await decide("alpha", "queue");
    expect(await rpc("update_undo", { pluginId: "alpha" })).toEqual({ undone: true, reason: null });
    await rpc("queue_start");
    await advance(10);
    expect(applied()).toEqual([]);
    expect(await cards()).toContain("alpha");
    service.controller.abort();
  });

  it("can't be undone once it is updating", async () => {
    let finish: (value: unknown) => void = () => {};
    const { rpc, decide, advance, service } = await host(() => new Promise((resolve) => (finish = resolve)));
    await decide("alpha", "queue");
    await rpc("queue_start");
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
    await first.rpc("queue_start");
    await first.advance(10);

    // The update replaced this plugin: the old load is stopped, and its call
    // returns into a stale handle.
    first.service.controller.abort();
    const next = await first.harness.lifecycle.reload(plugin);
    finish({ applied: true, outcome: "updated", from: label("1"), to: label("2") });
    next.harness.sdk.stub("plugins.listUpdateResults", () => []);
    next.harness.sdk.stub("plugins.list", () => ({ plugins: [] }));
    // The update landed: a fresh check finds this plugin current.
    next.harness.sdk.stub("plugins.checkUpdates", () => [{ id: SELF, outcome: "current", installed: label("2") }]);
    next.harness.sdk.stub("plugins.applyUpdate", () => ({ applied: false, outcome: "current", from: label("2") }));
    const service = next.harness.runService("queue");
    await first.advance(10);
    const deck = (await next.harness.callRpc("updates_deck", {})) as Deck;
    expect(deck.history[0]).toMatchObject({ pluginId: SELF, state: "done", result: "current" });
    service.controller.abort();
  });

  it("checks for updates on request", async () => {
    const { rpc, harness, service } = await host();
    expect(await rpc("updates_check", {})).toEqual({ checked: 2 });
    expect(harness.sdk.callsTo("plugins.checkUpdates")).toEqual([[{}]]);
    await rpc("updates_check", { pluginId: "alpha" });
    expect(harness.sdk.callsTo("plugins.checkUpdates").at(-1)).toEqual([{ pluginId: "alpha" }]);
    service.controller.abort();
  });

  it("applies only the version the card showed: a moved offer comes back for review", async () => {
    const { rpc, decide, deck, applied, advance, offers, service } = await host();
    await decide("alpha", "queue");
    // The branch moved after the swipe: bb now offers version 3.
    offers.set("alpha", "3");
    await rpc("queue_start");
    await advance(10);
    expect(applied()).toEqual([]);
    const after = await deck();
    expect(after.history[0]).toMatchObject({ pluginId: "alpha", state: "failed" });
    expect(after.history[0]!.error).toMatch(/changed since you queued it/);
    expect(after.cards.map((card) => card.pluginId)).toContain("alpha");
    service.controller.abort();
  });

  it("caches what an update changes, and asks GitHub again only after a failure", async () => {
    const { harness, rpc, service } = await host();
    harness.sdk.stub("plugins.getSource", () => ({ subdirectory: "plugins/alpha" }));
    const sha = (c: string) => c.repeat(40);
    const range = { pluginId: "alpha", from: { version: sha("a"), display: `https://github.com/acme/x.git@HEAD (a)` }, to: { version: sha("b"), display: `https://github.com/acme/x.git@HEAD (b)` } };
    let calls = 0;
    let fail = true;
    vi.stubGlobal("fetch", async () => {
      calls++;
      if (fail) return { ok: false, status: 500, headers: { get: () => null }, json: async () => ({}) };
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => (calls % 2 === 0 ? { total_commits: 0, commits: [], html_url: "u" } : []) };
    });
    expect(await rpc("update_changes", range)).toMatchObject({ kind: "unavailable" });
    fail = false;
    expect(await rpc("update_changes", range)).toMatchObject({ kind: "github", subdirectory: "plugins/alpha" });
    const asked = calls;
    expect(await rpc("update_changes", range)).toMatchObject({ kind: "github" });
    expect(calls).toBe(asked);
    vi.unstubAllGlobals();
    service.controller.abort();
  });

  describe("GitHub's hourly limit", () => {
    const sha = (c: string) => c.repeat(40);
    const range = (n: number) => ({
      pluginId: `p${n}`,
      from: { version: sha("a"), display: "https://github.com/acme/x.git@HEAD (a)" },
      to: { version: sha(String(n)), display: "https://github.com/acme/x.git@HEAD (b)" },
    });
    /** GitHub, saying `remaining` requests are left and who asked. */
    function stubGitHub(remaining: () => number) {
      const auth: (string | null)[] = [];
      vi.stubGlobal("fetch", async (_url: string, init?: { headers?: Record<string, string> }) => {
        auth.push(init?.headers?.Authorization ?? null);
        const headers: Record<string, string> = { "x-ratelimit-remaining": String(remaining()), "x-ratelimit-limit": "60" };
        return { ok: true, status: 200, headers: { get: (n: string) => headers[n] ?? null }, json: async () => ({ total_commits: 0, commits: [], html_url: "u" }) };
      });
      return auth;
    }
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    });

    it("stops fetching on its own when few requests are left, and fetches when asked", async () => {
      const { rpc, service } = await host();
      const auth = stubGitHub(() => 5);
      expect(await rpc("update_changes", range(1))).toMatchObject({ kind: "github" });
      expect(await rpc("update_changes", range(2))).toMatchObject({ kind: "deferred", remaining: 5 });
      expect(auth).toHaveLength(1);
      expect(await rpc("update_changes", { ...range(2), force: true })).toMatchObject({ kind: "github" });
      expect(auth).toHaveLength(2);
      service.controller.abort();
    });

    it("uses the machine's GitHub login when allowed, and only then", async () => {
      vi.stubEnv("GH_TOKEN", "gho_test");
      const withLogin = await host(undefined, true);
      const auth = stubGitHub(() => 4000);
      await withLogin.rpc("update_changes", range(1));
      expect(auth).toEqual(["Bearer gho_test"]);
      withLogin.service.controller.abort();

      const without = await host(undefined, false);
      await without.rpc("update_changes", range(2));
      expect(auth).toEqual(["Bearer gho_test", null]);
      without.service.controller.abort();
    });

    it("doesn't hold a nearly spent limit without a login against requests with one", async () => {
      const { rpc, harness, service } = await host();
      let left = 3;
      stubGitHub(() => left);
      await rpc("update_changes", range(1));
      // A login appears: its own limit is a different, fresh one.
      vi.stubEnv("GH_TOKEN", "gho_test");
      await harness.setSettings({ useGitHubLogin: true });
      left = 4900;
      expect(await rpc("update_changes", range(2))).toMatchObject({ kind: "github" });
      service.controller.abort();
    });
  });

  it("takes a queued update off the queue, restoring a snooze it replaced", async () => {
    const { rpc, decide, cards, queue, service } = await host();
    await decide("alpha", "snooze");
    await decide("alpha", "queue");
    expect((await queue()).jobs.map((j) => j.pluginId)).toEqual(["alpha"]);
    expect(await rpc("unqueue", { key: "update:alpha" })).toEqual({ removed: true, reason: null });
    expect((await queue()).jobs).toEqual([]);
    // Back to snoozed, not back in the deck.
    expect(await cards()).toEqual(["beta", SELF]);
    service.controller.abort();
  });
});
