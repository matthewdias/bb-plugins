import { describe, expect, it } from "vitest";
import { IDLE_MS, KEEP_MS, TRIAL_MS, buildCleanupDeck, hasUsageSignal, isProtected, type Installed } from "../lib/cleanup-deck";
import type { Job } from "../lib/queue";

const NOW = 10_000_000_000;
const SELF = "plugin-triage";

function plugin(id: string, overrides: Partial<Installed> = {}): Installed {
  return {
    id,
    name: id,
    description: null,
    icon: null,
    iconUrl: null,
    enabled: true,
    status: "running",
    statusDetail: null,
    source: `git:https://github.com/acme/${id}.git`,
    providerIds: [],
    capabilities: [{ kind: "agent-tool", label: "t" }],
    ...overrides,
  };
}

const watched = (since: number, lastActiveAt: number | null = null, extra = {}) => ({
  firstSeenAt: since,
  lastCount: 0,
  lastActiveAt,
  disabledSince: null,
  disabledBeforeWatching: false,
  ...extra,
});

function deck(plugins: Installed[], extra: Partial<Parameters<typeof buildCleanupDeck>[0]> = {}) {
  return buildCleanupDeck({ plugins, observations: {}, decisions: {}, jobs: [], now: NOW, selfId: SELF, ...extra });
}

describe("the Cleanup deck", () => {
  it("deals broken, then turned-off, then idle plugins", () => {
    const cards = deck(
      [plugin("idle"), plugin("off", { enabled: false }), plugin("broken", { status: "error", statusDetail: "boom" }), plugin("fine")],
      { observations: { idle: watched(NOW - IDLE_MS - 1), off: watched(NOW - 1000, null, { disabledSince: NOW - 500 }), fine: watched(NOW - IDLE_MS - 1, NOW - 1000) } },
    );
    expect(cards.map((c) => [c.pluginId, c.reason.kind])).toEqual([
      ["broken", "broken"],
      ["off", "disabled"],
      ["idle", "idle"],
    ]);
    expect(cards[0]!.reason).toEqual({ kind: "broken", status: "error", detail: "boom" });
    expect(cards[1]!.reason).toEqual({ kind: "disabled", since: NOW - 500 });
  });

  it("says when a plugin was already off before watching began", () => {
    const [card] = deck([plugin("off", { enabled: false })], {
      observations: { off: watched(NOW, null, { disabledSince: NOW, disabledBeforeWatching: true }) },
    });
    expect(card!.reason).toEqual({ kind: "disabled", since: null });
  });

  it("calls nothing idle until it has been watched a month", () => {
    expect(deck([plugin("new")], { observations: { new: watched(NOW - IDLE_MS + 1000) } })).toEqual([]);
  });

  it("never calls a plugin with no usage signal idle", () => {
    const uiOnly = plugin("ui", { capabilities: [] });
    expect(hasUsageSignal(uiOnly)).toBe(false);
    expect(deck([uiOnly], { observations: { ui: watched(NOW - IDLE_MS * 3) } })).toEqual([]);
  });

  it("never deals itself, local folders, providers, environments or bb's navigation", () => {
    const off = { enabled: false };
    const protectedOnes = [
      plugin(SELF, off),
      plugin("linked", { ...off, source: "path:/work/linked" }),
      plugin("provider-x", { ...off, providerIds: ["x"] }),
      plugin("environment-git-worktree", off),
      plugin("navigation", off),
    ];
    expect(protectedOnes.every((p) => isProtected(p, SELF))).toBe(true);
    expect(deck(protectedOnes)).toEqual([]);
  });

  it("puts a kept card away for ninety days", () => {
    const off = [plugin("off", { enabled: false })];
    const decisions = { off: { action: "keep" as const, at: NOW, until: NOW + KEEP_MS } };
    expect(deck(off, { decisions })).toEqual([]);
    expect(deck(off, { decisions, now: NOW + KEEP_MS })).toHaveLength(1);
  });

  it("asks again once a plugin has been tried without for two weeks", () => {
    const off = [plugin("tried", { enabled: false })];
    const decisions = { tried: { action: "trial" as const, at: NOW, until: NOW + TRIAL_MS } };
    expect(deck(off, { decisions, now: NOW + TRIAL_MS - 1 })).toEqual([]);
    expect(deck(off, { decisions, now: NOW + TRIAL_MS })[0]!.reason).toEqual({ kind: "trial", since: NOW });
  });

  it("forgets a trial once the plugin has been turned back on by hand", () => {
    const decisions = { back: { action: "trial" as const, at: NOW, until: NOW + TRIAL_MS } };
    expect(deck([plugin("back")], { decisions, now: NOW + TRIAL_MS * 2 })).toEqual([]);
  });

  it("leaves out a plugin queued for removal", () => {
    const job = { kind: "remove", key: "remove:off", state: "pending", held: true } as Job;
    expect(deck([plugin("off", { enabled: false })], { jobs: [job] })).toEqual([]);
  });

  it("names what a plugin adds", () => {
    const [card] = deck([
      plugin("busy", {
        enabled: false,
        capabilities: [
          { kind: "agent-tool", label: "a" },
          { kind: "agent-tool", label: "b" },
          { kind: "skill", label: "s" },
        ],
        cliCommand: { name: "busy" },
      }),
    ]);
    expect(card!.surfaces).toEqual(["2 agent tools", "a skill", "bb busy"]);
  });

  it("leaves out bb's own plugins that are simply off, but not broken ones", () => {
    const cards = deck([
      plugin("docs", { enabled: false, source: "builtin:docs", provenance: "builtin" }),
      plugin("tasks", { status: "error", source: "builtin:tasks", provenance: "builtin" }),
    ]);
    expect(cards.map((c) => [c.pluginId, c.reason.kind])).toEqual([["tasks", "broken"]]);
  });
});
