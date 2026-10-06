// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueueBar, queueSummary } from "../../ui/QueueBar";
import { resetTriageStore, type TriageRpc } from "../../ui/triage-store";
import type { Job } from "../../lib/queue";

vi.mock("@get-bb/plugin-sdk/app", () => ({ experimental_Icon: () => null }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
vi.mock("../../ui/haptics", () => ({ haptic: vi.fn() }));

const install = (name: string, overrides: Partial<Job> = {}) =>
  ({ id: `i-${name}`, kind: "install", key: `${name}@bb-community`, displayName: name, state: "pending", held: true, ...overrides }) as Job;
const update = (name: string, overrides: Partial<Job> = {}) =>
  ({ id: `u-${name}`, kind: "update", key: `update:${name}`, pluginId: name, displayName: name, state: "pending", held: true, ...overrides }) as Job;

function rpcFake(unqueue: unknown = { removed: true, reason: null }) {
  const call = vi.fn(async (method: string, _input?: unknown) => {
    if (method === "queue_start") return { started: 3 };
    if (method === "unqueue") return unqueue;
    if (method === "deck_new" || method === "deck_saved") return { cards: [] };
    if (method === "updates_deck") return { cards: [], unavailable: [], history: [] };
    if (method === "queue_status") return { jobs: [], running: false };
    if (method === "cleanup_deck") return { cards: [], graveyard: [] };
    return {};
  });
  return { rpc: { call } as unknown as TriageRpc, call };
}

afterEach(() => resetTriageStore());

describe("the queue bar", () => {
  it("is not there when nothing is queued", () => {
    const { rpc } = rpcFake();
    const { container } = render(<QueueBar rpc={rpc} queue={{ jobs: [], running: false }} />);
    expect(container.textContent).toBe("");
  });

  it("sums up installs and updates together, and runs them all", async () => {
    const { rpc, call } = rpcFake();
    render(<QueueBar rpc={rpc} queue={{ jobs: [install("alpha"), install("beta"), update("gamma")], running: false }} />);
    expect(screen.getByText("2 to install, 1 to update")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Run all" }));
    await waitFor(() => expect(call).toHaveBeenCalledWith("queue_start", {}));
  });

  it("shows progress, not the button, while the queue runs", () => {
    const { rpc } = rpcFake();
    render(
      <QueueBar
        rpc={rpc}
        queue={{ jobs: [install("alpha", { state: "running", held: false }), update("gamma", { held: false })], running: true }}
      />,
    );
    expect(screen.getByText("Installing alpha…")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Run all" })).toBeNull();
  });

  it("lists what is queued for review, and takes one off", async () => {
    const { rpc, call } = rpcFake();
    render(<QueueBar rpc={rpc} queue={{ jobs: [install("alpha"), update("gamma")], running: false }} />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    fireEvent.click(screen.getByRole("button", { name: "Take gamma off the queue" }));
    await waitFor(() => expect(call).toHaveBeenCalledWith("unqueue", { key: "update:gamma" }));
    // And the page catches up with what the server now holds.
    await waitFor(() => expect(call).toHaveBeenCalledWith("queue_status", {}));
  });

  it("can't take off what is already running", () => {
    const { rpc } = rpcFake();
    render(<QueueBar rpc={rpc} queue={{ jobs: [install("alpha", { state: "running", held: false })], running: true }} />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect((screen.getByRole("button", { name: "Take alpha off the queue" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("names the kinds it holds", () => {
    expect(queueSummary([install("a")])).toBe("1 to install");
    expect(queueSummary([update("a"), update("b")])).toBe("2 to update");
    const remove = { id: "r", kind: "remove", key: "remove:x", pluginId: "x", displayName: "x", state: "pending", held: true } as Job;
    expect(queueSummary([install("a"), remove])).toBe("1 to install, 1 to remove");
  });
});
