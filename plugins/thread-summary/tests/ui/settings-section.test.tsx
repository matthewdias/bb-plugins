import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
// Imported once here, at collection, though every test imports it afresh
// below: the first load pulls in every hugeicons icon through the checkbox,
// which can outlast a test's timeout on a busy machine (#18).
import "../../src/settings-section";
import { GIT_ID, PULL_REQUEST_ID } from "../../lib/order";
import { disposeProviders, hiddenBackend, provide } from "./fixtures";

afterEach(() => {
  disposeProviders();
});

// The hidden list is module scope, shared by every surface in a window. A
// fresh module per test keeps one test's loaded list out of the next.
beforeEach(() => {
  vi.resetModules();
});

async function render(rpc = hiddenBackend()) {
  const { HiddenProvidersSettings } = await import("../../src/settings-section");
  const slot = renderSlot({ component: HiddenProvidersSettings }, {}, { rpc: rpc as never });
  const sets = () =>
    slot.inspection.rpcCalls.filter((call) => call.method === "hiddenProviders_set").map((call) => call.input);
  return { slot, sets };
}

describe("Hidden providers", () => {
  it("says so when no plugin publishes anything", async () => {
    const { slot } = await render();
    expect(slot.getByText(/No plugin is publishing thread complications/)).toBeTruthy();
  });

  it("lists live providers, Git and the PR first, each shown until hidden", async () => {
    provide({ id: "follow-up/progress", name: "Follow-up progress" }, {});
    provide({ id: GIT_ID, name: "Git" }, {});
    provide({ id: PULL_REQUEST_ID, name: "Pull request" }, {});
    const { slot } = await render();
    const boxes = await waitFor(() => {
      const found = slot.getAllByRole("checkbox");
      expect(found.every((box) => !box.hasAttribute("disabled"))).toBe(true);
      return found;
    });
    expect(boxes.map((box) => box.getAttribute("aria-label"))).toEqual([
      "Hide Git",
      "Hide Pull request",
      "Hide Follow-up progress",
    ]);
    expect(boxes.every((box) => box.getAttribute("aria-checked") === "false")).toBe(true);
  });

  it("shows what is stored as hidden, and hides and shows on a tick", async () => {
    provide({ id: GIT_ID, name: "Git" }, {});
    provide({ id: "follow-up/progress", name: "Follow-up progress" }, {});
    const { slot, sets } = await render(hiddenBackend(["follow-up/progress"]));
    await waitFor(() =>
      expect(slot.getByRole("checkbox", { name: "Hide Follow-up progress" }).getAttribute("aria-checked")).toBe("true"),
    );
    fireEvent.click(slot.getByRole("checkbox", { name: "Hide Git" }));
    fireEvent.click(slot.getByRole("checkbox", { name: "Hide Follow-up progress" }));
    await waitFor(() =>
      expect(sets()).toEqual([
        { id: GIT_ID, hidden: true },
        { id: "follow-up/progress", hidden: false },
      ]),
    );
  });

  it("cannot be ticked before the stored list arrives", async () => {
    provide({ id: GIT_ID, name: "Git" }, {});
    const { slot } = await render({ ...hiddenBackend(), hiddenProviders_list: () => new Promise(() => undefined) } as never);
    expect(slot.getByRole("checkbox", { name: "Hide Git" }).hasAttribute("disabled")).toBe(true);
  });
});
