import { describe, expect, it, vi } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { useComposer, type PluginComposerApi } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { FollowUpBanner } from "../../src/banner.tsx";
import { WrapUp, WRAP_UP_POPUP_ID, wrapUpCommand, registerWrapUpCommand } from "../../src/wrap-up.tsx";
import { setRows } from "../../src/store.ts";
import type { Destination } from "../../lib/destinations.ts";
import type { FollowUp } from "../../lib/followups.ts";

// Wrap up: the popup that gives every open row somewhere to go and then
// archives the thread, the card's line while it waits, and the Next row's way
// in when the agent says the goal is met.

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

type Info = {
  state: null | {
    status: "running" | "held";
    archive: boolean;
    held: string | null;
    waitingOn: number;
    failed: { id: string; note: string }[];
  };
  newWorktree: boolean;
  children: { open: number; running: number };
};

let threads = 0;
function renderWrapUp(
  rows: FollowUp[],
  options: {
    destinations?: Destination[];
    defaultId?: string | null;
    info?: Partial<Info>;
    outcome?: { outcome: string; message: string | null };
    running?: boolean;
  } = {},
) {
  const threadId = `thr_wrap_${++threads}`;
  setRows(threadId, rows);
  const onClose = vi.fn();
  const info: Info = { state: null, newWorktree: true, children: { open: 0, running: 0 }, ...options.info };
  const slot = renderSlot(
    { component: () => <WrapUp threadId={threadId} running={options.running ?? false} onClose={onClose} /> },
    {},
    {
      rpc: {
        followups_destinations: async () => ({
          destinations: options.destinations ?? [gh, jira],
          defaultId: options.defaultId === undefined ? "jira-eng" : options.defaultId,
        }),
        followups_wrap_up_get: async () => info,
        followups_wrap_up: async () => options.outcome ?? { outcome: "archived", message: null },
      } as never,
    },
  );
  const wrapCalls = () =>
    slot.inspection.rpcCalls.filter((call) => call.method === "followups_wrap_up").map((call) => call.input);
  return { slot, threadId, onClose, wrapCalls };
}

const pickerFor = (slot: ReturnType<typeof renderSlot>, text: string) =>
  slot.getByRole("combobox", { name: `What to do with "${text}"` }) as HTMLSelectElement;

describe("the Wrap up popup", () => {
  const restore = row("r1", "Fix the restore");
  const exportRow = row("r2", "Rate-limit the export");

  it("starts every row at the project's default, says what will happen, and does it", async () => {
    const { slot, threadId, onClose, wrapCalls } = renderWrapUp([restore, exportRow]);
    await waitFor(() => expect(pickerFor(slot, restore.text).value).toBe("file:jira-eng"));
    expect(slot.getByText("Files 2 to Jira ENG, then archives this thread.")).toBeDefined();
    // The default is first, and says so.
    const options = within(pickerFor(slot, restore.text)).getAllByRole("option").map((option) => option.textContent);
    expect(options.slice(0, 2)).toEqual(["File to Jira ENG (default)", "File to GitHub"]);
    fireEvent.click(slot.getByRole("button", { name: "Wrap up" }));
    await waitFor(() =>
      expect(wrapCalls()).toEqual([
        {
          threadId,
          plan: [
            { id: "r1", disposition: { kind: "file", destinationId: "jira-eng" } },
            { id: "r2", disposition: { kind: "file", destinationId: "jira-eng" } },
          ],
          archive: true,
        },
      ]),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledWith("Wrapped up and archived.");
  });

  it("each row can go somewhere else, and Archive can be unticked", async () => {
    const { slot, threadId, wrapCalls } = renderWrapUp([restore, exportRow]);
    await waitFor(() => expect(pickerFor(slot, restore.text).value).toBe("file:jira-eng"));
    fireEvent.change(pickerFor(slot, restore.text), { target: { value: "handoff:new-worktree" } });
    fireEvent.change(pickerFor(slot, exportRow.text), { target: { value: "dismiss" } });
    fireEvent.click(slot.getByRole("checkbox", { name: /Archive this thread/ }));
    expect(slot.getByText("Hands off 1 and dismisses 1, then leaves this thread open.")).toBeDefined();
    fireEvent.click(slot.getByRole("button", { name: "Wrap up" }));
    await waitFor(() =>
      expect(wrapCalls()).toEqual([
        {
          threadId,
          plan: [
            { id: "r1", disposition: { kind: "handoff", where: "new-worktree" } },
            { id: "r2", disposition: { kind: "dismiss" } },
          ],
          archive: false,
        },
      ]),
    );
  });

  it("with nowhere to file, rows start as Keep open, and it offers to set somewhere up", async () => {
    const { slot } = renderWrapUp([restore], { destinations: [], defaultId: null });
    expect(pickerFor(slot, restore.text).value).toBe("keep");
    expect(slot.getByText("Archives this thread.")).toBeDefined();
    fireEvent.click(slot.getByRole("button", { name: "Set up a destination" }));
    expect(slot.inspection.navigateCalls).toContainEqual({
      method: "openThreadPanel",
      options: { actionId: "followups", params: { destinations: true } },
    });
  });

  it("offers a new worktree only where the checkout can have one", async () => {
    const { slot } = renderWrapUp([restore], { info: { newWorktree: false } });
    await waitFor(() => expect(pickerFor(slot, restore.text).value).toBe("file:jira-eng"));
    const values = within(pickerFor(slot, restore.text))
      .getAllByRole("option")
      .map((option) => (option as HTMLOptionElement).value);
    expect(values).toContain("handoff:here");
    expect(values).not.toContain("handoff:new-worktree");
  });

  it("says when an archive would take child threads with it", async () => {
    const { slot } = renderWrapUp([restore], { info: { children: { open: 2, running: 1 } } });
    expect(await slot.findByText("Also archives 2 child threads, 1 still working.")).toBeDefined();
    fireEvent.click(slot.getByRole("checkbox", { name: /Archive this thread/ }));
    expect(slot.queryByText(/Also archives/)).toBeNull();
  });

  it("rows already on their way are shown, not decided again", async () => {
    const going = row("r3", "Port the exporter", { filingSince: NOW, filingTo: "GitHub" });
    const { slot, wrapCalls } = renderWrapUp([restore, going]);
    expect(await slot.findByText("Filing to GitHub…")).toBeDefined();
    expect(slot.queryByRole("combobox", { name: `What to do with "${going.text}"` })).toBeNull();
    await waitFor(() => expect(pickerFor(slot, restore.text).value).toBe("file:jira-eng"));
    fireEvent.click(slot.getByRole("button", { name: "Wrap up" }));
    await waitFor(() => expect(wrapCalls()).toHaveLength(1));
    expect((wrapCalls()[0] as { plan: { id: string }[] }).plan.map((entry) => entry.id)).toEqual(["r1"]);
  });

  it("a held wrap-up says why, and what each row ran into", async () => {
    const { slot } = renderWrapUp([restore], {
      info: {
        state: {
          status: "held",
          archive: true,
          held: "1 follow-up didn't go where you sent it, so this thread was not archived.",
          waitingOn: 0,
          failed: [{ id: "r1", note: "The new thread could not be started." }],
        },
      },
    });
    expect(
      await slot.findByText("1 follow-up didn't go where you sent it, so this thread was not archived."),
    ).toBeDefined();
    expect(slot.getByText("The new thread could not be started.")).toBeDefined();
  });

  for (const [outcome, message] of [
    ["waiting", null],
    ["finished", null],
    ["finished", "1 follow-up didn't go where you sent it."],
  ] as const) {
    it(`closes on "${outcome}"${message === null ? "" : ", saying what did not go"}`, async () => {
      vi.mocked(toast.error).mockClear();
      const { slot, onClose } = renderWrapUp([restore], { outcome: { outcome, message } });
      await waitFor(() => expect(pickerFor(slot, restore.text).value).toBe("file:jira-eng"));
      fireEvent.click(slot.getByRole("button", { name: "Wrap up" }));
      await waitFor(() => expect(onClose).toHaveBeenCalled());
      if (message === null) expect(toast.error).not.toHaveBeenCalled();
      else expect(toast.error).toHaveBeenCalledWith(message);
    });
  }

  it("a pick whose destination was removed falls back to the default", async () => {
    let destinations = [gh, jira];
    const threadId = `thr_wrap_${++threads}`;
    setRows(threadId, [restore]);
    const slot = renderSlot(
      { component: () => <WrapUp threadId={threadId} running={false} onClose={() => {}} /> },
      {},
      {
        rpc: {
          followups_destinations: async () => ({ destinations, defaultId: "jira-eng" }),
          followups_wrap_up_get: async () => ({ state: null, newWorktree: true, children: { open: 0, running: 0 } }),
        } as never,
      },
    );
    await waitFor(() => expect(pickerFor(slot, restore.text).value).toBe("file:jira-eng"));
    fireEvent.change(pickerFor(slot, restore.text), { target: { value: "file:github" } });
    expect(pickerFor(slot, restore.text).value).toBe("file:github");
    destinations = [jira];
    await slot.behavior.emitRealtime("followups-destinations-changed", {});
    // The summary, not the picker: a picker with no matching option shows its
    // first one whatever it holds.
    await waitFor(() => expect(slot.getByText("Files 1 to Jira ENG, then archives this thread.")).toBeDefined());
  });

  it("a refusal stays open and says why", async () => {
    const { slot, onClose } = renderWrapUp([restore], {
      outcome: {
        outcome: "changed",
        message: "The follow-ups changed while you were deciding. Check them and wrap up again.",
      },
    });
    await waitFor(() => expect(pickerFor(slot, restore.text).value).toBe("file:jira-eng"));
    fireEvent.click(slot.getByRole("button", { name: "Wrap up" }));
    expect((await slot.findByRole("alert")).textContent).toBe(
      "The follow-ups changed while you were deciding. Check them and wrap up again.",
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("nothing runs while the agent is working", () => {
    const busy = renderWrapUp([restore], { running: true });
    expect(busy.slot.getByText("The agent is still working. Wrap up once it stops.")).toBeDefined();
    expect((busy.slot.getByRole("button", { name: "Wrap up" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("nothing runs while a wrap-up already waits", async () => {
    const waiting = renderWrapUp([restore], {
      info: { state: { status: "running", archive: true, held: null, waitingOn: 1, failed: [] } },
    });
    expect(await waiting.slot.findByText("Already wrapping up: waiting on what was sent.")).toBeDefined();
    expect((waiting.slot.getByRole("button", { name: "Wrap up" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("the palette command", () => {
  it("opens the popup, and is registered only where composer commands exist", async () => {
    const opened = vi.fn(() => true);
    await wrapUpCommand.run({ composer: { experimental_openPopup: opened } as never });
    expect(opened).toHaveBeenCalledWith(WRAP_UP_POPUP_ID);
    await wrapUpCommand.run({ composer: { experimental_openPopup: () => false } as never });
    expect(toast.error).toHaveBeenCalledWith("Wrap up opens in a thread's composer.");
    expect(wrapUpCommand.defaultShortcut).toBeUndefined();
    const register = vi.fn();
    expect(registerWrapUpCommand({ experimental_registerCommand: register })).toBe(true);
    expect(registerWrapUpCommand({})).toBe(false);
  });
});

describe("the card", () => {
  function renderBanner(
    threadId: string,
    rows: FollowUp[],
    options: { goalMet?: boolean; steps?: string[]; state?: Info["state"] } = {},
  ) {
    const held: { composer?: PluginComposerApi } = {};
    const slot = renderSlot(
      {
        component: () => {
          held.composer = useComposer();
          return <FollowUpBanner />;
        },
      },
      {},
      {
        composer: { text: "", mentions: [], scope: { kind: "thread", threadId } },
        rpc: {
          followups_list: async () => ({ followUps: rows, done: [], everRecorded: true }),
          followups_next_get: async () => ({
            offer:
              options.goalMet === undefined && options.steps === undefined
                ? null
                : { steps: options.steps ?? [], goalMet: options.goalMet ?? false, offeredAt: NOW },
          }),
          followups_destinations: async () => ({ destinations: [gh], defaultId: "github" }),
          followups_wrap_up_state: async () => ({ state: options.state ?? null }),
          followups_wrap_up_forget: async () => ({ forgotten: true }),
        } as never,
      },
    );
    return { slot, held };
  }

  it("offers Wrap up in place of Do once the agent says the goal is met", async () => {
    const { slot, held } = renderBanner("thr_card_goal", [row("r1", "Fix the restore")], { goalMet: true });
    const chip = await slot.findByRole("button", { name: "Wrap up this thread" });
    expect(slot.queryByRole("button", { name: /^Do "/ })).toBeNull();
    const open = vi.spyOn(held.composer!, "experimental_openPopup").mockReturnValue(true);
    fireEvent.click(chip);
    expect(open).toHaveBeenCalledWith(WRAP_UP_POPUP_ID);
  });

  it("puts Wrap up after the agent's own steps, which keep their order", async () => {
    const { slot } = renderBanner("thr_card_steps", [row("r1", "Fix the restore")], {
      goalMet: true,
      steps: ["Open a PR against main"],
    });
    await slot.findByRole("button", { name: "Wrap up this thread" });
    const group = slot.getByRole("group", { name: "Next steps" });
    expect(within(group).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
      'Send "Open a PR against main"',
      "Wrap up this thread",
    ]);
  });

  it("offers Do, not Wrap up, until the goal is met; and no Wrap up with nothing open", async () => {
    const open = renderBanner("thr_card_do", [row("r1", "Fix the restore")]);
    expect(await open.slot.findByRole("button", { name: 'Do "Fix the restore" now' })).toBeDefined();
    expect(open.slot.queryByRole("button", { name: "Wrap up this thread" })).toBeNull();
    const empty = renderBanner("thr_card_empty", [], { goalMet: true });
    await waitFor(() => expect(empty.slot.inspection.rpcCalls.length).toBeGreaterThan(0));
    expect(empty.slot.queryByRole("button", { name: "Wrap up this thread" })).toBeNull();
  });

  it("says what a wrap-up is waiting on", async () => {
    const { slot } = renderBanner("thr_card_waiting", [row("r1", "Fix the restore", { filingSince: NOW })], {
      state: { status: "running", archive: true, held: null, waitingOn: 2, failed: [] },
    });
    expect(
      await slot.findByText("Wrapping up: waiting on 2 filings, then archiving this thread."),
    ).toBeDefined();
  });

  it("a held wrap-up says so, reopens the popup, and can be let go of", async () => {
    const { slot, held } = renderBanner("thr_card_held", [row("r1", "Fix the restore")], {
      state: {
        status: "held",
        archive: true,
        held: "1 follow-up didn't go where you sent it, so this thread was not archived.",
        waitingOn: 0,
        failed: [],
      },
    });
    await slot.findByText("1 follow-up didn't go where you sent it, so this thread was not archived.");
    const open = vi.spyOn(held.composer!, "experimental_openPopup").mockReturnValue(true);
    fireEvent.click(slot.getByRole("button", { name: "Wrap up…" }));
    expect(open).toHaveBeenCalledWith(WRAP_UP_POPUP_ID);
    fireEvent.click(slot.getByRole("button", { name: "Dismiss this notice" }));
    await waitFor(() =>
      expect(slot.inspection.rpcCalls.map((call) => call.method)).toContain("followups_wrap_up_forget"),
    );
  });
});
