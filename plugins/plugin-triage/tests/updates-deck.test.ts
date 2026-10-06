import { describe, expect, it } from "vitest";
import { SNOOZE_MS, buildUpdatesDeck, compareUrl, shortVersion, type UpdateResult } from "../lib/updates-deck";
import type { UpdateJob } from "../lib/queue";

const NOW = 2_000_000;
const SHA1 = "1".repeat(40);
const SHA2 = "2".repeat(40);

function result(id: string, overrides: Partial<UpdateResult> = {}): UpdateResult {
  return {
    id,
    outcome: "update-available",
    installed: { version: "aaa", display: `https://github.com/acme/${id}.git@${id}/v1.0.0 (aaaaaaaaaaaa)` },
    candidate: { version: "bbb", display: `https://github.com/acme/${id}.git@${id}/v1.1.0 (bbbbbbbbbbbb)` },
    ...overrides,
  };
}

const plugin = (id: string, name: string) => ({ id, name, description: `${name} does things.`, icon: null, iconUrl: null, enabled: true });

function deck(results: UpdateResult[], extra: Partial<Parameters<typeof buildUpdatesDeck>[0]> = {}) {
  return buildUpdatesDeck({
    results,
    plugins: [plugin("zeta", "Zeta"), plugin("alpha", "Alpha"), plugin("plugin-triage", "Plugin Triage")],
    decisions: {},
    jobs: [],
    now: NOW,
    selfId: "plugin-triage",
    ...extra,
  });
}

describe("the Updates deck", () => {
  it("holds plugins with an update, alphabetically, this plugin last", () => {
    const { cards } = deck([result("plugin-triage"), result("zeta"), result("alpha"), result("current", { outcome: "current" })]);
    expect(cards.map((card) => card.pluginId)).toEqual(["alpha", "zeta", "plugin-triage"]);
    expect(cards.at(-1)!.isSelf).toBe(true);
  });

  it("shows versions the way a card has room for", () => {
    const [card] = deck([result("alpha")]).cards;
    expect(card!.from.short).toBe("alpha/v1.0.0 (aaaaaaaaaaaa)");
    expect(card!.to.short).toBe("alpha/v1.1.0 (bbbbbbbbbbbb)");
    expect(card!.displayName).toBe("Alpha");
  });

  it("leaves out a queued plugin while its update lives", () => {
    const job = { kind: "update", key: "update:alpha", state: "pending", held: true } as UpdateJob;
    expect(deck([result("alpha")], { jobs: [job] }).cards).toEqual([]);
    expect(deck([result("alpha")], { jobs: [{ ...job, state: "cancelled" }] }).cards).toHaveLength(1);
  });

  it("skips a version until a newer one is offered", () => {
    const decisions = { alpha: { action: "skip" as const, version: "bbb", at: NOW } };
    expect(deck([result("alpha")], { decisions }).cards).toEqual([]);
    const newer = result("alpha", { candidate: { version: "ccc", display: "x@v1.2.0" } });
    expect(deck([newer], { decisions }).cards).toHaveLength(1);
  });

  it("snoozes until the snooze runs out", () => {
    const decisions = { alpha: { action: "snooze" as const, version: "bbb", at: NOW, until: NOW + SNOOZE_MS } };
    expect(deck([result("alpha")], { decisions }).cards).toEqual([]);
    expect(deck([result("alpha")], { decisions, now: NOW + SNOOZE_MS + 1 }).cards).toHaveLength(1);
  });

  it("carries the last failure: this plugin's, or bb's for the version offered", () => {
    const failed = { kind: "update", key: "update:alpha", state: "failed", error: "rolled back", finishedAt: NOW } as UpdateJob;
    expect(deck([result("alpha")], { jobs: [failed] }).cards[0]!.lastFailure).toBe("rolled back");

    const withBbFailure = (version: string) =>
      buildUpdatesDeck({
        results: [result("alpha")],
        plugins: [{ ...plugin("alpha", "Alpha"), updateState: { lastFailure: { at: NOW, detail: "build failed", version } } }],
        decisions: {},
        jobs: [],
        now: NOW,
        selfId: "x",
      }).cards[0]!.lastFailure;
    expect(withBbFailure("bbb")).toBe("build failed");
    expect(withBbFailure("older")).toBeNull();
  });

  it("lists plugins bb couldn't check apart, with why", () => {
    const { cards, unavailable } = deck([result("zeta", { outcome: "unavailable", detail: "ENOENT" })]);
    expect(cards).toEqual([]);
    expect(unavailable).toEqual([{ pluginId: "zeta", displayName: "Zeta", detail: "ENOENT" }]);
  });

  it("keeps a blocked newer release on the card", () => {
    const blocked = { version: "2.0.0", reasons: ["requires bb >=0.46"] };
    expect(deck([result("alpha", { blocked })]).cards[0]!.blocked).toEqual(blocked);
  });
});

describe("version labels and links", () => {
  it("shortens to what follows the source", () => {
    expect(shortVersion({ version: "x", display: "https://github.com/a/b@HEAD (1c4d16625998)" })).toBe("HEAD (1c4d16625998)");
    expect(shortVersion({ version: "x", display: "@scope/pkg@1.2.3" })).toBe("1.2.3");
    expect(shortVersion({ version: "x", display: "builtin:docs" })).toBe("builtin:docs");
  });

  it("compares two commits on GitHub, and nothing else", () => {
    expect(
      compareUrl(
        { version: SHA1, display: "https://github.com/acme/repo.git@v1 (111111111111)" },
        { version: SHA2, display: "https://github.com/acme/repo.git@v2 (222222222222)" },
      ),
    ).toBe(`https://github.com/acme/repo/compare/${SHA1}...${SHA2}`);
    expect(compareUrl({ version: "1.0.0", display: "pkg@1.0.0" }, { version: "1.1.0", display: "pkg@1.1.0" })).toBeNull();
    expect(compareUrl({ version: SHA1, display: "https://gitlab.com/a/b@v1" }, { version: SHA2, display: "https://gitlab.com/a/b@v2" })).toBeNull();
  });
});
