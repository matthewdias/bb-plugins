// @vitest-environment jsdom
import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetTriageStore, triageStore, type TriageRpc } from "../../ui/triage-store";

let settings: Record<string, boolean> | undefined;
const toPluginPanel = vi.fn();
vi.mock("@get-bb/plugin-sdk/app", () => ({
  useSettings: () => ({ values: settings, isLoading: false }),
  useBbNavigate: () => ({ toPluginPanel }),
  experimental_Icon: () => null,
}));
vi.mock("../../ui/TriagePage", () => ({
  TriagePage: ({ heading, tab, onTab }: { heading?: boolean; tab: string; onTab: (tab: string) => void }) => (
    <main data-heading={String(heading ?? true)} data-tab={tab}>
      Triage page
      <button type="button" onClick={() => onTab("updates")}>to updates</button>
      <button type="button" onClick={() => onTab("new")}>to new</button>
    </main>
  ),
}));

const { useTriageBadge, TriageSidebarHeader, TriageSidebarPanel } = await import("../../ui/TriageSidebar");

const rpc = {
  call: vi.fn(async (method: string) => {
    if (method === "deck_new") return { cards: [{ key: "a" }, { key: "b" }] };
    if (method === "deck_saved") return { cards: [] };
    if (method === "updates_deck") return { cards: [{ key: "u" }], unavailable: [], history: [] };
    if (method === "cleanup_deck") return { cards: [{ key: "c", suggested: true }, { key: "d", suggested: true }, { key: "e", suggested: true }], history: [] };
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
    const { result } = renderHook(useTriageBadge);
    expect(result.current).toBeNull();
    await act(() => triageStore.load(rpc));
    expect(result.current).toEqual({ count: 3, label: "3 waiting in Triage" });
  });

  it("counts the decks the settings choose, and hides at zero", async () => {
    settings = { countNew: false, countUpdates: false, countCleanup: true };
    const { result, rerender } = renderHook(useTriageBadge);
    await act(() => triageStore.load(rpc));
    expect(result.current).toEqual({ count: 3, label: "3 waiting in Triage" });
    settings = { countNew: false, countUpdates: false, countCleanup: false };
    rerender();
    expect(result.current).toBeNull();
  });

  it("leaves large counts uncapped so bb can format them for a rail or list", async () => {
    const largeRpc = {
      call: async (method: string, input: unknown) => method === "deck_new"
        ? { cards: Array.from({ length: 120 }, (_, i) => ({ key: String(i) })) }
        : rpc.call(method as never, input as never),
    } as unknown as TriageRpc;
    const { result } = renderHook(useTriageBadge);
    await act(() => triageStore.load(largeRpc));
    expect(result.current).toEqual({ count: 121, label: "121 waiting in Triage" });
  });

  it("shows the Triage page itself, with no heading under bb's title bar, and stays put", () => {
    // A redirect into the Plugins screen would loop: bb's Back to app returns here.
    window.history.replaceState({}, "", "/plugins/plugin-triage/triage");
    const heard = vi.fn();
    window.addEventListener("popstate", heard);
    render(<TriageSidebarPanel subPath="" />);
    window.removeEventListener("popstate", heard);
    expect(screen.getByText("Triage page").getAttribute("data-heading")).toBe("false");
    expect(window.location.pathname + window.location.search).toBe("/plugins/plugin-triage/triage");
    expect(heard).not.toHaveBeenCalled();
  });

  it("takes its tab from the path under the item's page, and switches through bb's panel navigation", () => {
    render(<TriageSidebarPanel subPath="cleanup" />);
    expect(screen.getByText("Triage page").getAttribute("data-tab")).toBe("installed");
    screen.getByRole("button", { name: "to updates" }).click();
    expect(toPluginPanel).toHaveBeenLastCalledWith("triage", { subPath: "updates" });
    screen.getByRole("button", { name: "to new" }).click();
    expect(toPluginPanel).toHaveBeenLastCalledWith("triage", { subPath: "" });
  });

  it("links from bb's title bar to Browse plugins", () => {
    window.history.replaceState({}, "", "/plugins/plugin-triage/triage");
    const heard = vi.fn();
    window.addEventListener("popstate", heard);
    render(<TriageSidebarHeader />);
    screen.getByRole("button", { name: "Browse plugins" }).click();
    window.removeEventListener("popstate", heard);
    expect(window.location.pathname + window.location.search).toBe("/plugins");
    expect(heard).toHaveBeenCalledTimes(1);
  });
});
