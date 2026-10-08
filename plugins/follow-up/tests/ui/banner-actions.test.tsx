import { describe, expect, it, vi } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { toast } from "sonner";
import { FollowUpBanner } from "../../src/banner.tsx";
import type { FollowUp, Reason } from "../../lib/followups.ts";

// Each banner row shows one action inline, chosen by its reason, and keeps the
// rest in a ⋯ menu, the way bb's Queue card lays out its rows. Editing the text
// happens in place.

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const row = (id: string, text: string, reason: Reason | null): FollowUp => ({
  id,
  text,
  reason,
  file: null,
  detail: null,
  createdAt: "2026-10-01T00:00:00.000Z",
});

/** A server holding the rows; `amendOutcome` decides how an edit is answered. */
function renderBanner(threadId: string, rows: FollowUp[], amendOutcome = "amended") {
  const state = { open: [...rows] };
  const lists = () => ({ followUps: state.open, done: [] });
  const handlers = {
    followups_list: async () => ({ ...lists(), everRecorded: true }),
    followups_amend: async ({ id, text }: { id: string; text: string }) => {
      if (amendOutcome === "amended") {
        state.open = state.open.map((entry) => (entry.id === id ? { ...entry, text } : entry));
      }
      return { outcome: amendOutcome, ...lists() };
    },
  };
  const slot = renderSlot({ component: FollowUpBanner }, {}, {
    composer: { text: "", mentions: [], scope: { kind: "thread", threadId } },
    rpc: handlers as never,
  });
  return slot;
}

type Slot = ReturnType<typeof renderSlot>;

async function openMenu(slot: Slot, text: string) {
  fireEvent.keyDown(await slot.findByRole("button", { name: `More actions for "${text}"` }), {
    key: "Enter",
  });
  await slot.findByRole("menu");
}

const menuItems = (slot: Slot) =>
  slot.getAllByRole("menuitem").map((item) => item.textContent?.trim());

const amendCalls = (slot: Slot) =>
  slot.inspection.rpcCalls.filter((call) => call.method === "followups_amend");

describe("each row's one inline action", () => {
  const away = row("r1", "Move the docs site", "out-of-scope");
  const later = row("r2", "Tidy the config loader", "deferred");
  const mine = row("r3", "Ask about the release date", null);

  it("an out-of-scope row leads with Hand off", async () => {
    const slot = renderBanner("thr_main", [away, later, mine]);
    await slot.findByRole("button", { name: `Hand off "${away.text}" in a new thread` });
    expect(slot.queryByRole("button", { name: `Put "${away.text}" in the composer` })).toBeNull();
  });

  it("every other row leads with Put in composer", async () => {
    const slot = renderBanner("thr_main2", [away, later, mine]);
    for (const entry of [later, mine]) {
      await slot.findByRole("button", { name: `Put "${entry.text}" in the composer` });
      expect(
        slot.queryByRole("button", { name: `Hand off "${entry.text}" in a new thread` }),
      ).toBeNull();
    }
  });

  it("a cleanup row leads with Put in composer too, until there is a Queue action", async () => {
    const tidy = row("r4", "Delete the old fixtures", "cleanup");
    const slot = renderBanner("thr_cleanup", [tidy]);
    await slot.findByRole("button", { name: `Put "${tidy.text}" in the composer` });
  });
});

describe("the ⋯ menu", () => {
  it("offers the action the row does not show inline, and the rest", async () => {
    const away = row("r1", "Move the docs site", "out-of-scope");
    const slot = renderBanner("thr_menu", [away]);
    await openMenu(slot, away.text);
    expect(menuItems(slot)).toEqual([
      "Put in composer",
      "Edit",
      "Describe in more detail",
      "Open in the panel",
      // No destinations set up in this render: the way to set one up.
      "Set up where to file…",
      "Mark done",
      "Dismiss",
    ]);
  });

  it("offers Hand off on a row that leads with Put in composer", async () => {
    const later = row("r2", "Tidy the config loader", "deferred");
    const slot = renderBanner("thr_menu2", [later]);
    await openMenu(slot, later.text);
    expect(menuItems(slot)).toContain("Hand off…");
    expect(menuItems(slot)).not.toContain("Put in composer");
  });
});

describe("editing a row in place", () => {
  const later = row("r2", "Tidy the config loader", "deferred");

  async function startEditing(slot: Slot) {
    await openMenu(slot, later.text);
    fireEvent.click(slot.getByRole("menuitem", { name: `Edit "${later.text}"` }));
    return slot.findByRole("textbox", { name: `Edit "${later.text}"` });
  }

  it("Enter saves the new text", async () => {
    const slot = renderBanner("thr_edit", [later]);
    const field = await startEditing(slot);
    fireEvent.change(field, { target: { value: "Tidy the config loader and its tests" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() =>
      expect(amendCalls(slot).map((call) => call.input)).toEqual([
        { threadId: "thr_edit", id: "r2", text: "Tidy the config loader and its tests" },
      ]),
    );
    // In the list: the Next row above it offers the same row as "Do".
    expect(
      await within(slot.getByRole("list")).findByText("Tidy the config loader and its tests"),
    ).toBeDefined();
  });

  it("Escape puts the text back without saving", async () => {
    const slot = renderBanner("thr_escape", [later]);
    const field = await startEditing(slot);
    fireEvent.change(field, { target: { value: "Something else" } });
    fireEvent.keyDown(field, { key: "Escape" });
    expect(await within(slot.getByRole("list")).findByText(later.text)).toBeDefined();
    expect(slot.queryByRole("textbox")).toBeNull();
    expect(amendCalls(slot)).toEqual([]);
  });

  it("leaving the text unchanged saves nothing", async () => {
    const slot = renderBanner("thr_same", [later]);
    const field = await startEditing(slot);
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(slot.queryByRole("textbox")).toBeNull());
    expect(amendCalls(slot)).toEqual([]);
  });

  it("a row being edited shows no detail tooltip", async () => {
    const detailed = { ...later, id: "r5", detail: "The loader reads three files and caches none." };
    const slot = renderBanner("thr_peek", [detailed]);
    await openMenu(slot, detailed.text);
    fireEvent.click(slot.getByRole("menuitem", { name: `Edit "${detailed.text}"` }));
    const field = await slot.findByRole("textbox", { name: `Edit "${detailed.text}"` });
    fireEvent.mouseEnter(field.closest("li")!);
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(slot.queryByRole("tooltip")).toBeNull();
  });

  it("a refused edit says why", async () => {
    vi.mocked(toast.error).mockClear();
    const slot = renderBanner("thr_refused", [later], "duplicate");
    const field = await startEditing(slot);
    fireEvent.change(field, { target: { value: "Something already recorded" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Another follow-up on this thread already says that.",
      ),
    );
  });
});

describe("the header", () => {
  it("reads like bb's Queue card: a label and a count", async () => {
    const slot = renderBanner("thr_header", [
      row("r1", "One", null),
      row("r2", "Two", "risk"),
    ]);
    const toggle = (await slot.findAllByRole("button", { name: "Hide the follow-up list" }))[0]!;
    expect(toggle.textContent).toContain("Follow-ups");
    expect(toggle.textContent).toContain("2");
  });
});
