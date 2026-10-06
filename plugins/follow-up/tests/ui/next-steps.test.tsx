import { describe, expect, it, vi } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { FollowUpBanner } from "../../src/banner.tsx";
import type { FollowUp, Reason } from "../../lib/followups.ts";
import type { NextOffer } from "../../lib/next-steps.ts";

// The Next row: the agent's offered steps under its reply, one press each, or
// the top follow-up as "Do" when it offered none.

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const AT = "2026-10-06T12:00:00.000Z";

const row = (id: string, text: string, reason: Reason | null): FollowUp => ({
  id,
  text,
  reason,
  file: null,
  detail: null,
  createdAt: AT,
});

const offerOf = (...labels: string[]): NextOffer => ({
  steps: labels.map((label) => ({ label, prompt: `${label} — the full instruction.` })),
  goalMet: false,
  offeredAt: AT,
});

function renderBanner(
  threadId: string,
  {
    rows = [],
    offer = null,
    everRecorded = rows.length > 0,
    isRunning = false,
  }: { rows?: FollowUp[]; offer?: NextOffer | null; everRecorded?: boolean; isRunning?: boolean },
) {
  const state = { offer };
  const handlers = {
    followups_list: async () => ({ followUps: rows, done: [], everRecorded }),
    followups_next_get: async () => ({ offer: state.offer }),
    followups_next_take: async () => {
      state.offer = null;
      return { outcome: "sent" };
    },
    followups_next_keep: async ({ index }: { index: number }) => {
      const kept = state.offer!.steps[index]!;
      state.offer = { ...state.offer!, steps: state.offer!.steps.filter((_, at) => at !== index) };
      return {
        outcome: "added",
        offer: state.offer,
        followUps: [...rows, row("kept", kept.label, "deferred")],
        done: [],
      };
    },
    followups_next_clear: async () => {
      state.offer = null;
      return { ok: true };
    },
    followups_next_do: async () => ({ outcome: "sent" }),
  };
  return renderSlot({ component: FollowUpBanner }, {}, {
    composer: { text: "", mentions: [], scope: { kind: "thread", threadId }, isRunning },
    rpc: handlers as never,
  });
}

type Slot = ReturnType<typeof renderBanner>;
const calls = (slot: Slot, method: string) =>
  slot.inspection.rpcCalls.filter((call) => call.method === method).map((call) => call.input);

describe("the agent's offer", () => {
  it("shows each step as a button under the reply", async () => {
    const slot = renderBanner("thr_offer", { offer: offerOf("Open a PR", "Add a test") });
    const group = await slot.findByRole("group", { name: "Next steps" });
    expect(within(group).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Open a PR",
      "Add a test",
    ]);
  });

  it("a press sends that step, naming the offer it belonged to", async () => {
    const slot = renderBanner("thr_take", { offer: offerOf("Open a PR", "Add a test") });
    fireEvent.click(
      await slot.findByRole("button", { name: 'Send "Add a test — the full instruction."' }),
    );
    await waitFor(() =>
      expect(calls(slot, "followups_next_take")).toEqual([
        { threadId: "thr_take", offeredAt: AT, index: 1 },
      ]),
    );
    await waitFor(() => expect(slot.queryByRole("group", { name: "Next steps" })).toBeNull());
  });

  it("⌥-click puts the step in the composer instead of sending it", async () => {
    const slot = renderBanner("thr_edit", { offer: offerOf("Open a PR") });
    fireEvent.click(
      await slot.findByRole("button", { name: 'Send "Open a PR — the full instruction."' }),
      { altKey: true },
    );
    expect(slot.inspection.composer.text).toContain("Open a PR — the full instruction.");
    expect(slot.inspection.composer.focusCount).toBeGreaterThan(0);
    expect(calls(slot, "followups_next_take")).toEqual([]);
  });

  it("holding a chip on a touch screen edits instead of sending", async () => {
    const slot = renderBanner("thr_hold", { offer: offerOf("Open a PR") });
    const chip = await slot.findByRole("button", {
      name: 'Send "Open a PR — the full instruction."',
    });
    fireEvent.pointerDown(chip, { pointerType: "touch" });
    await new Promise((resolve) => setTimeout(resolve, 550));
    fireEvent.pointerUp(chip, { pointerType: "touch" });
    fireEvent.click(chip);
    expect(slot.inspection.composer.text).toContain("Open a PR — the full instruction.");
    expect(calls(slot, "followups_next_take")).toEqual([]);
  });

  it("a step can be kept as a follow-up from the ⋯ menu", async () => {
    const slot = renderBanner("thr_keep", { offer: offerOf("Open a PR", "Add a test") });
    fireEvent.keyDown(await slot.findByRole("button", { name: "More next-step actions" }), {
      key: "Enter",
    });
    fireEvent.click(await slot.findByRole("menuitem", { name: 'Keep "Open a PR" as a follow-up' }));
    await waitFor(() =>
      expect(calls(slot, "followups_next_keep")).toEqual([
        { threadId: "thr_keep", offeredAt: AT, index: 0 },
      ]),
    );
    const group = await slot.findByRole("group", { name: "Next steps" });
    await waitFor(() =>
      expect(within(group).getAllByRole("button").map((button) => button.textContent)).toEqual([
        "Add a test",
      ]),
    );
    expect(await within(slot.getByRole("list")).findByText("Open a PR")).toBeDefined();
  });

  it("is not shown while a turn runs", async () => {
    const slot = renderBanner("thr_running", {
      rows: [row("r1", "Tidy the loader", "deferred")],
      offer: offerOf("Open a PR"),
      isRunning: true,
    });
    await slot.findByText("Tidy the loader");
    expect(slot.queryByRole("group", { name: "Next steps" })).toBeNull();
  });

  it("is worth the card on a thread that never recorded a follow-up", async () => {
    const slot = renderBanner("thr_fresh", { offer: offerOf("Open a PR") });
    await slot.findByRole("group", { name: "Next steps" });
    expect(slot.queryByRole("button", { name: /follow-up list/ })).toBeNull();
    expect(slot.queryByText("Nothing outstanding on this thread.")).toBeNull();
  });
});

describe("Do, when the agent offered nothing", () => {
  const top = row("r1", "Tidy the loader", "deferred");

  it("offers the top follow-up, and a press hands it over", async () => {
    const slot = renderBanner("thr_do", { rows: [top, row("r2", "Rename the flag", "cleanup")] });
    fireEvent.click(await slot.findByRole("button", { name: 'Do "Tidy the loader" now' }));
    await waitFor(() =>
      expect(calls(slot, "followups_next_do")).toEqual([{ threadId: "thr_do", id: "r1" }]),
    );
  });

  it("is not offered beside the agent's own steps", async () => {
    const slot = renderBanner("thr_do_offer", { rows: [top], offer: offerOf("Open a PR") });
    await slot.findByRole("button", { name: 'Send "Open a PR — the full instruction."' });
    expect(slot.queryByRole("button", { name: 'Do "Tidy the loader" now' })).toBeNull();
  });

  it("is not offered for an out-of-scope row, which leads with a handoff", async () => {
    const slot = renderBanner("thr_do_away", {
      rows: [row("r1", "Move the docs site", "out-of-scope"), top],
    });
    await slot.findByText("Move the docs site");
    expect(slot.queryByRole("group", { name: "Next steps" })).toBeNull();
  });
});

describe("with the list cleared", () => {
  it("drops Suggest when the agent has already offered what is next", async () => {
    const slot = renderBanner("thr_cleared_offer", { everRecorded: true, offer: offerOf("Open a PR") });
    await slot.findByText("Nothing outstanding on this thread.");
    await slot.findByRole("group", { name: "Next steps" });
    expect(slot.queryByRole("button", { name: /Suggest what/ })).toBeNull();
  });

  it("keeps Suggest when nothing was offered", async () => {
    const slot = renderBanner("thr_cleared", { everRecorded: true });
    await slot.findByRole("button", { name: /Suggest what/ });
  });
});
