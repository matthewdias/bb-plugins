// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UpdatesPanel } from "../../ui/UpdatesPanel";
import { decideUpdate, resetUpdateDecisions, undoLastUpdate } from "../../ui/update-decisions";
import { resetTriageStore, triageStore, type TriageRpc, type UpdatesState } from "../../ui/triage-store";
import type { UpdateCard } from "../../lib/updates-deck";
import type { UpdateJob } from "../../lib/queue";

const openUrl = vi.fn();
vi.mock("@get-bb/plugin-sdk/app", () => ({ experimental_Icon: () => null, useBbNavigate: () => ({ openUrl }) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), dismiss: vi.fn() }) }));
vi.mock("../../ui/haptics", () => ({ haptic: vi.fn() }));

function card(pluginId: string, overrides: Partial<UpdateCard> = {}): UpdateCard {
  return {
    key: `update:${pluginId}`,
    pluginId,
    displayName: pluginId,
    description: `${pluginId} does things.`,
    icon: null,
    iconUrl: null,
    enabled: true,
    from: { version: "1", display: "x@v1.0.0", short: "v1.0.0" },
    to: { version: "2", display: "x@v1.1.0", short: "v1.1.0" },
    blocked: null,
    lastFailure: null,
    compareUrl: "https://github.com/acme/x/compare/a...b",
    isSelf: false,
    ...overrides,
  };
}

const job = (pluginId: string, overrides: Partial<UpdateJob> = {}) =>
  ({ id: `j-${pluginId}`, kind: "update", key: `update:${pluginId}`, pluginId, displayName: pluginId, state: "pending", held: true, ...overrides }) as UpdateJob;

function state(overrides: Partial<UpdatesState> = {}): UpdatesState {
  return { cards: [], unavailable: [], queued: [], running: false, history: [], ...overrides };
}

function rpcFake() {
  const call = vi.fn(async (method: string, _input?: unknown) => {
    if (method === "updates_start") return { started: 2 };
    if (method === "update_decide") return { previous: null };
    if (method === "update_undo") return { undone: true, reason: null };
    return { checked: 1 };
  });
  return { rpc: { call } as unknown as TriageRpc, call };
}

afterEach(() => {
  resetUpdateDecisions();
  resetTriageStore();
});

describe("the Updates tab", () => {
  it("offers to start a queued batch, and starts it", async () => {
    const { rpc, call } = rpcFake();
    render(<UpdatesPanel rpc={rpc} updates={state({ queued: [job("alpha"), job("beta")] })} keyboard />);
    expect(screen.getByText("2 updates queued")).toBeTruthy();
    expect(screen.getByText("alpha, beta")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Update all" }));
    await waitFor(() => expect(call).toHaveBeenCalledWith("updates_start", {}));
  });

  it("shows progress, not the button, while a batch runs", () => {
    const { rpc } = rpcFake();
    render(
      <UpdatesPanel
        rpc={rpc}
        updates={state({ queued: [job("alpha", { state: "running", held: false }), job("beta", { held: false })], running: true })}
        keyboard
      />,
    );
    expect(screen.getByText("Updating alpha…")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Update all" })).toBeNull();
  });

  it("says when everything is up to date, and checks again on request", async () => {
    const { rpc, call } = rpcFake();
    render(<UpdatesPanel rpc={rpc} updates={state()} keyboard />);
    expect(screen.getByText("Everything's up to date")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Check now" }));
    await waitFor(() => expect(call).toHaveBeenCalledWith("updates_check", {}));
  });

  it("lists plugins bb couldn't check, each with a retry", async () => {
    const { rpc, call } = rpcFake();
    render(<UpdatesPanel rpc={rpc} updates={state({ unavailable: [{ pluginId: "icons", displayName: "Icons", detail: "ENOENT" }] })} keyboard />);
    expect(screen.getByText("ENOENT")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(call).toHaveBeenCalledWith("updates_check", { pluginId: "icons" }));
  });

  it("reports recent results, failures with why", () => {
    const { rpc } = rpcFake();
    render(
      <UpdatesPanel
        rpc={rpc}
        updates={state({
          history: [
            job("alpha", { state: "done", result: "updated", to: { version: "2", display: "x@v1.1.0" }, finishedAt: Date.now() }),
            job("beta", { state: "failed", error: "bb rolled it back: boom", finishedAt: Date.now() }),
          ],
        })}
        keyboard
      />,
    );
    expect(screen.getByText("Updated to v1.1.0")).toBeTruthy();
    expect(screen.getByText("bb rolled it back: boom")).toBeTruthy();
  });

  it("opens the commits between the versions, and can't when there is no range", () => {
    const { rpc } = rpcFake();
    const view = render(<UpdatesPanel rpc={rpc} updates={state({ cards: [card("alpha")] })} keyboard />);
    fireEvent.click(screen.getByRole("button", { name: /Changes/ }));
    expect(openUrl).toHaveBeenCalledWith("https://github.com/acme/x/compare/a...b");
    view.unmount();
    render(<UpdatesPanel rpc={rpc} updates={state({ cards: [card("beta", { compareUrl: null })] })} keyboard />);
    expect((screen.getByRole("button", { name: /Changes/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("names its decisions for updates", () => {
    const { rpc } = rpcFake();
    render(<UpdatesPanel rpc={rpc} updates={state({ cards: [card("alpha")] })} keyboard />);
    expect(screen.getByRole("button", { name: "Queue the update (→)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Skip this version (←)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remind me in a week (↑)" })).toBeTruthy();
    // Update cards have no details to open.
    expect(screen.getByText(/skip version/).textContent).not.toMatch(/space details/);
  });
});

describe("update decisions", () => {
  it("queue, skip and snooze by direction, and undo puts the card back", async () => {
    const { rpc, call } = rpcFake();
    triageStore.putBackUpdate(card("alpha"));
    await decideUpdate(rpc, card("alpha"), "right");
    await decideUpdate(rpc, card("beta"), "left");
    await decideUpdate(rpc, card("gamma"), "up");
    const actions = call.mock.calls.filter(([m]) => m === "update_decide").map(([, input]) => (input as { action: string }).action);
    expect(actions).toEqual(["queue", "skip", "snooze"]);
    expect(triageStore.getSnapshot().updates.cards).toEqual([]);
    await undoLastUpdate(rpc);
    expect(call).toHaveBeenLastCalledWith("update_undo", { pluginId: "gamma", restore: null });
    expect(triageStore.getSnapshot().updates.cards.map((c) => c.pluginId)).toEqual(["gamma"]);
  });
});
