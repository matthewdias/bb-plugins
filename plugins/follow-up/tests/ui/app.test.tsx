import { describe, expect, it } from "vitest";
import { loadPluginApp } from "@get-bb/plugin-sdk/testing/app";
// Loaded at the top, not inside a test: the first load pulls in every hugeicons icon,
// which can take longer than a test's 5s timeout on a busy machine.
import pluginApp from "../../app.tsx";
import type { PluginComposerApi } from "@get-bb/plugin-sdk/app";
import { setCollapsed, setRows } from "../../src/store.ts";
import type { FollowUp } from "../../lib/followups.ts";

const row: FollowUp = {
  id: "r1",
  text: "Fix the flaky test",
  reason: null,
  file: null,
  detail: null,
  createdAt: "2026-10-01T00:00:00.000Z",
};

const composerFor = (threadId: string) =>
  ({ scope: { kind: "thread", threadId } }) as unknown as PluginComposerApi;

describe("app.tsx", () => {
  it("registers the palette commands", async () => {
    const app = await loadPluginApp(pluginApp);
    // The harness collects commands untyped; only the ids are read here.
    const registered = (app as unknown as { commandPaletteActions: { id: string }[] })
      .commandPaletteActions.map((command) => command.id);
    expect(registered).toEqual([
      "toggle-followups",
      "open-followups-panel",
      "open-handoff-panel",
      "take-next-step-1",
      "take-next-step-2",
      "take-next-step-3",
      "record-draft",
      "insert-followup",
    ]);
  });

  it("offers the + menu row whenever the thread has open rows, banner open or not", async () => {
    const app = await loadPluginApp(pluginApp);
    const item = app.composerCustomizations[0]?.plusMenu?.find((entry) => entry.id === "show-followups");
    const disabled = item?.disabled;
    expect(typeof disabled).toBe("function");
    const isDisabled = (threadId: string) =>
      (disabled as (composer: PluginComposerApi) => boolean)(composerFor(threadId));

    expect(isDisabled("thr_plus_empty")).toBe(true);
    setRows("thr_plus_done_only", [], [row]);
    expect(isDisabled("thr_plus_done_only")).toBe(true);
    setRows("thr_plus_rows", [row]);
    setCollapsed("thr_plus_rows", false);
    expect(isDisabled("thr_plus_rows")).toBe(false);
    setCollapsed("thr_plus_rows", true);
    expect(isDisabled("thr_plus_rows")).toBe(false);
  });
});
