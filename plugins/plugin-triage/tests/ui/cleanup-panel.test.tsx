// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InstalledPanel, reasonText, resetCosts } from "../../ui/InstalledPanel";
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
    suggested: true,
    protected: false,
    removalPending: false,
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

describe("the Installed tab", () => {
  it("shows all installed plugins and filters by enabled status", async () => {
    const { rpc } = rpcFake();
    const enabled = card("enabled", { reason: { kind: "enabled" }, suggested: false });
    const disabled = card("disabled", { enabled: false, reason: { kind: "disabled", since: null } });
    const protectedPlugin = card("built-in", { enabled: false, protected: true, suggested: false });
    const queued = card("queued", { removalPending: true, suggested: false });
    render(<InstalledPanel rpc={rpc} installed={{ cards: [enabled, disabled, protectedPlugin, queued], history: [] }} keyboard />);

    expect(screen.getByRole("button", { name: "All", pressed: true })).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    expect(within(screen.getByRole("listitem", { name: "queued" })).getByText("Queued to uninstall")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Disabled" }));
    expect(screen.getByText("2 disabled plugins")).toBeTruthy();
    expect(screen.queryByRole("listitem", { name: "enabled" })).toBeNull();
    const builtIn = screen.getByRole("listitem", { name: "built-in" });
    expect(within(builtIn).queryByRole("button", { name: "Queue uninstall" })).toBeNull();
    expect(within(screen.getByRole("listitem", { name: "disabled" })).getByRole("button", { name: "Turn on" })).toBeTruthy();
    fireEvent.click(within(builtIn).getByRole("button", { name: "Preview built-in" }));
    expect(within(screen.getByRole("dialog")).queryByRole("toolbar")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    fireEvent.mouseEnter(screen.getByRole("listitem", { name: "disabled" }));
    await screen.findByText(/Uninstalling deletes/);
  });

  it("puts the immediate turn-off action in the preview and leaves up for review", async () => {
    const { rpc, call } = rpcFake();
    render(<InstalledPanel rpc={rpc} installed={{ cards: [card("broken")], history: [] }} keyboard />);
    expect(screen.getByRole("button", { name: "Review later" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try without it" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Preview broken" }));
    const preview = screen.getByRole("dialog");
    expect(within(preview).getByText("Turn off now and review in two weeks.")).toBeTruthy();
    fireEvent.click(within(preview).getByRole("button", { name: "Try without it" }));
    expect(call).toHaveBeenCalledWith("cleanup_decide", expect.objectContaining({ action: "trial" }));
    await within(preview).findByTestId("removal-cost");
  });

  it("sets aside on up and re-enables on right when a plugin is off", () => {
    const actions = cleanupActions(card("off", { enabled: false, reason: { kind: "disabled", since: null } }));
    expect(actions.up).toMatchObject({ action: "keep", label: "Review later" });
    expect(actions.right).toMatchObject({ action: "enable", label: "Turn on" });
    expect(actions.left).toMatchObject({ action: "remove", label: "Queue uninstall" });
  });

  it("extends a due trial on up and still re-enables on right", () => {
    const trial = card("tried", { enabled: false, reason: { kind: "trial", since: Date.now() } });
    expect(cleanupActions(trial).up).toMatchObject({ action: "extend", label: "2 more weeks" });
    expect(cleanupActions(trial).right).toMatchObject({ action: "enable", label: "Turn on" });
    expect(reasonText(trial.reason).title).toBe("Did you miss it?");
  });

  it("says plainly when a plugin was already off before watching", () => {
    expect(reasonText({ kind: "disabled", since: null }).detail).toBe("Since before Plugin Triage was watching.");
  });

  it("shows what uninstalling a card would delete when reviewed", async () => {
    const { rpc, call } = rpcFake();
    render(<InstalledPanel rpc={rpc} installed={{ cards: [card("notes")], history: [] }} keyboard />);
    fireEvent.mouseEnter(screen.getByRole("listitem", { name: "notes" }));
    expect(await screen.findByText(
      "Uninstalling deletes its 2 changed settings (Mode and Theme), its secret API key and its scheduled work, for good.",
    )).toBeTruthy();
    expect(call).toHaveBeenCalledWith("cleanup_cost", { pluginId: "notes" });
  });

  it("still warns when bb couldn't say what would be lost", async () => {
    cost = new Error("nope");
    const { rpc } = rpcFake();
    render(<InstalledPanel rpc={rpc} installed={{ cards: [card("notes")], history: [] }} keyboard />);
    fireEvent.mouseEnter(screen.getByRole("listitem", { name: "notes" }));
    expect(await screen.findByText("Uninstalling deletes its settings, secrets and schedules, for good.")).toBeTruthy();
  });

  it("lists recent removals, failures with why, and offers no restore", () => {
    const { rpc } = rpcFake();
    const history = [
      { id: "1", kind: "remove", pluginId: "a", displayName: "Alpha", state: "done", finishedAt: Date.now(), error: null },
      { id: "2", kind: "remove", pluginId: "b", displayName: "Beta", state: "failed", finishedAt: Date.now(), error: "in use" },
    ] as RemoveJob[];
    render(<InstalledPanel rpc={rpc} installed={{ cards: [], history }} keyboard />);
    expect(screen.getByText("Removed")).toBeTruthy();
    expect(screen.getByText("Couldn't remove: in use")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Restore/ })).toBeNull();
  });

  it("decides by direction for the card's kind, and undoes with the action taken", async () => {
    const { rpc, call } = rpcFake();
    const off = card("off", { enabled: false, reason: { kind: "disabled", since: null } });
    triageStore.putBackCleanup(off);
    await decideCleanup(rpc, off, "enable");
    expect(call).toHaveBeenCalledWith("cleanup_decide", { pluginId: "off", displayName: "off", action: "enable" });
    expect(triageStore.getSnapshot().cleanup.cards).toHaveLength(1);
    await undoLastCleanup(rpc);
    expect(call).toHaveBeenCalledWith("cleanup_undo", { pluginId: "off", action: "enable", restore: null });
    expect(triageStore.getSnapshot().cleanup.cards.map((c) => c.pluginId)).toEqual(["off"]);
  });
});
