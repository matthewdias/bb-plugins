import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { defaultPrefs, PREFS_CHANGED, type ComplicationPrefs } from "../../badges/complication-prefs";
import { getComplications, type ComplicationProviderHandle } from "../../lib/complications";
// Imported once here, at collection, though every test imports it afresh below. The
// first load pulls in every hugeicons icon through the checkbox, which can outlast a
// test's timeout on a busy machine; Node keeps that package cached, so the per-test
// imports after vi.resetModules re-run only this plugin's own modules.
import "../../badges/complication-settings";

type Prefs = Record<string, ComplicationPrefs>;

const registry = getComplications()!;
const handles: ComplicationProviderHandle[] = [];
afterEach(() => {
  for (const handle of handles.splice(0)) handle.dispose();
});

// The settings store is module scope, shared by every surface in a window. A
// fresh module per test keeps one test's loaded settings out of the next.
beforeEach(() => {
  vi.resetModules();
});

function provide(id = "follow-up/progress") {
  handles.push(
    registry.provide({
      id,
      name: "Follow-up progress",
      description: "How much of a thread's follow-up list is closed.",
      subjects: ["thread"],
      sample: { icon: "TextWrap", label: "3 of 4 follow-ups done", fraction: 0.75, text: "1" },
    }),
  );
}

/** A backend that keeps what it is told, like the real one. */
function backend(initial: Prefs = {}, options: { list?: () => Promise<{ prefs: Prefs }> } = {}) {
  let stored: Prefs = { ...initial };
  return {
    complicationPrefs_list: options.list ?? (async () => ({ prefs: stored })),
    complicationPrefs_set: async ({ id, prefs }: { id: string; prefs: Partial<ComplicationPrefs> }) => {
      stored = { ...stored, [id]: { ...(stored[id] ?? defaultPrefs()), ...prefs } };
      return { prefs: stored };
    },
  };
}

async function renderSettings(rpc: ReturnType<typeof backend>) {
  const { ComplicationSettings } = await import("../../badges/complication-settings");
  const slot = renderSlot({ component: ComplicationSettings }, {}, { rpc: rpc as never });
  const sets = () =>
    slot.inspection.rpcCalls.filter((call) => call.method === "complicationPrefs_set").map((call) => call.input);
  return { slot, sets };
}

describe("ComplicationSettings", () => {
  it("says what would appear here when no plugin is providing anything", async () => {
    const { slot } = await renderSettings(backend());
    expect(slot.getByText(/No plugin is publishing thread complications/)).toBeTruthy();
  });

  it("lists a provider off by default, with its description and a preview", async () => {
    provide();
    const { slot } = await renderSettings(backend());
    const toggle = await waitFor(() => {
      const element = slot.getByRole("checkbox", { name: "Follow-up progress" });
      expect(element.hasAttribute("disabled")).toBe(false);
      return element;
    });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(slot.getByText("How much of a thread's follow-up list is closed.")).toBeTruthy();
    expect(slot.getByLabelText("3 of 4 follow-ups done")).toBeTruthy();
    expect(slot.queryByLabelText("Priority")).toBeNull();
  });

  it("cannot be flipped before your stored settings arrive", async () => {
    provide();
    const { slot, sets } = await renderSettings(backend({}, { list: () => new Promise(() => undefined) }));
    const toggle = slot.getByRole("checkbox", { name: "Follow-up progress" });
    expect(toggle.hasAttribute("disabled")).toBe(true);
    fireEvent.click(toggle);
    expect(sets()).toEqual([]);
  });

  it("turns a provider on, then offers its priority and options", async () => {
    provide();
    const { slot, sets } = await renderSettings(backend());
    const toggle = await waitFor(() => {
      const element = slot.getByRole("checkbox", { name: "Follow-up progress" });
      expect(element.hasAttribute("disabled")).toBe(false);
      return element;
    });
    fireEvent.click(toggle);
    await waitFor(() => expect(slot.getByLabelText("Priority")).toBeTruthy());
    expect(sets()).toEqual([{ id: "follow-up/progress", prefs: { enabled: true } }]);

    fireEvent.click(slot.getByRole("checkbox", { name: "Show its text beside it" }));
    await waitFor(() => expect(sets()).toHaveLength(2));
    expect(sets()[1]).toEqual({ id: "follow-up/progress", prefs: { showText: true } });
  });

  it("commits a priority on blur, and puts back anything that is not a number", async () => {
    provide();
    const { slot, sets } = await renderSettings(
      backend({ "follow-up/progress": { ...defaultPrefs(), enabled: true } }),
    );
    const priority = (await waitFor(() => slot.getByLabelText("Priority"))) as HTMLInputElement;

    fireEvent.change(priority, { target: { value: "" } });
    fireEvent.blur(priority);
    expect(priority.value).toBe(String(defaultPrefs().priority));
    expect(sets()).toEqual([]);

    fireEvent.change(priority, { target: { value: "1" } });
    expect(sets()).toEqual([]);
    fireEvent.keyDown(priority, { key: "Enter" });
    await waitFor(() => expect(sets()).toEqual([{ id: "follow-up/progress", prefs: { priority: 1 } }]));
  });

  it("says so when a change cannot be saved", async () => {
    provide();
    const rpc = backend();
    rpc.complicationPrefs_set = async () => {
      throw new Error("disk full");
    };
    const { slot } = await renderSettings(rpc);
    const toggle = await waitFor(() => {
      const element = slot.getByRole("checkbox", { name: "Follow-up progress" });
      expect(element.hasAttribute("disabled")).toBe(false);
      return element;
    });
    fireEvent.click(toggle);
    await waitFor(() => expect(slot.getByRole("alert").textContent).toMatch(/Could not save: .*disk full/));
  });

  it("re-reads when another window changes a setting", async () => {
    provide();
    const rpc = backend();
    const { slot } = await renderSettings(rpc);
    await waitFor(() => expect(slot.getByRole("checkbox", { name: "Follow-up progress" }).hasAttribute("disabled")).toBe(false));
    await rpc.complicationPrefs_set({ id: "follow-up/progress", prefs: { enabled: true } });
    await slot.behavior.emitRealtime(PREFS_CHANGED, { id: "follow-up/progress" });
    await waitFor(() =>
      expect(slot.getByRole("checkbox", { name: "Follow-up progress" }).getAttribute("aria-checked")).toBe("true"),
    );
  });
});
