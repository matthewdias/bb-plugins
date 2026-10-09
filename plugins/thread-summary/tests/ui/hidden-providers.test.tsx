import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, waitFor } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
// Imported once here, at collection, though every test imports it afresh
// below: see settings-section.test.tsx (#18).
import "../../src/header";
import { hiddenBackend } from "./fixtures";
import { HIDDEN_CHANGED } from "../../lib/hidden";

// The list is module scope, one per window; a fresh module per test is a
// fresh window.
beforeEach(() => {
  vi.resetModules();
});

async function headers(count: number) {
  const { SummaryAction } = await import("../../src/header");
  const slots = Array.from({ length: count }, (_, index) =>
    renderSlot(
      { component: SummaryAction },
      { threadId: `thr_hidden${index}`, projectId: "proj_1", isCompactViewport: false },
      { pluginId: "thread-summary", rpc: hiddenBackend() as never },
    ),
  );
  const lists = () =>
    slots.flatMap((slot) => slot.inspection.rpcCalls.filter((call) => call.method === "hiddenProviders_list"));
  return { slots, lists, SummaryAction };
}

describe("the hidden list", () => {
  it("is read once per window, however many headers mount", async () => {
    const { lists } = await headers(3);
    await waitFor(() => expect(lists()).toHaveLength(1));
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(lists()).toHaveLength(1);
  });

  it("is not read again when a header remounts, as a thread switch can make it", async () => {
    const { slots, lists, SummaryAction } = await headers(1);
    await waitFor(() => expect(lists()).toHaveLength(1));
    act(() => {
      slots[0].lifecycle.unmount();
    });
    const again = renderSlot(
      { component: SummaryAction },
      { threadId: "thr_hidden_again", projectId: "proj_1", isCompactViewport: false },
      { pluginId: "thread-summary", rpc: hiddenBackend() as never },
    );
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(again.inspection.rpcCalls.filter((call) => call.method === "hiddenProviders_list")).toHaveLength(0);
  });

  it("is read again when another window changes it", async () => {
    const { slots, lists } = await headers(2);
    await waitFor(() => expect(lists()).toHaveLength(1));
    await slots[0].behavior.emitRealtime(HIDDEN_CHANGED, { id: "thread-summary/git" });
    await waitFor(() => expect(lists()).toHaveLength(2));
  });

  it("is read again once after a reconnect, not once per header", async () => {
    const { slots, lists } = await headers(1);
    await waitFor(() => expect(lists()).toHaveLength(1));
    await slots[0].behavior.setRealtimeConnectionState("reconnecting");
    await slots[0].behavior.setRealtimeConnectionState("connected");
    await waitFor(() => expect(lists()).toHaveLength(2));
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(lists()).toHaveLength(2);
  });
});

describe("reloading the hidden list", () => {
  /** Two surfaces in one window, both reading the list, as two headers do. */
  async function twoConsumers(rpc: ReturnType<typeof hiddenBackend>) {
    const { useHiddenProviders } = await import("../../src/use-hidden-providers");
    function Consumer() {
      useHiddenProviders();
      return null;
    }
    function Two() {
      return (
        <>
          <Consumer />
          <Consumer />
        </>
      );
    }
    const slot = renderSlot({ component: Two }, {}, { rpc: rpc as never });
    const lists = () => slot.inspection.rpcCalls.filter((call) => call.method === "hiddenProviders_list");
    return { slot, lists };
  }

  it("makes one read for a signal every surface hears at once", async () => {
    const { slot, lists } = await twoConsumers(hiddenBackend());
    await waitFor(() => expect(lists()).toHaveLength(1));
    await slot.behavior.emitRealtime(HIDDEN_CHANGED, { id: "thread-summary/git" });
    await waitFor(() => expect(lists()).toHaveLength(2));
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(lists()).toHaveLength(2);
  });

  it("makes one read for a reconnect every surface sees at once", async () => {
    const { slot, lists } = await twoConsumers(hiddenBackend());
    await waitFor(() => expect(lists()).toHaveLength(1));
    await slot.behavior.setRealtimeConnectionState("reconnecting");
    await slot.behavior.setRealtimeConnectionState("connected");
    await waitFor(() => expect(lists()).toHaveLength(2));
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(lists()).toHaveLength(2);
  });

  it("reads again after a read in flight when a change is announced during it", async () => {
    const held: (() => void)[] = [];
    const backend = {
      ...hiddenBackend(),
      hiddenProviders_list: () => new Promise<{ hidden: string[] }>((resolve) => held.push(() => resolve({ hidden: [] }))),
    };
    const { slot, lists } = await twoConsumers(backend as never);
    await waitFor(() => expect(lists()).toHaveLength(1));
    await slot.behavior.emitRealtime(HIDDEN_CHANGED, { id: "thread-summary/git" });
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(lists()).toHaveLength(1);
    await act(async () => held[0]());
    await waitFor(() => expect(lists()).toHaveLength(2));
    await act(async () => held[1]());
  });
});
