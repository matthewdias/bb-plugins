import { afterEach, describe, expect, it } from "vitest";
import { waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
// Loaded at the top, not inside a test, as in app.test.tsx: the first load pulls in
// every hugeicons icon, which can outlast a test's timeout on a busy machine.
import pluginApp from "../../app.tsx";
import { ComplicationPublisher } from "../../src/complication-publisher.tsx";
import { getComplications, type ComplicationSubject } from "../../lib/complications.ts";
import { FOLLOW_UP_PROGRESS } from "../../lib/progress-complication.ts";

// The registry lives on globalThis and outlasts each render, as it does in a
// bb window, so every test asks about threads no other test has touched.
const registry = getComplications()!;
let threads = 0;
const freshThread = (): ComplicationSubject => ({ kind: "thread", id: `thr_pub${++threads}` });
const label = (subject: ComplicationSubject) => registry.read(FOLLOW_UP_PROGRESS, subject)?.label;

/** Wants outlive a render too, so each test gives its own back. */
const releases: (() => void)[] = [];
const want = (subject: ComplicationSubject) => {
  releases.push(registry.want(FOLLOW_UP_PROGRESS, subject));
};
afterEach(() => {
  for (const release of releases.splice(0)) release();
});

/** Render the publisher against a counts call that answers from `counts`. */
function renderPublisher(counts: Record<string, { open: number; done: number }>) {
  const slot = renderSlot({ component: ComplicationPublisher }, {}, {
    rpc: {
      getFollowUpCountsV1: async ({ threadIds }: { threadIds: string[] }) => ({
        protocolVersion: 1,
        counts: threadIds.map((threadId) => ({ threadId, ...(counts[threadId] ?? { open: 0, done: 0 }) })),
      }),
    } as never,
  });
  const askedFor = () =>
    slot.inspection.rpcCalls
      .filter((call) => call.method === "getFollowUpCountsV1")
      .map((call) => (call.input as { threadIds: string[] }).threadIds);
  return { slot, askedFor };
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 80));

describe("ComplicationPublisher", () => {
  it("is registered as an app overlay, so it outlives any one thread view", async () => {
    const app = await loadPluginApp(pluginApp);
    const overlay = app.appOverlays.find((entry) => entry.id === "complications");
    expect(overlay?.component).toBe(ComplicationPublisher);
  });

  it("provides follow-up progress while mounted, and withdraws it on unmount", async () => {
    const a = freshThread();
    const { slot } = renderPublisher({ [a.id]: { open: 1, done: 1 } });
    expect(registry.isProvided(FOLLOW_UP_PROGRESS)).toBe(true);
    expect(registry.providers().map((provider) => provider.id)).toContain(FOLLOW_UP_PROGRESS);
    want(a);
    await waitFor(() => expect(label(a)).toBe("1 of 2 follow-ups done"));

    slot.lifecycle.unmount();
    expect(registry.isProvided(FOLLOW_UP_PROGRESS)).toBe(false);
    expect(registry.read(FOLLOW_UP_PROGRESS, a)).toBeUndefined();
  });

  it("answers every wanted thread in one counts call", async () => {
    const a = freshThread();
    const b = freshThread();
    const { askedFor } = renderPublisher({
      [a.id]: { open: 2, done: 1 },
      [b.id]: { open: 0, done: 4 },
    });
    want(a);
    want(b);
    await waitFor(() => expect(label(b)).toBe("All 4 follow-ups done"));
    expect(label(a)).toBe("1 of 3 follow-ups done");
    expect(askedFor()).toEqual([[a.id, b.id]]);
  });

  it("publishes again when a wanted thread changes, and asks nothing for one nobody shows", async () => {
    const shown = freshThread();
    const hidden = freshThread();
    const counts = { [shown.id]: { open: 1, done: 0 }, [hidden.id]: { open: 5, done: 0 } };
    const { slot, askedFor } = renderPublisher(counts);
    want(shown);
    await waitFor(() => expect(label(shown)).toBe("0 of 1 follow-ups done"));

    counts[shown.id] = { open: 2, done: 0 };
    await slot.behavior.emitRealtime("followups-changed", { threadId: shown.id });
    await waitFor(() => expect(label(shown)).toBe("0 of 2 follow-ups done"));

    await slot.behavior.emitRealtime("followups-changed", { threadId: hidden.id });
    await slot.behavior.emitRealtime("followups-changed", { nonsense: true });
    await settle();
    expect(askedFor().flat()).not.toContain(hidden.id);
    expect(askedFor()).toEqual([[shown.id], [shown.id]]);
  });

  it("re-asks for everything on screen after realtime reconnects", async () => {
    const a = freshThread();
    const b = freshThread();
    const counts = { [a.id]: { open: 1, done: 0 }, [b.id]: { open: 1, done: 0 } };
    const { slot, askedFor } = renderPublisher(counts);
    want(a);
    want(b);
    await waitFor(() => expect(label(b)).toBe("0 of 1 follow-ups done"));

    // Changes made while the connection was down never arrive as signals.
    counts[a.id] = { open: 0, done: 1 };
    counts[b.id] = { open: 0, done: 1 };
    await slot.behavior.setRealtimeConnectionState("reconnecting");
    await slot.behavior.setRealtimeConnectionState("connected");
    await waitFor(() => expect(label(a)).toBe("All 1 follow-up done"));
    expect(label(b)).toBe("All 1 follow-up done");
    expect(askedFor().at(-1)?.slice().sort()).toEqual([a.id, b.id].sort());
  });
});
