// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EntryDeck } from "../../ui/EntryDeck";
import { UpdatesPanel, resetChangesCache } from "../../ui/UpdatesPanel";
import { CleanupPanel, resetCosts } from "../../ui/CleanupPanel";
import { resetDecisions } from "../../ui/decisions";
import { resetUpdateDecisions } from "../../ui/update-decisions";
import { resetCleanupDecisions } from "../../ui/cleanup-decisions";
import { resetTriageStore, triageStore, type TriageRpc } from "../../ui/triage-store";
import { setArrangement } from "../../ui/layout";
import { DEFAULT_ARRANGEMENT } from "../../lib/arrange";
import { toCard } from "../../lib/new-deck";
import type { UpdateCard } from "../../lib/updates-deck";
import type { CleanupCard } from "../../lib/cleanup-deck";
import { entry } from "../fixtures";

const call = vi.fn(async (method: string, _input?: unknown) => {
  if (method === "entry_plan") return { summary: null, confirmedSource: null };
  if (method === "decide" || method === "update_decide" || method === "cleanup_decide") return { previous: null };
  if (method === "undo") return { undone: true, reason: null };
  if (method === "deck_new") return { cards: triageStore.getSnapshot().cards };
  if (method === "deck_saved") return { cards: triageStore.getSnapshot().saved };
  if (method === "updates_deck") return triageStore.getSnapshot().updates;
  if (method === "cleanup_deck") return triageStore.getSnapshot().cleanup;
  if (method === "queue_status") return triageStore.getSnapshot().queue;
  if (method === "cleanup_cost") return { settings: ["Mode"], secrets: [], scheduled: false };
  if (method === "update_changes") return { kind: "none" };
  return {};
});
const rpc = { call } as unknown as TriageRpc;
vi.mock("@get-bb/plugin-sdk/app", () => ({
  experimental_Icon: () => null,
  Markdown: ({ content }: { content: string }) => <div>{content}</div>,
  useRpc: () => rpc,
  useBbNavigate: () => ({ toCompose: vi.fn(), openUrl: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), dismiss: vi.fn() }) }));
vi.mock("../../ui/haptics", () => ({ haptic: vi.fn() }));

afterEach(() => {
  call.mockClear();
  resetDecisions();
  resetUpdateDecisions();
  resetCleanupDecisions();
  resetChangesCache();
  resetCosts();
  resetTriageStore();
  setArrangement(DEFAULT_ARRANGEMENT);
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
});

const alpha = toCard(entry({ entryId: "alpha" }));
const beta = toCard(entry({ entryId: "beta", compatible: false, incompatibleReason: "Needs bb 0.50" }));

function cardOf(name: string): HTMLElement {
  return screen.getByRole("listitem", { name });
}

describe("the New deck as a grid", () => {
  function setup() {
    triageStore.putBack(beta);
    triageStore.putBack(alpha);
    const view = render(<EntryDeck deck="new" cards={triageStore.getSnapshot().cards} keyboard layout="grid" empty={<p>Empty</p>} />);
    return view;
  }

  it("shows every card at once, as bb's store does, and no deck", () => {
    setup();
    expect(screen.getAllByRole("listitem").map((item) => item.getAttribute("aria-label"))).toEqual(["alpha", "beta"]);
    expect(screen.queryByTestId("top-card")).toBeNull();
    expect(screen.getByText("2 new plugins")).toBeTruthy();
    expect(within(cardOf("alpha")).getByText(/^someone · 3 installs · /)).toBeTruthy();
    expect(within(cardOf("beta")).getByText("Needs bb 0.50")).toBeTruthy();
  });

  it("decides on any card, not only the first", async () => {
    setup();
    fireEvent.click(within(cardOf("beta")).getByRole("button", { name: "Save for later" }));
    await waitFor(() => expect(call).toHaveBeenCalledWith("decide", expect.objectContaining({ key: beta.key, action: "save" })));
    expect(triageStore.getSnapshot().cards.map((card) => card.key)).toEqual([alpha.key]);
    expect(triageStore.getSnapshot().saved.map((card) => card.key)).toEqual([beta.key]);
  });

  it("names the install on its button, as the store's card does", () => {
    setup();
    expect(within(cardOf("alpha")).getByRole("button", { name: "Install" }).textContent).toBe("Install");
    expect(within(cardOf("alpha")).getByRole("button", { name: "Dismiss" }).textContent).toBe("");
  });

  it("previews a card in place, as the deck's card opened in full, without leaving the page", () => {
    triageStore.putBack(toCard(entry({ entryId: "alpha", overview: "The long story." })));
    render(<LiveNew />);
    fireEvent.click(screen.getByRole("button", { name: "Preview alpha" }));
    const preview = screen.getByRole("dialog", { name: "Preview of alpha" });
    expect(within(preview).getByText("The long story.")).toBeTruthy();
    expect(within(preview).getByRole("button", { name: "Vet with an agent" })).toBeTruthy();
    expect(window.location.pathname).toBe("/");
  });

  it("takes the last decision back on Z, and leaves the arrow keys alone", async () => {
    setup();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(call).not.toHaveBeenCalledWith("decide", expect.anything());
    fireEvent.click(within(cardOf("alpha")).getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(call).toHaveBeenCalledWith("decide", expect.objectContaining({ key: alpha.key, action: "dismiss" })));
    fireEvent.keyDown(window, { key: "z" });
    await waitFor(() => expect(call).toHaveBeenCalledWith("undo", { key: alpha.key, restore: null }));
  });
});

/** The New deck as a grid, following the store as decisions change it. */
function LiveNew() {
  const { cards } = useSyncExternalStore(triageStore.subscribe, triageStore.getSnapshot);
  return <EntryDeck deck="new" cards={cards} keyboard layout="grid" empty={<p>Empty</p>} />;
}

describe("the grid's preview", () => {
  const gamma = toCard(entry({ entryId: "gamma" }));
  function setup() {
    for (const card of [gamma, beta, alpha]) triageStore.putBack(card);
    render(<LiveNew />);
  }

  it("decides from its buttons and moves on to the next card in the grid", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Preview beta" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Install (→)" }));
    await waitFor(() => expect(call).toHaveBeenCalledWith("decide", expect.objectContaining({ key: beta.key, action: "install" })));
    expect(screen.getByRole("dialog", { name: "Preview of gamma" })).toBeTruthy();
  });

  it("decides with the deck's arrow keys, and steps back at the end of the grid", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Preview gamma" }));
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    await waitFor(() => expect(call).toHaveBeenCalledWith("decide", expect.objectContaining({ key: gamma.key, action: "dismiss" })));
    expect(screen.getByRole("dialog", { name: "Preview of beta" })).toBeTruthy();
  });

  it("closes after the last card", async () => {
    triageStore.putBack(alpha);
    render(<LiveNew />);
    fireEvent.click(screen.getByRole("button", { name: "Preview alpha" }));
    fireEvent.keyDown(window, { key: "ArrowUp" });
    await waitFor(() => expect(call).toHaveBeenCalledWith("decide", expect.objectContaining({ key: alpha.key, action: "save" })));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes on Escape, and keeps the key from bb, which would leave the Plugins screen", () => {
    setup();
    const bbEscape = vi.fn();
    window.addEventListener("keydown", bbEscape);
    try {
      fireEvent.click(screen.getByRole("button", { name: "Preview alpha" }));
      fireEvent.keyDown(window, { key: "Escape" });
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(bbEscape).not.toHaveBeenCalled();
      expect(triageStore.getSnapshot().cards).toHaveLength(3);
    } finally {
      window.removeEventListener("keydown", bbEscape);
    }
  });

  it("leaves the arrow keys to a screenshot gallery opened from the preview", () => {
    triageStore.putBack(toCard(entry({ entryId: "shots", screenshots: ["https://x/1.png", "https://x/2.png"] })));
    render(<LiveNew />);
    fireEvent.click(screen.getByRole("button", { name: "Preview shots" }));
    fireEvent.click(screen.getByRole("button", { name: "Open screenshot 1" }));
    expect(document.querySelector("[data-triage-gallery]")).not.toBeNull();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    // A decision takes the card off the deck at once, before the server hears.
    expect(triageStore.getSnapshot().cards.map((card) => card.entryId)).toEqual(["shots"]);
  });

  it("previews an update with what it changes, fetched for that card", async () => {
    render(<UpdatesPanel rpc={rpc} updates={{ cards: [update("one"), update("two")], unavailable: [], history: [] }} keyboard layout="grid" />);
    fireEvent.click(screen.getByRole("button", { name: "Preview two" }));
    await waitFor(() => expect(call).toHaveBeenCalledWith("update_changes", expect.objectContaining({ pluginId: "two" })), { timeout: 2000 });
    expect(call).not.toHaveBeenCalledWith("update_changes", expect.objectContaining({ pluginId: "one" }));
  });

  it("previews a Cleanup card with what uninstalling deletes, and closes as Details leaves", async () => {
    render(<CleanupPanel rpc={rpc} cleanup={{ cards: [cleanup("broken")], history: [] }} keyboard layout="grid" />);
    fireEvent.click(screen.getByRole("button", { name: "Preview broken" }));
    const preview = screen.getByRole("dialog");
    await waitFor(() => expect(within(preview).getByTestId("removal-cost").textContent).toBe("Uninstalling deletes its changed setting (Mode), for good."));
    fireEvent.click(within(preview).getByRole("button", { name: /Details/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(window.location.pathname + window.location.search).toBe("/plugins/broken?view=triage&tab=cleanup");
  });
});

describe("sorting and grouping the grid", () => {
  const cards = [
    toCard(entry({ entryId: "mid", installs: 50, category: "Utilities", marketplaceDisplayName: "BB Community" })),
    toCard(entry({ entryId: "Zed", installs: 900, category: "Code & Reviews", marketplaceDisplayName: "Acme" })),
    toCard(entry({ entryId: "able", installs: 2, category: undefined, marketplaceDisplayName: "BB Community" })),
  ];
  const order = () => screen.getAllByRole("listitem").map((item) => item.getAttribute("aria-label"));
  const headings = () => screen.queryAllByRole("heading", { level: 3 }).map((h) => h.textContent);

  function open(name: RegExp) {
    const trigger = screen.getByRole("button", { name });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
  }

  it("sorts from the Sort menu, and turns the order round when chosen again", async () => {
    render(<EntryDeck deck="new" cards={cards} keyboard layout="grid" empty={null} />);
    expect(order()).toEqual(["mid", "Zed", "able"]);
    open(/^Sort/);
    fireEvent.click(await screen.findByRole("menuitemradio", { name: /Installs/ }));
    await waitFor(() => expect(order()).toEqual(["Zed", "mid", "able"]));
    expect(screen.getByRole("button", { name: "Sort: Installs · Most first" })).toBeTruthy();
    open(/^Sort/);
    fireEvent.click(await screen.findByRole("menuitemradio", { name: /Installs/ }));
    await waitFor(() => expect(order()).toEqual(["able", "mid", "Zed"]));
    open(/^Sort/);
    fireEvent.click(await screen.findByRole("menuitemradio", { name: /Name/ }));
    await waitFor(() => expect(order()).toEqual(["able", "mid", "Zed"]));
  });

  it("groups by category or by store from the Group menu", async () => {
    render(<EntryDeck deck="new" cards={cards} keyboard layout="grid" empty={null} />);
    expect(headings()).toEqual([]);
    open(/^Group/);
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Category" }));
    await waitFor(() => expect(headings()).toEqual(["Code & Reviews1", "Utilities1", "No category1"]));
    open(/^Group/);
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Source" }));
    await waitFor(() => expect(headings()).toEqual(["Acme1", "BB Community2"]));
    expect(within(screen.getByRole("region", { name: "BB Community" })).getAllByRole("listitem").map((i) => i.getAttribute("aria-label"))).toEqual([
      "mid",
      "able",
    ]);
  });

  it("keeps a sort another tab offers but this one doesn't, and uses the deck's order here", () => {
    setArrangement({ sort: "installs", direction: "desc", group: "none" });
    const pending = [update("b"), update("a")];
    render(<UpdatesPanel rpc={rpc} updates={{ cards: pending, unavailable: [], history: [] }} keyboard layout="grid" />);
    expect(order()).toEqual(["b", "a"]);
    expect(screen.getByRole("button", { name: "Sort: Deck order" })).toBeTruthy();
  });

  it("groups updates by the store and category the server found", () => {
    setArrangement({ sort: "deal", direction: "desc", group: "category" });
    const pending = [update("b", { listing: { category: "Utilities", store: "BB Community" } }), update("a", { listing: null })];
    render(<UpdatesPanel rpc={rpc} updates={{ cards: pending, unavailable: [], history: [] }} keyboard layout="grid" />);
    expect(headings()).toEqual(["Utilities1", "No category1"]);
  });
});

function update(pluginId: string, overrides: Partial<UpdateCard> = {}): UpdateCard {
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
    compareUrl: null,
    isSelf: false,
    ...overrides,
  };
}

describe("Updates as a grid", () => {
  it("lists every update with its versions, and queues any of them", async () => {
    vi.useFakeTimers();
    try {
      const cards = [update("one"), update("two", { lastFailure: "rolled back" })];
      render(<UpdatesPanel rpc={rpc} updates={{ cards, unavailable: [], history: [] }} keyboard layout="grid" />);
      expect(screen.getAllByRole("listitem")).toHaveLength(2);
      expect(within(cardOf("two")).getByText("v1.0.0 → v1.1.0")).toBeTruthy();
      expect(within(cardOf("two")).getByText("Last attempt: rolled back")).toBeTruthy();
      // No change list is shown, so none is fetched.
      await act(() => vi.advanceTimersByTimeAsync(2000));
      expect(call).not.toHaveBeenCalledWith("update_changes", expect.anything());
      fireEvent.click(within(cardOf("two")).getByRole("button", { name: "Queue the update" }));
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(call).toHaveBeenCalledWith("update_decide", expect.objectContaining({ pluginId: "two", action: "queue" }));
    } finally {
      vi.useRealTimers();
    }
  });
});

function cleanup(pluginId: string, overrides: Partial<CleanupCard> = {}): CleanupCard {
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

describe("Cleanup as a grid", () => {
  it("gives each card its own decisions and says why it is there", async () => {
    const off = cleanup("off", { enabled: false, reason: { kind: "disabled", since: null } });
    render(<CleanupPanel rpc={rpc} cleanup={{ cards: [cleanup("broken"), off], history: [] }} keyboard layout="grid" />);
    expect(within(cardOf("broken")).getByText("Not working (error): boom")).toBeTruthy();
    expect(within(cardOf("broken")).getByRole("button", { name: "Try without it for two weeks" })).toBeTruthy();
    fireEvent.click(within(cardOf("off")).getByRole("button", { name: "Turn it back on" }));
    await waitFor(() => expect(call).toHaveBeenCalledWith("cleanup_decide", expect.objectContaining({ pluginId: "off", action: "enable" })));
  });

  it("says on every card what uninstalling would delete, before it can be queued", async () => {
    const kept = cleanup("kept");
    render(<CleanupPanel rpc={rpc} cleanup={{ cards: [cleanup("broken"), kept], history: [] }} keyboard layout="grid" />);
    const sentence = "Uninstalling deletes its changed setting (Mode), for good.";
    await waitFor(() => expect(within(cardOf("kept")).getByText(sentence)).toBeTruthy());
    expect(within(cardOf("broken")).getByText(sentence)).toBeTruthy();
    expect(within(cardOf("kept")).getByRole("button", { name: "Uninstall" }).getAttribute("title")).toBe(`Uninstall: ${sentence}`);
    expect(call.mock.calls.filter(([method]) => method === "cleanup_cost").map(([, input]) => input)).toEqual([
      { pluginId: "broken" },
      { pluginId: "kept" },
    ]);
  });
});

describe("the layout choice", () => {
  /** A fresh copy of the module, as a reload would load it. */
  async function load() {
    vi.resetModules();
    const { useLayout } = await import("../../ui/layout");
    function Probe() {
      return <p>{useLayout()}</p>;
    }
    return Probe;
  }

  it("starts as a deck, and keeps a switch to the grid across reloads", async () => {
    let Probe = await load();
    const { unmount } = render(<Probe />);
    expect(screen.getByText("deck")).toBeTruthy();
    const { setLayout } = await import("../../ui/layout");
    act(() => setLayout("grid"));
    expect(screen.getByText("grid")).toBeTruthy();
    unmount();
    Probe = await load();
    render(<Probe />);
    expect(screen.getByText("grid")).toBeTruthy();
  });
});
