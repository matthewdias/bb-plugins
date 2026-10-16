// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { decide, resetDecisions, undoLast } from "../../ui/decisions";
import { haptic } from "../../ui/haptics";
import { resetTriageStore, triageStore, type TriageRpc } from "../../ui/triage-store";
import { toCard } from "../../lib/new-deck";
import { entry } from "../fixtures";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), dismiss: vi.fn() }) }));
vi.mock("../../ui/haptics", () => ({ haptic: vi.fn() }));

const alpha = toCard(entry({ entryId: "alpha" }));
const beta = toCard(entry({ entryId: "beta" }));

/** What a server holding the store's current decks answers for them. */
function deckAnswer(method: string): unknown {
  const snapshot = triageStore.getSnapshot();
  if (method === "deck_new") return { cards: snapshot.cards, cutoff: 0 };
  if (method === "deck_saved") return { cards: snapshot.saved };
  if (method === "updates_deck") return snapshot.updates;
  if (method === "cleanup_deck") return snapshot.cleanup;
  if (method === "queue_status") return snapshot.queue;
  return undefined;
}

/** A server whose `decide` answers only when told to. */
function fakeRpc() {
  const calls: { method: string; input: Record<string, unknown> }[] = [];
  const answers: (() => void)[] = [];
  const rpc = {
    call: vi.fn((method: string, input: Record<string, unknown>) => {
      calls.push({ method, input });
      if (method === "decide") {
        return new Promise((resolve) => answers.push(() => resolve({ job: null, previous: null })));
      }
      if (method === "entry_plan") return Promise.resolve({ summary: null, confirmedSource: null });
      // The page reloads after an undo: answer with the decks as they stand.
      const deck = deckAnswer(method);
      if (deck !== undefined) return Promise.resolve(deck);
      return Promise.resolve({ undone: true, reason: null });
    }),
  } as unknown as TriageRpc;
  /** Answers every decide, including ones sent while answering. */
  const flush = async () => {
    for (let round = 0; round < 10; round++) {
      for (const answer of answers.splice(0)) answer();
      for (let i = 0; i < 5; i++) await Promise.resolve();
    }
  };
  const undos = () => calls.filter((call) => call.method === "undo").map((call) => call.input.key);
  return { rpc, flush, undos };
}

afterEach(() => {
  resetDecisions();
  resetTriageStore();
});

describe("undo", () => {
  it("takes back a swipe the server hasn't confirmed yet, not the one before it", async () => {
    const { rpc, flush, undos } = fakeRpc();
    void decide(rpc, alpha, "left");
    await flush();
    void decide(rpc, beta, "right");
    // Z pressed before the server answers the install.
    const undone = undoLast(rpc);
    await flush();
    await undone;
    expect(undos()).toEqual(["beta@bb-community"]);
    expect(triageStore.getSnapshot().cards.map((card) => card.entryId)).toEqual(["beta"]);
  });

  it("walks back one decision per press, even when pressed twice at once", async () => {
    const { rpc, flush, undos } = fakeRpc();
    void decide(rpc, alpha, "left");
    void decide(rpc, beta, "up");
    await flush();
    await Promise.all([undoLast(rpc), undoLast(rpc)]);
    expect(undos()).toEqual(["beta@bb-community", "alpha@bb-community"]);
  });

  it("gives a light thud when an undo lands, and a warning when it is refused", async () => {
    vi.mocked(haptic).mockClear();
    const { rpc, flush } = fakeRpc();
    void decide(rpc, alpha, "left");
    await flush();
    await undoLast(rpc);
    expect(vi.mocked(haptic).mock.calls.map(([kind]) => kind)).toEqual(["impact-light"]);

    vi.mocked(haptic).mockClear();
    vi.mocked(rpc.call).mockImplementation(((method: string) =>
      Promise.resolve(
        deckAnswer(method) ?? (method === "undo" ? { undone: false, reason: "It's already installing." } : { job: null, previous: null }),
      )) as never);
    void decide(rpc, beta, "right");
    await flush();
    await undoLast(rpc);
    expect(vi.mocked(haptic).mock.calls.map(([kind]) => kind)).toEqual(["warning"]);
  });

  it("does not install, and puts the card back, when the source the card showed can't be had", async () => {
    const { rpc, flush } = fakeRpc();
    vi.mocked(rpc.call).mockImplementation(((method: string) =>
      method === "entry_plan" ? Promise.reject(new Error("resolve failed")) : Promise.resolve({ job: null, previous: null })) as never);
    triageStore.putBack(alpha);
    await decide(rpc, alpha, "right");
    await flush();
    expect(vi.mocked(rpc.call).mock.calls.map(([method]) => method)).not.toContain("decide");
    expect(triageStore.getSnapshot().cards.map((card) => card.entryId)).toEqual(["alpha"]);
  });
});

describe("the Saved deck", () => {
  const saved = () => triageStore.getSnapshot().saved.map((card) => card.entryId);

  it("sends a card to the back on ↑, keeping that on the server, and Z restores the save there", async () => {
    const { rpc, flush } = fakeRpc();
    const previous = { action: "save", at: 1 };
    vi.mocked(rpc.call).mockImplementation(((method: string) =>
      Promise.resolve(deckAnswer(method) ?? (method === "later" ? { previous } : { undone: true, reason: null }))) as never);
    triageStore.addSaved(beta);
    triageStore.addSaved(alpha);
    await decide(rpc, alpha, "up", "saved");
    expect(saved()).toEqual(["beta", "alpha"]);
    expect(vi.mocked(rpc.call)).toHaveBeenCalledWith("later", { key: alpha.key });
    await undoLast(rpc);
    await flush();
    expect(saved()).toEqual(["alpha", "beta"]);
    expect(vi.mocked(rpc.call)).toHaveBeenCalledWith("undo", { key: alpha.key, restore: previous });
  });

  it("drops a reload already under way when ↑ moves a card, so the old order can't land on it", async () => {
    const { rpc } = fakeRpc();
    let answerSaved: (value: unknown) => void = () => {};
    vi.mocked(rpc.call).mockImplementation(((method: string) => {
      if (method === "deck_saved") return new Promise((resolve) => (answerSaved = resolve));
      if (method === "later") return Promise.resolve({ previous: { action: "save", at: 1 } });
      return Promise.resolve(deckAnswer(method));
    }) as never);
    triageStore.addSaved(beta);
    triageStore.addSaved(alpha);
    const loading = triageStore.load(rpc);
    await decide(rpc, alpha, "up", "saved");
    answerSaved({ cards: [alpha, beta] });
    await loading;
    expect(saved()).toEqual(["beta", "alpha"]);
  });

  it("only moves the card in this window when the server no longer has it saved", async () => {
    const { rpc, flush } = fakeRpc();
    vi.mocked(rpc.call).mockImplementation(((method: string) =>
      Promise.resolve(deckAnswer(method) ?? (method === "later" ? { previous: null } : { undone: true, reason: null }))) as never);
    triageStore.addSaved(beta);
    triageStore.addSaved(alpha);
    await decide(rpc, alpha, "up", "saved");
    await undoLast(rpc);
    await flush();
    expect(saved()).toEqual(["alpha", "beta"]);
    expect(vi.mocked(rpc.call).mock.calls.map(([method]) => method)).not.toContain("undo");
  });

  it("puts a card back on top of Saved when the server can't keep it at the back", async () => {
    const { rpc } = fakeRpc();
    vi.mocked(rpc.call).mockImplementation(((method: string) =>
      method === "later" ? Promise.reject(new Error("offline")) : Promise.resolve(deckAnswer(method))) as never);
    triageStore.addSaved(beta);
    triageStore.addSaved(alpha);
    await decide(rpc, alpha, "up", "saved");
    expect(saved()).toEqual(["alpha", "beta"]);
  });

  it("forgets a card on ←, and Z puts it back in Saved rather than on New", async () => {
    const { rpc, flush } = fakeRpc();
    vi.mocked(rpc.call).mockImplementation(((method: string, input: Record<string, unknown>) =>
      Promise.resolve(
        deckAnswer(method) ??
          (method === "decide"
            ? { job: null, previous: input.action === "dismiss" ? { action: "save", at: 1 } : null }
            : { undone: true, reason: null }),
      )) as never);
    triageStore.addSaved(alpha);
    await decide(rpc, alpha, "left", "saved");
    expect(vi.mocked(rpc.call).mock.calls.find(([method]) => method === "decide")?.[1]).toMatchObject({ action: "dismiss" });
    expect(saved()).toEqual([]);
    await undoLast(rpc);
    await flush();
    expect(saved()).toEqual(["alpha"]);
    expect(triageStore.getSnapshot().cards).toEqual([]);
  });

  it("puts a card whose install fails back in Saved, not on New", async () => {
    const { rpc } = fakeRpc();
    vi.mocked(rpc.call).mockImplementation(((method: string) =>
      method === "entry_plan" ? Promise.reject(new Error("resolve failed")) : Promise.resolve({ job: null, previous: null })) as never);
    triageStore.addSaved(alpha);
    await decide(rpc, alpha, "right", "saved");
    expect(saved()).toEqual(["alpha"]);
    expect(triageStore.getSnapshot().cards).toEqual([]);
  });
});
