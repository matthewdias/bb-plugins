import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { ComplicationBadge } from "../../badges/complication-badge";
import { defaultPrefs, type ComplicationPrefs } from "../../badges/complication-prefs";
import { getComplications, type ComplicationProviderHandle } from "../../lib/complications";

// The window's registry outlives each render, as it does in bb, so every test
// withdraws what it provided.
const registry = getComplications()!;
const handles: ComplicationProviderHandle[] = [];
afterEach(() => {
  for (const handle of handles.splice(0)) handle.dispose();
});

let providers = 0;
function provider() {
  const id = `test/badge${++providers}`;
  const handle = registry.provide({ id, name: "Test" });
  handles.push(handle);
  return { id, handle };
}

const THREAD = { kind: "thread", id: "thr_badge" } as const;

function renderBadge(id: string, prefs: Partial<ComplicationPrefs> = {}) {
  return renderSlot(
    { component: ComplicationBadge },
    { id, threadId: THREAD.id, prefs: { ...defaultPrefs(), enabled: true, ...prefs } },
  );
}

describe("ComplicationBadge", () => {
  it("draws a gauge as a ring named by its label, and redraws when the provider publishes", async () => {
    const { id, handle } = provider();
    handle.set(THREAD, { icon: "TextWrap", label: "1 of 4 done", fraction: 0.25 });
    const slot = renderBadge(id);
    const badge = slot.getByLabelText("1 of 4 done");
    expect(badge.querySelector("svg circle")).not.toBeNull();

    await act(async () => {
      handle.set(THREAD, { icon: "TextWrap", label: "2 of 4 done", fraction: 0.5 });
    });
    expect(slot.getByLabelText("2 of 4 done")).toBeTruthy();
  });

  it("draws nothing at all when the provider has nothing to say", async () => {
    const { id, handle } = provider();
    const slot = renderBadge(id);
    expect(slot.container.childElementCount).toBe(0);
    await act(async () => {
      handle.set(THREAD, null);
    });
    expect(slot.container.childElementCount).toBe(0);
  });

  it("draws a value without a fraction as the provider's icon, with text when asked", () => {
    const { id, handle } = provider();
    handle.set(THREAD, { icon: "Plug", label: "vite :5173", text: ":5173", tone: "success" });
    const plain = renderBadge(id);
    expect(plain.getByLabelText("vite :5173").querySelector("svg circle")).toBeNull();
    expect(plain.queryByText(":5173")).toBeNull();
    plain.unmount();

    const withText = renderBadge(id, { showText: true });
    expect(withText.getByText(":5173")).toBeTruthy();
  });

  it("marks a running value for the pulse, and hides a full gauge when asked", () => {
    const { id, handle } = provider();
    handle.set(THREAD, { icon: "Clock", label: "Building", tone: "running" });
    const running = renderBadge(id);
    expect(running.getByLabelText("Building").hasAttribute("data-thread-badges-running")).toBe(true);
    running.unmount();

    handle.set(THREAD, { icon: "TextWrap", label: "All done", fraction: 1 });
    expect(renderBadge(id, { hideWhenComplete: true }).container.childElementCount).toBe(0);
  });

  it("asks the provider for the thread it draws", async () => {
    const asked: string[] = [];
    const id = `test/badge${++providers}`;
    handles.push(
      registry.provide({ id, name: "Test", onWanted: (subjects) => asked.push(...subjects.map((s) => s.id)) }),
    );
    renderBadge(id);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(asked).toEqual([THREAD.id]);
  });
});
