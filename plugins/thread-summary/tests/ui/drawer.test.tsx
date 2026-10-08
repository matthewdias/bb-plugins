import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
// At the top, not inside a test: see header.test.tsx (#18).
import pluginApp from "../../app";
import { SummaryAction } from "../../src/header";
import { resetDeviceState } from "../../src/device-state";
import { resetHiddenProviders } from "../../src/use-hidden-providers";
import { GIT_ID } from "../../lib/order";
import { disposeProviders, freshThread, hiddenBackend, provide, sidebarThread } from "./fixtures";

void pluginApp;

beforeEach(() => {
  window.localStorage.clear();
  resetDeviceState();
  resetHiddenProviders();
});
afterEach(() => {
  disposeProviders();
});

function render() {
  const threadId = freshThread();
  provide(
    { id: GIT_ID, name: "Git" },
    {
      [threadId]: {
        icon: "GitBranch",
        label: "feature → main",
        text: "↑2",
        detail: { title: "feature → main", rows: [{ label: "Ahead · behind", value: "2 · 0" }] },
      },
    },
  );
  const slot = renderSlot(
    { component: SummaryAction },
    { threadId, projectId: "proj_1", isCompactViewport: true },
    {
      pluginId: "thread-summary",
      settings: { showChips: true },
      rpc: hiddenBackend() as never,
      sidebarThreads: { status: "ready", threads: [sidebarThread(threadId)] },
    },
  );
  fireEvent.click(slot.getByRole("button", { name: "Thread summary" }));
  return slot;
}

const drawer = () => document.querySelector<HTMLElement>("[data-thread-summary-drawer]");
const handle = () => document.querySelector<HTMLElement>("[data-thread-summary-handle]")!;

/** Drag the handle by `dy` from a drawer `height` tall, in a 1000px window. */
function drag(height: number, dy: number) {
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 1000 });
  const panel = drawer()!;
  let current = height;
  panel.getBoundingClientRect = () => ({ height: current }) as DOMRect;
  fireEvent.pointerDown(handle(), { button: 0, pointerId: 1, clientY: 500 });
  fireEvent.pointerMove(handle(), { pointerId: 1, clientY: 500 + dy });
  current = height - dy;
  fireEvent.pointerUp(handle(), { pointerId: 1, clientY: 500 + dy });
}

describe("the phone drawer", () => {
  it("opens instead of the floating card, at half height for compact", () => {
    render();
    expect(document.querySelector("[data-thread-summary-card]")).toBeNull();
    expect(drawer()?.getAttribute("data-detent")).toBe("half");
    expect(drawer()!.style.height).toBe("50dvh");
    expect(within(drawer()!).getByText("feature → main")).toBeTruthy();
    expect(within(drawer()!).queryByText("Ahead · behind")).toBeNull();
  });

  it("goes to full height, expanded, from the toggle on its top edge", () => {
    render();
    fireEvent.click(within(drawer()!).getByRole("button", { name: "Show details" }));
    expect(drawer()?.getAttribute("data-detent")).toBe("full");
    expect(drawer()!.style.height).toBe("92dvh");
    expect(within(drawer()!).getByText("Ahead · behind")).toBeTruthy();
    expect(window.localStorage.getItem("thread-summary:mode")).toBe("expanded");
  });

  it("goes to full height, expanded, when dragged up", () => {
    render();
    drag(500, -300);
    expect(drawer()?.getAttribute("data-detent")).toBe("full");
    expect(within(drawer()!).getByText("Ahead · behind")).toBeTruthy();
  });

  it("goes back to half height, compact, when dragged down from full", () => {
    render();
    fireEvent.click(within(drawer()!).getByRole("button", { name: "Show details" }));
    drag(920, 380);
    expect(drawer()?.getAttribute("data-detent")).toBe("half");
  });

  it("closes when swiped down low enough", () => {
    render();
    drag(500, 250);
    expect(drawer()).toBeNull();
  });

  it("closes on a tap outside", () => {
    render();
    fireEvent.click(document.querySelector("[data-thread-summary-backdrop]")!);
    expect(drawer()).toBeNull();
  });

  it("closes on Escape", async () => {
    render();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(drawer()).toBeNull());
  });

  it("has no pin, which does not apply on a phone", () => {
    render();
    expect(within(drawer()!).queryByRole("button", { name: /pin/i })).toBeNull();
  });

  it("does not open by itself on a thread switch while pinned", () => {
    window.localStorage.setItem("thread-summary:pinned", "true");
    const slot = renderSlot(
      { component: SummaryAction },
      { threadId: freshThread(), projectId: "proj_1", isCompactViewport: true },
      { pluginId: "thread-summary", rpc: hiddenBackend() as never },
    );
    act(() => {
      slot.lifecycle.rerender(<SummaryAction isCompactViewport projectId="proj_1" threadId={freshThread()} />);
    });
    expect(drawer()).toBeNull();
  });

  it("does not open by itself while pinned", () => {
    window.localStorage.setItem("thread-summary:pinned", "true");
    renderSlot(
      { component: SummaryAction },
      { threadId: freshThread(), projectId: "proj_1", isCompactViewport: true },
      { pluginId: "thread-summary", rpc: hiddenBackend() as never },
    );
    expect(drawer()).toBeNull();
  });
});
