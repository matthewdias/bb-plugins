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

const offerOf = (...steps: string[]): NextOffer => ({ steps, goalMet: false, offeredAt: AT });

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
        followUps: [...rows, row("kept", kept, "deferred")],
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

  it("never truncates a step: all of what a press sends is on screen", async () => {
    const long = "Open a PR for this branch against main and request a review";
    const slot = renderBanner("thr_whole", { offer: offerOf(long) });
    const chip = await slot.findByRole("button", { name: `Send "${long}"` });
    expect(chip.textContent).toBe(long);
    // Wraps onto more lines instead: never clipped, never cut with an ellipsis.
    expect(chip.className).toMatch(/\bwhitespace-normal\b/);
    expect(chip.className).not.toMatch(/\btruncate\b|whitespace-nowrap|max-w-\[/);
    expect(chip.querySelector(".truncate")).toBeNull();
  });

  it("wraps onto a second line rather than scrolling steps off the edge", async () => {
    // Scrolling sideways left a step half off a phone's screen, with "Next"
    // scrolled away: hidden text by another route.
    const slot = renderBanner("thr_wrap", { offer: offerOf("Open a PR", "Add a test", "Bump the version") });
    const group = await slot.findByRole("group", { name: "Next steps" });
    expect(group.className).toMatch(/\bflex-wrap\b/);
    expect(group.className).not.toMatch(/overflow-x-(auto|scroll)/);
  });

  it("every chip looks pressable, not only the first", async () => {
    const slot = renderBanner("thr_edges", { offer: offerOf("Open a PR", "Add a test") });
    const second = await slot.findByRole("button", { name: 'Send "Add a test"' });
    // A ghost button beside a filled one read as plain text on a phone.
    expect(second.className).toMatch(/\bborder\b/);
  });

  it("the ⋯ menu quotes each step whole, under its action", async () => {
    const long = "Merge PR #33, then start phase 2 of the destinations work";
    const slot = renderBanner("thr_menu_whole", { offer: offerOf("Open a PR", long) });
    fireEvent.keyDown(await slot.findByRole("button", { name: "More next-step actions" }), {
      key: "Enter",
    });
    const item = await slot.findByRole("menuitem", { name: `Keep "${long}" as a follow-up` });
    expect(item.textContent).toContain(long);
    expect(item.querySelector(".truncate")).toBeNull();
  });

  it("a press sends that step, naming the offer it belonged to", async () => {
    const slot = renderBanner("thr_take", { offer: offerOf("Open a PR", "Add a test") });
    fireEvent.click(
      await slot.findByRole("button", { name: 'Send "Add a test"' }),
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
      await slot.findByRole("button", { name: 'Send "Open a PR"' }),
      { altKey: true },
    );
    expect(slot.inspection.composer.text).toContain("Open a PR");
    expect(slot.inspection.composer.focusCount).toBeGreaterThan(0);
    expect(calls(slot, "followups_next_take")).toEqual([]);
  });

  it("holding a chip on a touch screen edits instead of sending", async () => {
    const slot = renderBanner("thr_hold", { offer: offerOf("Open a PR") });
    const chip = await slot.findByRole("button", { name: 'Send "Open a PR"' });
    fireEvent.pointerDown(chip, { pointerType: "touch" });
    await new Promise((resolve) => setTimeout(resolve, 550));
    fireEvent.pointerUp(chip, { pointerType: "touch" });
    fireEvent.click(chip);
    expect(slot.inspection.composer.text).toContain("Open a PR");
    expect(calls(slot, "followups_next_take")).toEqual([]);
  });

  it("a few pixels of jitter still count as holding", async () => {
    const slot = renderBanner("thr_jitter", { offer: offerOf("Open a PR") });
    const chip = await slot.findByRole("button", { name: 'Send "Open a PR"' });
    fireEvent.pointerDown(chip, { pointerType: "touch", clientX: 20, clientY: 10 });
    fireEvent.pointerMove(chip, { pointerType: "touch", clientX: 26, clientY: 13 });
    await new Promise((resolve) => setTimeout(resolve, 550));
    fireEvent.pointerUp(chip, { pointerType: "touch" });
    expect(slot.inspection.composer.text).toContain("Open a PR");
  });

  it("dragging across the row to scroll it neither edits nor sends", async () => {
    // A phone scrolls the Next row sideways by dragging a chip. A slow drag
    // used to outlast the hold and put the step in the composer.
    const slot = renderBanner("thr_drag", { offer: offerOf("Open a PR", "Add a test") });
    const chip = await slot.findByRole("button", { name: 'Send "Open a PR"' });
    fireEvent.pointerDown(chip, { pointerType: "touch", clientX: 120, clientY: 10 });
    fireEvent.pointerMove(chip, { pointerType: "touch", clientX: 60, clientY: 12 });
    await new Promise((resolve) => setTimeout(resolve, 550));
    fireEvent.pointerUp(chip, { pointerType: "touch" });
    // Should a browser still deliver a click at the end of the drag.
    fireEvent.click(chip);
    expect(slot.inspection.composer.text).toBe("");
    expect(calls(slot, "followups_next_take")).toEqual([]);
  });

  it("the row scrolling gives up on a hold, even with no pointer movement reported", async () => {
    const slot = renderBanner("thr_scroll", { offer: offerOf("Open a PR", "Add a test") });
    const chip = await slot.findByRole("button", { name: 'Send "Open a PR"' });
    fireEvent.pointerDown(chip, { pointerType: "touch", clientX: 120, clientY: 10 });
    fireEvent.scroll(slot.getByRole("group", { name: "Next steps" }));
    await new Promise((resolve) => setTimeout(resolve, 550));
    fireEvent.pointerUp(chip, { pointerType: "touch" });
    fireEvent.click(chip);
    expect(slot.inspection.composer.text).toBe("");
    expect(calls(slot, "followups_next_take")).toEqual([]);
  });

  it("the browser taking the touch to scroll gives up on a hold", async () => {
    const slot = renderBanner("thr_cancel", { offer: offerOf("Open a PR") });
    const chip = await slot.findByRole("button", { name: 'Send "Open a PR"' });
    fireEvent.pointerDown(chip, { pointerType: "touch", clientX: 120, clientY: 10 });
    fireEvent.pointerCancel(chip, { pointerType: "touch" });
    await new Promise((resolve) => setTimeout(resolve, 550));
    expect(slot.inspection.composer.text).toBe("");
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

  it("shows the start of a long row, with all of it on hover", async () => {
    const long = row(
      "r1",
      "Fix Graveyard restore: reinstall store plugins through the store and say what Restore will install",
      "deferred",
    );
    const slot = renderBanner("thr_do_long", { rows: [long] });
    const chip = await slot.findByRole("button", { name: `Do "${long.text}" now` });
    expect(chip.textContent).toBe("Do: Fix Graveyard restore…");
    expect(chip.parentElement?.getAttribute("title")).toContain(long.text);
  });

  it("marks the row it stands for while it is pointed at", async () => {
    const slot = renderBanner("thr_do_lit", { rows: [top, row("r2", "Rename the flag", "cleanup")] });
    const chip = await slot.findByRole("button", { name: 'Do "Tidy the loader" now' });
    const rowOf = (text: string) =>
      within(slot.getByRole("list")).getByText(text).closest("[data-highlighted]");
    expect(rowOf("Tidy the loader")).toBeNull();
    fireEvent.mouseEnter(chip.parentElement!);
    await waitFor(() => expect(rowOf("Tidy the loader")).not.toBeNull());
    expect(rowOf("Rename the flag")).toBeNull();
    fireEvent.mouseLeave(chip.parentElement!);
    await waitFor(() => expect(rowOf("Tidy the loader")).toBeNull());
  });

  it("is not offered beside the agent's own steps", async () => {
    const slot = renderBanner("thr_do_offer", { rows: [top], offer: offerOf("Open a PR") });
    await slot.findByRole("button", { name: 'Send "Open a PR"' });
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
