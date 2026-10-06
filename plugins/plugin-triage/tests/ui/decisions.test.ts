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
      Promise.resolve(method === "undo" ? { undone: false, reason: "It's already installing." } : { job: null, previous: null })) as never);
    void decide(rpc, beta, "right");
    await flush();
    await undoLast(rpc);
    expect(vi.mocked(haptic).mock.calls.map(([kind]) => kind)).toEqual(["warning"]);
  });
});
