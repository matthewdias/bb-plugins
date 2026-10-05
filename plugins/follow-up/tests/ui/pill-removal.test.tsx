import { describe, expect, it } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { ComposerMention } from "@get-bb/plugin-sdk/app";
import { FollowUpBanner } from "../../src/banner.tsx";
import { FollowUpPanel } from "../../src/panel.tsx";
import type { FollowUp } from "../../lib/followups.ts";

// Your own done or dismiss takes the row's pill out of the draft, so sending it
// cannot hand the agent a row that is gone. Nothing else may edit the draft.

const row = (id: string, text: string): FollowUp => ({
  id,
  text,
  reason: null,
  file: null,
  detail: null,
  createdAt: "2026-10-01T00:00:00.000Z",
});

/** A draft holding a pill for each row, in order, between words. */
function draftWith(threadId: string, rows: FollowUp[]) {
  let text = "please";
  const mentions: ComposerMention[] = [];
  for (const entry of rows) {
    text += " ";
    mentions.push({
      kind: "plugin",
      pluginId: "follow-up",
      provider: "follow-up",
      id: `${threadId}.${entry.id}`,
      label: entry.text,
      from: text.length,
      to: text.length + entry.text.length,
    });
    text += entry.text;
  }
  return { text: `${text} today`, mentions };
}

/** The server's lists, which a test moves as it acts on rows. */
function server(rows: FollowUp[]) {
  const state = { open: [...rows], done: [] as FollowUp[] };
  const lists = () => ({ followUps: state.open, done: state.done });
  const handlers = {
    followups_list: async () => ({ ...lists(), everRecorded: true }),
    followups_done: async ({ id, done }: { id: string; done: boolean }) => {
      const target = [...state.open, ...state.done].find((entry) => entry.id === id)!;
      state.open = state.open.filter((entry) => entry.id !== id);
      state.done = state.done.filter((entry) => entry.id !== id);
      if (done) state.done.push({ ...target, doneAt: "2026-10-02T00:00:00.000Z" });
      else state.open.push(target);
      return lists();
    },
    followups_dismiss: async ({ id }: { id: string }) => {
      state.open = state.open.filter((entry) => entry.id !== id);
      state.done = state.done.filter((entry) => entry.id !== id);
      return lists();
    },
  };
  return { state, handlers: handlers as never };
}

function renderBanner(threadId: string, rows: FollowUp[]) {
  const backend = server(rows);
  const slot = renderSlot({ component: FollowUpBanner }, {}, {
    composer: { ...draftWith(threadId, rows), scope: { kind: "thread", threadId } },
    rpc: backend.handlers,
  });
  return { slot, backend };
}

const pillIds = (slot: ReturnType<typeof renderSlot>) =>
  slot.inspection.composer.draft.mentions.map((mention) => (mention as { id: string }).id);

/** The banner keeps Done and Dismiss in each row's ⋯ menu. */
const menuTrigger = (slot: ReturnType<typeof renderSlot>, text: string) =>
  slot.findByRole("button", { name: `More actions for "${text}"` });

async function pickFromRowMenu(slot: ReturnType<typeof renderSlot>, text: string, item: string) {
  fireEvent.keyDown(await menuTrigger(slot, text), { key: "Enter" });
  fireEvent.click(await slot.findByRole("menuitem", { name: item }));
}

describe("the banner's own done and dismiss", () => {
  it("marking a row done removes its pill and leaves the others", async () => {
    const first = row("r1", "Fix the flaky test");
    const second = row("r2", "Update the docs");
    const { slot } = renderBanner("thr_done", [first, second]);
    await pickFromRowMenu(slot, first.text, `Mark "${first.text}" done`);
    await waitFor(() => expect(pillIds(slot)).toEqual(["thr_done.r2"]));
    expect(slot.inspection.composer.text).toBe(`please ${second.text} today`);
  });

  it("dismissing a row removes its pill", async () => {
    const only = row("r1", "Fix the flaky test");
    const { slot } = renderBanner("thr_dismiss", [only]);
    await pickFromRowMenu(
      slot,
      only.text,
      `Dismiss "${only.text}" — it will not be recorded again on this thread`,
    );
    await waitFor(() => expect(pillIds(slot)).toEqual([]));
    expect(slot.inspection.composer.text).toBe("please today");
  });

  it("a row that leaves through realtime keeps its pill in the draft", async () => {
    const only = row("r1", "Fix the flaky test");
    const { slot, backend } = renderBanner("thr_realtime", [only]);
    await menuTrigger(slot, only.text);
    // An agent's complete_follow_up, the CLI or another window: the server
    // moves the row and announces it; this banner did nothing itself.
    backend.state.done = [{ ...only, doneAt: "2026-10-02T00:00:00.000Z" }];
    backend.state.open = [];
    await slot.behavior.emitRealtime("followups-changed", { threadId: "thr_realtime" });
    await waitFor(() =>
      expect(slot.queryByRole("button", { name: `More actions for "${only.text}"` })).toBeNull(),
    );
    expect(pillIds(slot)).toEqual(["thr_realtime.r1"]);
  });
});

describe("the panel's own done and dismiss", () => {
  function renderPanel(threadId: string, rows: FollowUp[]) {
    const backend = server(rows);
    const slot = renderSlot({ component: FollowUpPanel }, { threadId }, {
      composer: { ...draftWith(threadId, rows), scope: { kind: "thread", threadId } },
      rpc: backend.handlers,
    });
    return { slot, backend };
  }

  it("marking a row done removes its pill", async () => {
    const only = row("r1", "Fix the flaky test");
    const { slot } = renderPanel("thr_panel_done", [only]);
    fireEvent.click(await slot.findByRole("button", { name: `Mark "${only.text}" done` }));
    await waitFor(() => expect(pillIds(slot)).toEqual([]));
  });

  it("dismissing a row removes its pill", async () => {
    const only = row("r1", "Fix the flaky test");
    const { slot } = renderPanel("thr_panel_dismiss", [only]);
    fireEvent.click(await slot.findByRole("button", { name: `Dismiss "${only.text}"` }));
    await waitFor(() => expect(pillIds(slot)).toEqual([]));
  });

  it("a row that leaves through realtime keeps its pill in the draft", async () => {
    const only = row("r1", "Fix the flaky test");
    const { slot, backend } = renderPanel("thr_panel_realtime", [only]);
    await slot.findByRole("button", { name: `Mark "${only.text}" done` });
    backend.state.done = [{ ...only, doneAt: "2026-10-02T00:00:00.000Z" }];
    backend.state.open = [];
    await slot.behavior.emitRealtime("followups-changed", { threadId: "thr_panel_realtime" });
    await waitFor(() =>
      expect(slot.queryByRole("button", { name: `Mark "${only.text}" done` })).toBeNull(),
    );
    expect(pillIds(slot)).toEqual(["thr_panel_realtime.r1"]);
  });
});

describe("in-the-composer marks read the pill, not its label", () => {
  // The pill was inserted before the row was amended, so its label is stale.
  const amended = row("r1", "Fix the flaky auth test");
  const stale = { ...draftWith("thr_mark", [row("r1", "Fix the test")]) };

  it("the banner row reads as inserted", async () => {
    const slot = renderSlot({ component: FollowUpBanner }, {}, {
      composer: { ...stale, scope: { kind: "thread", threadId: "thr_mark" } },
      rpc: server([amended]).handlers,
    });
    expect(
      await slot.findByRole("button", { name: `"${amended.text}" is already in the composer` }),
    ).toBeDefined();
  });

  it("the panel shows its in-the-composer mark", async () => {
    const slot = renderSlot({ component: FollowUpPanel }, { threadId: "thr_mark" }, {
      composer: { ...stale, scope: { kind: "thread", threadId: "thr_mark" } },
      rpc: server([amended]).handlers,
    });
    expect(await slot.findByText("In the composer")).toBeDefined();
  });
});
