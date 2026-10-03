import { describe, expect, it } from "vitest";
import { loadPluginApp } from "@get-bb/plugin-sdk/testing/app";
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
    const app = await loadPluginApp(() => import("../../app.tsx"));
    // The harness collects commands untyped; only the ids are read here.
    const registered = (app as unknown as { commandPaletteActions: { id: string }[] })
      .commandPaletteActions.map((command) => command.id);
    expect(registered).toEqual(["toggle-followups", "open-followups-panel", "open-handoff-panel"]);
  });

  it("offers the + menu row only while there are rows behind a collapsed banner", async () => {
    const app = await loadPluginApp(() => import("../../app.tsx"));
    const item = app.composerCustomizations[0]?.plusMenu?.find((entry) => entry.id === "show-followups");
    const disabled = item?.disabled;
    expect(typeof disabled).toBe("function");
    const isDisabled = (threadId: string) =>
      (disabled as (composer: PluginComposerApi) => boolean)(composerFor(threadId));

    expect(isDisabled("thr_plus_empty")).toBe(true);
    setRows("thr_plus_rows", [row]);
    setCollapsed("thr_plus_rows", false);
    expect(isDisabled("thr_plus_rows")).toBe(true);
    setCollapsed("thr_plus_rows", true);
    expect(isDisabled("thr_plus_rows")).toBe(false);
  });
});
