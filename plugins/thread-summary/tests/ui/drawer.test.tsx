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
  const button = slot.getByRole("button", { name: "Thread summary" });
  // A tap on a phone need not focus what it taps, so focus starts elsewhere:
  // the drawer must hand it to the button itself, not just put back what was.
  (document.activeElement as HTMLElement | null)?.blur?.();
  fireEvent.click(button);
  expect(document.activeElement).not.toBe(button);
  return { slot, button };
}

const drawer = () => document.querySelector<HTMLElement>("[data-thread-summary-drawer]");
const handle = () => document.querySelector<HTMLElement>("[data-thread-summary-handle]")!;

/** Drag the handle by `dy` on a drawer `height` tall, and let go. */
function drag(height: number, dy: number) {
  drawer()!.getBoundingClientRect = () => ({ height }) as DOMRect;
  fireEvent.pointerDown(handle(), { button: 0, pointerId: 1, clientY: 500 });
  fireEvent.pointerMove(handle(), { pointerId: 1, clientY: 500 + dy });
  const during = drawer()?.style.transform;
  fireEvent.pointerUp(handle(), { pointerId: 1, clientY: 500 + dy });
  return during;
}

describe("the phone drawer", () => {
  it("opens instead of the floating card, always showing the details", () => {
    window.localStorage.setItem("thread-summary:mode", "compact");
    render();
    expect(document.querySelector("[data-thread-summary-card]")).toBeNull();
    expect(within(drawer()!).getByText("feature → main")).toBeTruthy();
    expect(within(drawer()!).getByText("Ahead · behind")).toBeTruthy();
  });

  it("fits its contents up to 92% of the screen, with no fixed height", () => {
    render();
    expect(drawer()!.style.maxHeight).toBe("92dvh");
    expect(drawer()!.style.height).toBe("");
  });

  it("has no mode control, and never writes the stored mode", () => {
    window.localStorage.setItem("thread-summary:mode", "compact");
    render();
    expect(within(drawer()!).queryByRole("button", { name: /details|headlines/i })).toBeNull();
    drag(400, 50);
    drag(400, 200);
    expect(window.localStorage.getItem("thread-summary:mode")).toBe("compact");
  });

  it("leaves no stored mode behind when there was none", () => {
    render();
    drag(400, 50);
    expect(window.localStorage.getItem("thread-summary:mode")).toBeNull();
  });

  it("closes from its close button and gives focus back to the header button", async () => {
    const { button } = render();
    fireEvent.click(within(drawer()!).getByRole("button", { name: "Close" }));
    expect(drawer()).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(button));
  });

  it("closes when dragged down past the threshold", () => {
    render();
    drag(400, 100);
    expect(drawer()).toBeNull();
  });

  it("springs back to where it started short of the threshold", () => {
    render();
    const during = drag(400, 99);
    expect(during).toBe("translate3d(0, 99px, 0)");
    expect(drawer()).not.toBeNull();
    expect(drawer()!.style.transform).toBe("");
  });

  it("moves down only", () => {
    render();
    const during = drag(400, -200);
    expect(during).toBe("translate3d(0, 0px, 0)");
    expect(drawer()).not.toBeNull();
  });

  it("closes on a tap outside", () => {
    render();
    fireEvent.click(document.querySelector("[data-thread-summary-backdrop]")!);
    expect(drawer()).toBeNull();
  });

  it("closes on Escape, and gives focus back to the header button", async () => {
    const { button } = render();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(drawer()).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(button));
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
