// The server entry, run whole against the SDK's fake host: decisions, the
// install queue's grace period, undo, and a failure putting the card back.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";
import { GRACE_MS, type Job } from "../lib/queue";
import type { NewCard } from "../lib/new-deck";
import { NOW, entry } from "./fixtures";

type Rpc = <T>(method: string, input: unknown) => Promise<T>;

const sourceOf = (entryId: string) => ({ kind: "git", url: `https://github.com/someone/${entryId}.git`, range: "^0.1.0" });

async function host(options: { install?: (args: { entryId: string }) => unknown } = {}) {
  const catalog = [entry({ entryId: "alpha" }), entry({ entryId: "beta" })];
  const { bb, harness } = createFakePluginHost({ pluginId: "plugin-triage" });
  harness.sdk.stub("plugins.catalog.search", () => ({ collections: [], results: catalog }));
  harness.sdk.stub("plugins.catalog.installPlan", (args: { entryId: string; marketplace: string }) => ({
    kind: "marketplace",
    entryId: args.entryId,
    pluginId: args.entryId,
    displayName: args.entryId,
    marketplace: args.marketplace,
    marketplaceDisplayName: "BB Community",
    official: true,
    author: { name: "someone", github: null, url: null },
    source: "git:…",
    resolvedSource: { kind: "git", url: `https://github.com/someone/${args.entryId}.git`, range: "^0.1.0" },
    compatible: true,
    incompatibleReason: null,
  }));
  harness.sdk.stub(
    "plugins.catalog.install",
    options.install ?? ((args: { entryId: string }) => ({ id: args.entryId })),
  );
  await plugin(bb);
  const service = harness.runService("queue");
  const rpc: Rpc = async (method, input) => (await harness.callRpc(method, input)) as never;
  const deck = async () => (await rpc<{ cards: NewCard[] }>("deck_new", {})).cards.map((card) => card.entryId);
  const jobs = async () => (await rpc<{ jobs: Job[] }>("jobs_list", {})).jobs;
  const decide = (entryId: string, action: "install" | "dismiss" | "save") =>
    rpc<{ job: Job | null }>("decide", {
      key: `${entryId}@bb-community`,
      entryId,
      marketplace: "bb-community",
      pluginId: entryId,
      displayName: entryId,
      action,
      // What the card showed, as the page always sends with an install.
      ...(action === "install" ? { confirmedSource: sourceOf(entryId) } : {}),
    });
  /** Lets the runner wake, take a job and finish it. */
  const advance = async (ms: number) => {
    await vi.advanceTimersByTimeAsync(ms);
    for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(0);
  };
  return { bb, harness, service, rpc, deck, jobs, decide, advance };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the New deck over RPC", () => {
  it("serves undecided entries and drops a decided one", async () => {
    const { deck, decide, service } = await host();
    expect(await deck()).toEqual(["alpha", "beta"]);
    await decide("alpha", "dismiss");
    expect(await deck()).toEqual(["beta"]);
    service.controller.abort();
  });

  it("fixes the cutoff on the first visit and keeps it", async () => {
    const { rpc, service } = await host();
    const first = await rpc<{ cutoff: number }>("deck_new", {});
    vi.setSystemTime(NOW + 10 * 24 * 60 * 60 * 1000);
    const later = await rpc<{ cutoff: number }>("deck_new", {});
    expect(later.cutoff).toBe(first.cutoff);
    service.controller.abort();
  });

  it("lists saved entries", async () => {
    const { rpc, decide, service } = await host();
    await decide("beta", "save");
    const saved = await rpc<{ cards: NewCard[] }>("deck_saved", {});
    expect(saved.cards.map((card) => card.entryId)).toEqual(["beta"]);
    service.controller.abort();
  });

  it("summarizes the source an install would use", async () => {
    const { rpc, service } = await host();
    const plan = await rpc<{ summary: { label: string }; confirmedSource: unknown }>("entry_plan", {
      entryId: "alpha",
      marketplace: "bb-community",
    });
    expect(plan.summary.label).toBe("github.com/someone/alpha @ ^0.1.0");
    expect(plan.confirmedSource).toMatchObject({ kind: "git", range: "^0.1.0" });
    service.controller.abort();
  });
});

describe("installing", () => {
  it("waits out the grace period, then installs in the background", async () => {
    const { harness, decide, jobs, advance, service } = await host();
    const { job } = await decide("alpha", "install");
    expect(job).toMatchObject({ state: "pending", runAfter: NOW + GRACE_MS });

    await advance(GRACE_MS - 100);
    expect(harness.sdk.callsTo("plugins.catalog.install")).toHaveLength(0);

    await advance(200);
    expect(harness.sdk.callsTo("plugins.catalog.install")).toEqual([
      [{ entryId: "alpha", marketplace: "bb-community", confirmedSource: sourceOf("alpha") }],
    ]);
    expect((await jobs())[0]).toMatchObject({ state: "done", pluginId: "alpha" });
    service.controller.abort();
  });

  it("sends the confirmed source back with the install", async () => {
    const { harness, rpc, advance, service } = await host();
    const confirmedSource = { kind: "git", url: "https://github.com/someone/alpha.git", range: "^0.1.0" };
    await rpc("decide", {
      key: "alpha@bb-community",
      entryId: "alpha",
      marketplace: "bb-community",
      pluginId: "alpha",
      displayName: "alpha",
      action: "install",
      confirmedSource,
    });
    await advance(GRACE_MS);
    expect(harness.sdk.callsTo("plugins.catalog.install")[0]).toEqual([
      { entryId: "alpha", marketplace: "bb-community", confirmedSource },
    ]);
    service.controller.abort();
  });

  it("is undone inside the grace period, and the card comes back", async () => {
    const { harness, rpc, decide, deck, advance, service } = await host();
    await decide("alpha", "install");
    expect(await rpc("undo", { key: "alpha@bb-community" })).toEqual({ undone: true, reason: null });
    await advance(GRACE_MS * 2);
    expect(harness.sdk.callsTo("plugins.catalog.install")).toHaveLength(0);
    expect(await deck()).toEqual(["alpha", "beta"]);
    service.controller.abort();
  });

  it("restores a save that an install replaced, on undo", async () => {
    const { rpc, decide, service } = await host();
    await decide("beta", "save");
    const { previous } = await rpc<{ previous: unknown }>("decide", {
      key: "beta@bb-community",
      entryId: "beta",
      marketplace: "bb-community",
      pluginId: "beta",
      displayName: "beta",
      action: "install",
      confirmedSource: sourceOf("beta"),
    });
    expect(previous).toMatchObject({ action: "save" });
    await rpc("undo", { key: "beta@bb-community", restore: previous });
    const saved = await rpc<{ cards: NewCard[] }>("deck_saved", {});
    expect(saved.cards.map((card) => card.entryId)).toEqual(["beta"]);
    service.controller.abort();
  });

  it("can't be undone once installed", async () => {
    const { rpc, decide, advance, service } = await host();
    await decide("alpha", "install");
    await advance(GRACE_MS);
    const result = await rpc<{ undone: boolean; reason: string }>("undo", { key: "alpha@bb-community" });
    expect(result.undone).toBe(false);
    expect(result.reason).toMatch(/already installed/i);
    service.controller.abort();
  });

  it("puts a failed install's card back, carrying the failure", async () => {
    const { rpc, decide, advance, service } = await host({
      install: () => {
        throw new Error("build failed: missing zod");
      },
    });
    await decide("alpha", "install");
    await advance(GRACE_MS);
    const { cards } = await rpc<{ cards: NewCard[] }>("deck_new", {});
    expect(cards.find((card) => card.entryId === "alpha")?.lastFailure).toBe("build failed: missing zod");
    service.controller.abort();
  });

  it("counts bb's 'already installed' as done", async () => {
    const { decide, jobs, advance, service } = await host({
      install: () => {
        throw new Error('HTTP 422: plugin "alpha" is already installed; use `bb plugin update alpha`');
      },
    });
    await decide("alpha", "install");
    await advance(GRACE_MS);
    expect((await jobs())[0]).toMatchObject({ state: "done", pluginId: "alpha" });
    service.controller.abort();
  });

  it("works through several installs one at a time", async () => {
    let running = 0;
    let most = 0;
    const { decide, jobs, advance, service } = await host({
      install: async (args) => {
        running++;
        most = Math.max(most, running);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        running--;
        return { id: args.entryId };
      },
    });
    await decide("alpha", "install");
    await decide("beta", "install");
    await advance(GRACE_MS + 3000);
    expect(most).toBe(1);
    expect((await jobs()).map((job) => job.state)).toEqual(["done", "done"]);
    service.controller.abort();
  });

  it("resumes a job a reload interrupted, and the old load's late result touches nothing", async () => {
    let land: (value: unknown) => void = () => {};
    const first = await host({ install: () => new Promise((resolve) => (land = resolve)) });
    await first.decide("alpha", "install");
    await first.advance(GRACE_MS);
    expect((await first.jobs())[0]!.state).toBe("running");

    // Same storage, new load. The old run's install then lands: its handle is
    // stale, so it must not try to record that.
    first.service.controller.abort();
    const next = await first.harness.lifecycle.reload(plugin);
    land({ id: "alpha" });
    await first.advance(0);

    next.harness.sdk.stub("plugins.catalog.install", (args: { entryId: string }) => ({ id: args.entryId }));
    const service = next.harness.runService("queue");
    await first.advance(0);
    const { jobs } = (await next.harness.callRpc("jobs_list", {})) as { jobs: Job[] };
    expect(jobs[0]).toMatchObject({ state: "done", error: null });
    expect(next.harness.sdk.callsTo("plugins.catalog.install")).toEqual([
      [{ entryId: "alpha", marketplace: "bb-community", confirmedSource: sourceOf("alpha") }],
    ]);
    service.controller.abort();
  });

  it("refuses an install that arrives without the source its card showed", async () => {
    const { rpc, jobs, deck, service } = await host();
    await expect(
      rpc("decide", {
        key: "alpha@bb-community",
        entryId: "alpha",
        marketplace: "bb-community",
        pluginId: "alpha",
        displayName: "alpha",
        action: "install",
      }),
    ).rejects.toThrow(/missing the source/);
    expect(await jobs()).toEqual([]);
    expect(await deck()).toContain("alpha");
    service.controller.abort();
  });

  it("installs a plugin bundled with bb, which has no listing source, without one", async () => {
    const { rpc, jobs, service } = await host();
    await rpc("decide", {
      key: "docs@bb-official",
      entryId: "docs",
      marketplace: "bb-official",
      pluginId: "docs",
      displayName: "Docs",
      action: "install",
    });
    expect((await jobs())[0]).toMatchObject({ entryId: "docs", state: "pending" });
    service.controller.abort();
  });
});
