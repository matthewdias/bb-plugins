// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CleanupPanel, reasonText, resetCosts } from "../../ui/CleanupPanel";
import { cleanupActions, decideCleanup, resetCleanupDecisions, undoLastCleanup } from "../../ui/cleanup-decisions";
import { resetTriageStore, triageStore, type TriageRpc } from "../../ui/triage-store";
import type { CleanupCard } from "../../lib/cleanup-deck";
import type { RemoveJob } from "../../lib/queue";
import type { RemovalCost } from "../../lib/removal-cost";

vi.mock("@get-bb/plugin-sdk/app", () => ({ experimental_Icon: () => null }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
vi.mock("../../ui/haptics", () => ({ haptic: vi.fn() }));

function card(pluginId: string, overrides: Partial<CleanupCard> = {}): CleanupCard {
  return {
    key: `remove:${pluginId}`,
    pluginId,
    displayName: pluginId,
    description: null,
    icon: null,
    iconUrl: null,
    enabled: true,
    source: "x",
    surfaces: [],
    reason: { kind: "broken", status: "error", detail: "boom" },
    ...overrides,
  };
}

let cost: RemovalCost | Error = { settings: ["Mode", "Theme"], secrets: ["API key"], scheduled: true };

function rpcFake() {
  const call = vi.fn(async (method: string, _input?: unknown) => {
    if (method === "cleanup_cost") {
      if (cost instanceof Error) throw cost;
      return cost;
    }
    if (method === "cleanup_decide") return { previous: null };
    if (method === "cleanup_undo") return { undone: true, reason: null };
    if (method === "deck_new" || method === "deck_saved") return { cards: [] };
    if (method === "updates_deck") return { cards: [], unavailable: [], history: [] };
    if (method === "cleanup_deck") return triageStore.getSnapshot().cleanup;
    if (method === "queue_status") return { jobs: [], running: false };
    return {};
  });
  return { rpc: { call } as unknown as TriageRpc, call };
}

afterEach(() => {
  resetCosts();
  cost = { settings: ["Mode", "Theme"], secrets: ["API key"], scheduled: true };
  resetCleanupDecisions();
  resetTriageStore();
});

describe("the Cleanup tab", () => {
  it("offers keep, uninstall and try-without for a plugin that is on", () => {
    const { rpc } = rpcFake();
    render(<CleanupPanel rpc={rpc} cleanup={{ cards: [card("broken")], history: [] }} keyboard />);
    expect(screen.getByRole("button", { name: "Keep it (→)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Uninstall (←)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try without it for two weeks (↑)" })).toBeTruthy();
    expect(screen.getByText("Not working (error)")).toBeTruthy();
  });

  it("offers keep-off and turn-on for a plugin that is off", () => {
    const { actions, labels } = cleanupActions(card("off", { enabled: false, reason: { kind: "disabled", since: null } }));
    expect(actions).toEqual({ right: "keep", left: "remove", up: "enable" });
    expect(labels.up.name).toBe("Turn it back on");
  });

  it("asks whether a plugin tried without was missed", () => {
    const trial = card("tried", { enabled: false, reason: { kind: "trial", since: Date.now() } });
    expect(cleanupActions(trial).actions).toEqual({ right: "enable", left: "remove", up: "trial" });
    expect(reasonText(trial.reason).title).toBe("Did you miss it?");
  });

  it("says plainly when a plugin was already off before watching", () => {
    expect(reasonText({ kind: "disabled", since: null }).detail).toBe("Since before Plugin Triage was watching.");
  });

  it("says what uninstalling the top card would delete, before it is queued", async () => {
    const { rpc, call } = rpcFake();
    render(<CleanupPanel rpc={rpc} cleanup={{ cards: [card("notes")], history: [] }} keyboard />);
    expect(await screen.findByText(
      "Uninstalling deletes its 2 changed settings (Mode and Theme), its secret API key and its scheduled work, for good.",
    )).toBeTruthy();
    expect(call).toHaveBeenCalledWith("cleanup_cost", { pluginId: "notes" });
  });

  it("still warns when bb couldn't say what would be lost", async () => {
    cost = new Error("nope");
    const { rpc } = rpcFake();
    render(<CleanupPanel rpc={rpc} cleanup={{ cards: [card("notes")], history: [] }} keyboard />);
    expect(await screen.findByText("Uninstalling deletes its settings, secrets and schedules, for good.")).toBeTruthy();
  });

  it("lists recent removals, failures with why, and offers no restore", () => {
    const { rpc } = rpcFake();
    const history = [
      { id: "1", kind: "remove", pluginId: "a", displayName: "Alpha", state: "done", finishedAt: Date.now(), error: null },
      { id: "2", kind: "remove", pluginId: "b", displayName: "Beta", state: "failed", finishedAt: Date.now(), error: "in use" },
    ] as RemoveJob[];
    render(<CleanupPanel rpc={rpc} cleanup={{ cards: [], history }} keyboard />);
    expect(screen.getByText("Removed")).toBeTruthy();
    expect(screen.getByText("Couldn't remove: in use")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Restore/ })).toBeNull();
  });

  it("decides by direction for the card's kind, and undoes with the action taken", async () => {
    const { rpc, call } = rpcFake();
    const off = card("off", { enabled: false, reason: { kind: "disabled", since: null } });
    triageStore.putBackCleanup(off);
    await decideCleanup(rpc, off, "up");
    expect(call).toHaveBeenCalledWith("cleanup_decide", { pluginId: "off", displayName: "off", action: "enable" });
    expect(triageStore.getSnapshot().cleanup.cards).toEqual([]);
    await undoLastCleanup(rpc);
    expect(call).toHaveBeenCalledWith("cleanup_undo", { pluginId: "off", action: "enable", restore: null });
    expect(triageStore.getSnapshot().cleanup.cards.map((c) => c.pluginId)).toEqual(["off"]);
  });
});
