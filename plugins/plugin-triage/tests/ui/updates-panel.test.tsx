// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UpdatesPanel, resetChangesCache } from "../../ui/UpdatesPanel";
import { decideUpdate, resetUpdateDecisions, undoLastUpdate } from "../../ui/update-decisions";
import { resetTriageStore, triageStore, type TriageRpc, type UpdatesState } from "../../ui/triage-store";
import type { UpdateCard } from "../../lib/updates-deck";
import type { UpdateJob } from "../../lib/queue";

const openUrl = vi.fn();
vi.mock("@get-bb/plugin-sdk/app", () => ({
  experimental_Icon: () => null,
  Markdown: ({ content }: { content: string }) => <div>{content}</div>,
  useBbNavigate: () => ({ openUrl }),
}));
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
  return { cards: [], unavailable: [], history: [], ...overrides };
}

let changesAnswer: unknown = { kind: "none" };

function rpcFake() {
  const call = vi.fn(async (method: string, _input?: unknown) => {
    if (method === "update_decide") return { previous: null };
    if (method === "update_undo") return { undone: true, reason: null };
    if (method === "update_changes") return changesAnswer;
    // The page reloads after an undo: answer with the decks as they stand.
    if (method === "deck_new") return { cards: triageStore.getSnapshot().cards, cutoff: 0 };
    if (method === "deck_saved") return { cards: triageStore.getSnapshot().saved };
    if (method === "updates_deck") return triageStore.getSnapshot().updates;
    if (method === "queue_status") return triageStore.getSnapshot().queue;
    if (method === "cleanup_deck") return triageStore.getSnapshot().cleanup;
    return { checked: 1 };
  });
  return { rpc: { call } as unknown as TriageRpc, call };
}

afterEach(() => {
  resetChangesCache();
  changesAnswer = { kind: "none" };
  resetUpdateDecisions();
  resetTriageStore();
});

describe("the Updates tab", () => {
  it("says when everything is up to date, and checks again on request", async () => {
    const { rpc, call } = rpcFake();
    render(<UpdatesPanel rpc={rpc} updates={state()} keyboard />);
    expect(screen.getByText("Nothing to update")).toBeTruthy();
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
    expect(call).toHaveBeenCalledWith("update_undo", { pluginId: "gamma", restore: null });
    expect(triageStore.getSnapshot().updates.cards.map((c) => c.pluginId)).toEqual(["gamma"]);
  });
});

describe("what the top card's update changes", () => {
  const github = (overrides: Record<string, unknown>) => ({
    kind: "github",
    commits: [],
    total: 0,
    repoWide: 44,
    subdirectory: "bb-plugin-diff-comment",
    releaseNotes: null,
    url: "https://github.com/acme/x/compare/a...b",
    ...overrides,
  });

  it("says plainly when the update doesn't touch the plugin", async () => {
    changesAnswer = github({});
    const { rpc } = rpcFake();
    render(<UpdatesPanel rpc={rpc} updates={state({ cards: [card("diff-comment")] })} keyboard />);
    expect(await screen.findByTestId("no-changes")).toHaveProperty(
      "textContent",
      "No changes to this plugin. The 44 commits in its repository changed other things.",
    );
  });

  it("lists the commits that do, with the rest on GitHub", async () => {
    changesAnswer = github({
      commits: [
        { sha: "c4".padEnd(40, "0"), subject: "Polish Diff Comment", date: null, author: null },
        { sha: "c2".padEnd(40, "0"), subject: "Fix the header", date: null, author: null },
      ],
      total: 8,
    });
    const { rpc } = rpcFake();
    render(<UpdatesPanel rpc={rpc} updates={state({ cards: [card("diff-comment")] })} keyboard />);
    expect(await screen.findByText("Polish Diff Comment")).toBeTruthy();
    expect(screen.getByText("8 changes · 44 in the repository")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "and 6 more on GitHub" }));
    expect(openUrl).toHaveBeenCalledWith("https://github.com/acme/x/compare/a...b");
  });

  it("explains when GitHub couldn't say", async () => {
    changesAnswer = { kind: "unavailable", reason: "GitHub's hourly limit for this machine is used up." };
    const { rpc } = rpcFake();
    render(<UpdatesPanel rpc={rpc} updates={state({ cards: [card("alpha")] })} keyboard />);
    expect(await screen.findByText("GitHub's hourly limit for this machine is used up.")).toBeTruthy();
  });

  it("asks once per card, however often the deck redraws", async () => {
    const { rpc, call } = rpcFake();
    const view = render(<UpdatesPanel rpc={rpc} updates={state({ cards: [card("alpha")] })} keyboard />);
    view.rerender(<UpdatesPanel rpc={rpc} updates={state({ cards: [card("alpha")] })} keyboard />);
    await waitFor(() => expect(call.mock.calls.filter(([m]) => m === "update_changes")).toHaveLength(1));
  });
});

describe("fetching the top card's changes", () => {
  afterEach(() => vi.useRealTimers());

  it("waits until a card has stayed on top, so flicking past costs nothing", async () => {
    vi.useFakeTimers();
    const { rpc, call } = rpcFake();
    const asked = () => call.mock.calls.filter(([m]) => m === "update_changes").map(([, input]) => (input as { pluginId: string }).pluginId);
    const view = render(<UpdatesPanel rpc={rpc} updates={state({ cards: [card("alpha"), card("beta")] })} keyboard />);
    await vi.advanceTimersByTimeAsync(300);
    view.rerender(<UpdatesPanel rpc={rpc} updates={state({ cards: [card("beta")] })} keyboard />);
    await vi.advanceTimersByTimeAsync(300);
    expect(asked()).toEqual([]);
    await vi.advanceTimersByTimeAsync(500);
    expect(asked()).toEqual(["beta"]);
  });

  it("offers to load the changes when GitHub's limit is nearly spent", async () => {
    changesAnswer = { kind: "deferred", remaining: 4, resetAt: null };
    const { rpc, call } = rpcFake();
    render(<UpdatesPanel rpc={rpc} updates={state({ cards: [card("alpha")] })} keyboard />);
    expect(await screen.findByText(/Saving GitHub's hourly limit: 4 left/)).toBeTruthy();
    changesAnswer = { kind: "none" };
    fireEvent.click(screen.getByRole("button", { name: "Load changes" }));
    await waitFor(() => expect(call).toHaveBeenLastCalledWith("update_changes", expect.objectContaining({ pluginId: "alpha", force: true })));
  });
});

describe("undoing a queued update", () => {
  it("takes it off the queue, even though the server's refresh lands mid-undo", async () => {
    let queued = [job("alpha")];
    let release: () => void = () => {};
    let refreshing: Promise<void> = Promise.resolve();
    const call = vi.fn(async (method: string, _input?: unknown) => {
      if (method === "deck_new") return { cards: [], cutoff: 0 };
      if (method === "deck_saved") return { cards: [] };
      if (method === "updates_deck") {
        // After the undo the server has the card back, and (say) bb has since
        // marked a plugin unchecked: only a reload brings that.
        const answer =
          queued.length === 0
            ? state({ cards: [card("alpha")], unavailable: [{ pluginId: "icons", displayName: "Icons", detail: null }] })
            : state();
        await refreshing;
        return answer;
      }
      if (method === "cleanup_deck") return { cards: [], graveyard: [] };
      if (method === "queue_status") {
        const answer = { jobs: queued, running: false };
        await refreshing;
        return answer;
      }
      if (method === "update_decide") return { previous: null };
      if (method === "update_undo") {
        // The server cancels the job and announces it; the page starts a
        // refresh on that announcement, which is still in flight when this
        // call returns.
        queued = [];
        refreshing = new Promise((resolve) => (release = resolve));
        void triageStore.load(rpc);
        return { undone: true, reason: null };
      }
      return { kind: "none" };
    });
    const rpc = { call } as unknown as TriageRpc;
    await triageStore.load(rpc);
    expect(triageStore.getSnapshot().queue.jobs.map((j) => j.pluginId)).toEqual(["alpha"]);

    await decideUpdate(rpc, card("alpha"), "right");
    await undoLastUpdate(rpc);
    // At once, while every refresh is still waiting on the server.
    expect(triageStore.getSnapshot().queue.jobs).toEqual([]);
    expect(triageStore.getSnapshot().updates.cards.map((c) => c.pluginId)).toEqual(["alpha"]);
    release();
    // The rest of the page caught up with the server too.
    await waitFor(() => expect(triageStore.getSnapshot().updates.unavailable.map((u) => u.pluginId)).toEqual(["icons"]));
  });
});
