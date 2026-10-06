// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { CleanupPanel, reasonText } from "../../ui/CleanupPanel";
import { cleanupActions, decideCleanup, resetCleanupDecisions, undoLastCleanup } from "../../ui/cleanup-decisions";
import { resetTriageStore, triageStore, type TriageRpc } from "../../ui/triage-store";
import type { CleanupCard } from "../../lib/cleanup-deck";
import type { GraveyardEntry } from "../../lib/graveyard";

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

const grave: GraveyardEntry = {
  id: "g1",
  pluginId: "notes",
  displayName: "Notes",
  icon: null,
  iconUrl: null,
  removedAt: Date.now(),
  source: "git:x",
  subdirectory: null,
  settings: { mode: "b" },
  secrets: ["Token"],
};

function rpcFake() {
  const call = vi.fn(async (method: string, _input?: unknown) => {
    if (method === "graveyard_restore") return { pluginId: "notes", secrets: ["Token"] };
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
  resetCleanupDecisions();
  resetTriageStore();
});

describe("the Cleanup tab", () => {
  it("offers keep, uninstall and try-without for a plugin that is on", () => {
    const { rpc } = rpcFake();
    render(<CleanupPanel rpc={rpc} cleanup={{ cards: [card("broken")], graveyard: [] }} keyboard />);
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

  it("restores from the Graveyard, and says which secrets to set again", async () => {
    const { rpc, call } = rpcFake();
    render(<CleanupPanel rpc={rpc} cleanup={{ cards: [], graveyard: [grave] }} keyboard />);
    expect(screen.getByText(/1 setting kept · 1 secret won't come back/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(call).toHaveBeenCalledWith("graveyard_restore", { id: "g1" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Restored Notes", { description: "Set again by hand: Token." }));
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
