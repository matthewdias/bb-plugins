import { describe, expect, it, vi } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { toast } from "sonner";
import { FollowUpBanner } from "../../src/banner.tsx";
import { FollowUpPanel } from "../../src/panel.tsx";
import type { Destination } from "../../lib/destinations.ts";
import type { FollowUp } from "../../lib/followups.ts";

// Filing from the card and the panel: File to in a row's menu, File all in the
// header, and what a row says while it is on its way.

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const NOW = new Date().toISOString();
const row = (id: string, text: string, extra: Partial<FollowUp> = {}): FollowUp => ({
  id,
  text,
  reason: "deferred",
  file: null,
  detail: null,
  createdAt: NOW,
  ...extra,
});
const gh: Destination = { id: "github", name: "GitHub", kind: "command", command: "gh issue create" };
const jira: Destination = { id: "jira-eng", name: "Jira ENG", kind: "agent", recipe: "File it." };

function handlers(rows: FollowUp[], state: { destinations: Destination[]; defaultId: string | null }, fileOutcome = "started") {
  return {
    followups_list: async () => ({ followUps: rows, done: [], everRecorded: true }),
    followups_next_get: async () => ({ offer: null }),
    followups_destinations: async () => state,
    followups_file: async ({ ids }: { ids: string[] | null }) => ({
      outcome: fileOutcome,
      destinationId: "github",
      count: ids?.length ?? rows.length,
    }),
  };
}

type State = { destinations: Destination[]; defaultId: string | null };

function renderBanner(
  threadId: string,
  rows: FollowUp[],
  state: State = { destinations: [gh, jira], defaultId: "jira-eng" },
  fileOutcome = "started",
) {
  return renderSlot({ component: FollowUpBanner }, {}, {
    composer: { text: "", mentions: [], scope: { kind: "thread", threadId } },
    rpc: handlers(rows, state, fileOutcome) as never,
  });
}

type Slot = ReturnType<typeof renderBanner>;
const fileCalls = (slot: Slot) =>
  slot.inspection.rpcCalls.filter((call) => call.method === "followups_file").map((call) => call.input);
const openMenu = async (slot: Slot, name: string) => {
  fireEvent.keyDown(await slot.findByRole("button", { name }), { key: "Enter" });
  return slot.findByRole("menu");
};

describe("filing from the card", () => {
  const tidy = row("r1", "Tidy the loader");

  it("a row's menu files it to any destination, the project's default first", async () => {
    const slot = renderBanner("thr_row_file", [tidy]);
    const menu = await openMenu(slot, `More actions for "${tidy.text}"`);
    await waitFor(() => expect(within(menu).queryByText("File to Jira ENG")).not.toBeNull());
    const labels = within(menu)
      .getAllByRole("menuitem")
      .map((item) => item.textContent?.trim())
      .filter((text) => text?.startsWith("File to"));
    expect(labels).toEqual(["File to Jira ENG", "File to GitHub"]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: `File "${tidy.text}" to GitHub` }));
    await waitFor(() =>
      expect(fileCalls(slot)).toEqual([{ threadId: "thr_row_file", ids: ["r1"], destinationId: "github" }]),
    );
  });

  it("with no destinations, the menu offers to set one up, in the panel", async () => {
    const slot = renderBanner("thr_row_setup", [tidy], { destinations: [], defaultId: null });
    const menu = await openMenu(slot, `More actions for "${tidy.text}"`);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Set up where follow-ups can be filed" }));
    expect(slot.inspection.navigateCalls).toContainEqual({
      method: "openThreadPanel",
      options: { actionId: "followups", params: { destinations: true } },
    });
  });

  it("File all is a menu: opening it files nothing; choosing where does", async () => {
    const slot = renderBanner("thr_file_all", [tidy, row("r2", "Rename the flag")]);
    const menu = await openMenu(slot, "File all follow-ups…");
    expect(fileCalls(slot)).toEqual([]);
    await waitFor(() =>
      expect(within(menu).queryByRole("menuitem", { name: "File all 2 to Jira ENG" })).not.toBeNull(),
    );
    expect(within(menu).getByRole("menuitem", { name: "File all 2 to Jira ENG" }).textContent).toContain(
      "(default)",
    );
    fireEvent.click(within(menu).getByRole("menuitem", { name: "File all 2 to GitHub" }));
    await waitFor(() =>
      expect(fileCalls(slot)).toEqual([{ threadId: "thr_file_all", ids: null, destinationId: "github" }]),
    );
  });

  it("a row on its way says where, and cannot be filed again meanwhile", async () => {
    const going = row("r1", "Tidy the loader", { filingSince: NOW, filingTo: "Jira ENG" });
    const slot = renderBanner("thr_filing", [going]);
    expect(await slot.findByText("Filing to Jira ENG…")).toBeDefined();
    const menu = await openMenu(slot, `More actions for "${going.text}"`);
    await waitFor(() =>
      expect(
        within(menu).getByRole("menuitem", { name: `File "${going.text}" to GitHub` }).getAttribute("data-disabled"),
      ).not.toBeNull(),
    );
  });

  it("a filing that did not land says why, on the row", async () => {
    const failed = row("r1", "Tidy the loader", { filingNote: "GitHub exited 4: gh: not logged in" });
    const slot = renderBanner("thr_note", [failed]);
    expect((await slot.findByRole("note")).textContent).toBe("GitHub exited 4: gh: not logged in");
  });

  it("a refused filing is a toast", async () => {
    vi.mocked(toast.error).mockClear();
    const slot = renderBanner("thr_refused", [tidy], { destinations: [gh, jira], defaultId: null }, "nothing-to-file");
    const menu = await openMenu(slot, "File all follow-ups…");
    fireEvent.click(await within(menu).findByRole("menuitem", { name: "File all 1 to GitHub" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Nothing to file: those follow-ups are already on their way."),
    );
  });

  it("follows the destinations as they change", async () => {
    const state: State = { destinations: [gh], defaultId: null };
    const slot = renderBanner("thr_live", [tidy], state);
    let menu = await openMenu(slot, "File all follow-ups…");
    await within(menu).findByRole("menuitem", { name: "File all 1 to GitHub" });
    fireEvent.keyDown(menu, { key: "Escape" });
    state.destinations = [gh, jira];
    await slot.behavior.emitRealtime("followups-destinations-changed", {});
    menu = await openMenu(slot, "File all follow-ups…");
    expect(await within(menu).findByRole("menuitem", { name: "File all 1 to Jira ENG" })).toBeDefined();
  });
});

describe("filing from the panel", () => {
  function renderPanel(params: unknown, rows: FollowUp[] = [row("r1", "Tidy the loader")]) {
    return renderSlot({ component: FollowUpPanel }, { threadId: "thr_panel", params }, {
      rpc: {
        ...handlers(rows, { destinations: [gh], defaultId: null }),
        followups_set_destinations: async () => ({ outcome: "saved", destinations: [gh] }),
      } as never,
    });
  }

  it("opens on the destinations when sent there from the card", async () => {
    const slot = renderPanel({ destinations: true });
    expect(await slot.findByRole("button", { name: "Save destinations" })).toBeDefined();
  });

  it("keeps them folded otherwise, a tap away", async () => {
    const slot = renderPanel(undefined);
    const toggle = await slot.findByRole("button", { name: "Where follow-ups can be filed" });
    expect(slot.queryByRole("button", { name: "Save destinations" })).toBeNull();
    fireEvent.click(toggle);
    expect(await slot.findByRole("button", { name: "Save destinations" })).toBeDefined();
  });

  it("a row files from its own button", async () => {
    const slot = renderPanel(undefined);
    fireEvent.keyDown(await slot.findByRole("button", { name: 'File "Tidy the loader" to…' }), { key: "Enter" });
    fireEvent.click(await slot.findByRole("menuitem", { name: 'File "Tidy the loader" to GitHub' }));
    await waitFor(() =>
      expect(fileCalls(slot as never)).toEqual([{ threadId: "thr_panel", ids: ["r1"], destinationId: "github" }]),
    );
  });
});
