// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetTriageStore, triageStore, type TriageRpc } from "../../ui/triage-store";

let settings: Record<string, boolean> | undefined;
vi.mock("@get-bb/plugin-sdk/app", () => ({ useSettings: () => ({ values: settings, isLoading: false }) }));

const { TriageSidebarCount, TriageSidebarPanel } = await import("../../ui/TriageSidebar");

const rpc = {
  call: vi.fn(async (method: string) => {
    if (method === "deck_new") return { cards: [{ key: "a" }, { key: "b" }] };
    if (method === "deck_saved") return { cards: [] };
    if (method === "updates_deck") return { cards: [{ key: "u" }], unavailable: [], history: [] };
    if (method === "cleanup_deck") return { cards: [{ key: "c" }, { key: "d" }, { key: "e" }], history: [] };
    if (method === "queue_status") return { jobs: [], running: false };
    return {};
  }),
} as unknown as TriageRpc;

afterEach(() => {
  resetTriageStore();
  settings = undefined;
});

describe("the Triage sidebar item", () => {
  it("shows nothing until the decks load, then new plugins and updates", async () => {
    render(<TriageSidebarCount />);
    expect(screen.queryByLabelText(/waiting in Triage/)).toBeNull();
    await act(() => triageStore.load(rpc));
    expect(screen.getByLabelText("3 waiting in Triage").textContent).toBe("3");
  });

  it("counts the decks the settings choose, and hides at zero", async () => {
    settings = { countNew: false, countUpdates: false, countCleanup: true };
    const { rerender } = render(<TriageSidebarCount />);
    await act(() => triageStore.load(rpc));
    expect(screen.getByLabelText("3 waiting in Triage")).toBeTruthy();
    settings = { countNew: false, countUpdates: false, countCleanup: false };
    rerender(<TriageSidebarCount />);
    expect(screen.queryByLabelText(/waiting in Triage/)).toBeNull();
  });

  it("hands over to the Triage tab without leaving a step for Back", () => {
    window.history.replaceState({}, "", "/");
    window.history.pushState({}, "", "/plugins/plugin-triage/triage");
    const before = window.history.length;
    const heard = vi.fn();
    window.addEventListener("popstate", heard);
    render(<TriageSidebarPanel />);
    window.removeEventListener("popstate", heard);
    expect(window.location.pathname + window.location.search).toBe("/plugins?view=triage");
    expect(window.history.length).toBe(before);
    expect(heard).toHaveBeenCalledTimes(1);
  });
});
