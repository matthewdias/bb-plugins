import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { useComposer, type ComposerMention, type PluginComposerApi } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
// Loaded at the top, not inside a test: the first load pulls in every hugeicons icon,
// which can take longer than a test's 5s timeout on a busy machine.
import pluginApp from "../../app.tsx";
import { toast } from "sonner";
import {
  FollowUpPicker,
  insertCommand,
  matchingRows,
  PICKER_POPUP_ID,
  registerInsertCommand,
} from "../../src/picker.tsx";
import { peekFollowUpState, setCollapsed, setRows } from "../../src/store.ts";
import type { FollowUp } from "../../lib/followups.ts";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const row = (id: string, text: string, detail: string | null = null): FollowUp => ({
  id,
  text,
  reason: null,
  file: null,
  detail,
  createdAt: "2026-10-01T00:00:00.000Z",
});

const auth = row("r1", "Fix the auth race");
const docs = row("r2", "Update the docs", "The CLI section is stale");
const flaky = row("r3", "Quarantine the flaky test");

let threads = 0;
/** A fresh thread per test: the store the picker reads is module scope. */
function freshThread(rows: FollowUp[]): string {
  const threadId = `thr_pick${++threads}`;
  setRows(threadId, rows);
  return threadId;
}

/** Render the picker in a thread composer, keeping hold of that composer's handle. */
function renderPicker(threadId: string, mentions: ComposerMention[] = [], text = "") {
  const held: { composer?: PluginComposerApi } = {};
  function Host() {
    held.composer = useComposer();
    return <FollowUpPicker />;
  }
  const slot = renderSlot({ component: Host }, {}, {
    composer: { text, mentions, scope: { kind: "thread", threadId } },
    rpc: {
      followups_reorder: async ({ orderedIds }: { orderedIds: string[] }) => ({
        followUps: orderedIds.map((id) => [auth, docs, flaky].find((entry) => entry.id === id)),
        done: [],
      }),
      followups_list: async () => ({ followUps: [], done: [], everRecorded: true }),
    } as never,
  });
  const close = vi.spyOn(held.composer!, "experimental_closePopup");
  const search = slot.getByRole("combobox", { name: "Search this thread's follow-ups" });
  const options = () => slot.queryAllByRole("option").map((option) => option.textContent);
  return { slot, close, search, options };
}

const pillIds = (slot: ReturnType<typeof renderSlot>) =>
  slot.inspection.composer.draft.mentions.map((mention) => (mention as { id: string }).id);

beforeEach(() => {
  vi.mocked(toast.error).mockClear();
});

describe("matchingRows", () => {
  it("keeps rows whose text or detail holds every word, in any case", () => {
    expect(matchingRows([auth, docs, flaky], "")).toEqual([auth, docs, flaky]);
    expect(matchingRows([auth, docs, flaky], "THE test")).toEqual([flaky]);
    expect(matchingRows([auth, docs, flaky], "cli stale")).toEqual([docs]);
    expect(matchingRows([auth, docs, flaky], "deploy")).toEqual([]);
  });
});

describe("the picker", () => {
  it("lists the open rows and narrows them as you type", () => {
    const { search, options } = renderPicker(freshThread([auth, docs, flaky]));
    expect(options()).toEqual([auth.text, docs.text, flaky.text]);
    fireEvent.change(search, { target: { value: "flaky" } });
    expect(options()).toEqual([flaky.text]);
    fireEvent.change(search, { target: { value: "nothing like this" } });
    expect(options()).toEqual([]);
  });

  it("leaves out rows already in the draft", () => {
    const threadId = freshThread([auth, docs]);
    const text = `see ${auth.text}`;
    const { options } = renderPicker(
      threadId,
      [
        {
          kind: "plugin",
          pluginId: "follow-up",
          provider: "follow-up",
          id: `${threadId}.${auth.id}`,
          label: auth.text,
          from: 4,
          to: text.length,
        },
      ],
      text,
    );
    expect(options()).toEqual([docs.text]);
  });

  it("moves with the arrows, then Enter inserts, moves the row to the top, and closes", async () => {
    const threadId = freshThread([auth, docs, flaky]);
    const { slot, close, search } = renderPicker(threadId);
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "ArrowUp" });
    expect(slot.getByRole("option", { selected: true }).textContent).toBe(docs.text);
    fireEvent.keyDown(search, { key: "Enter" });

    expect(pillIds(slot)).toEqual([`${threadId}.${docs.id}`]);
    expect(slot.inspection.composer.draft.mentions[0]).toMatchObject({
      kind: "plugin",
      provider: "follow-up",
      label: docs.text,
    });
    expect(slot.inspection.rpcCalls).toContainEqual({
      method: "followups_reorder",
      input: { threadId, orderedIds: [docs.id, auth.id, flaky.id], movedId: docs.id },
    });
    // Optimistic: the store has the new order before the server answers.
    expect(peekFollowUpState(threadId).rows.map((entry) => entry.id)[0]).toBe(docs.id);
    expect(close).toHaveBeenCalledOnce();
  });

  it("wraps from the top to the bottom", () => {
    const { slot, search } = renderPicker(freshThread([auth, docs, flaky]));
    fireEvent.keyDown(search, { key: "ArrowUp" });
    expect(slot.getByRole("option", { selected: true }).textContent).toBe(flaky.text);
  });

  it("does not reorder a row that is already at the top", async () => {
    const { slot, close, search } = renderPicker(freshThread([auth, docs]));
    fireEvent.keyDown(search, { key: "Enter" });
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(slot.inspection.rpcCalls.filter((call) => call.method === "followups_reorder")).toEqual([]);
  });

  it("picks a row by click too", () => {
    const threadId = freshThread([auth, docs]);
    const { slot, close } = renderPicker(threadId);
    fireEvent.click(slot.getByRole("option", { name: docs.text }));
    expect(pillIds(slot)).toEqual([`${threadId}.${docs.id}`]);
    expect(close).toHaveBeenCalledOnce();
  });

  it("says so when every open row is already in the draft", () => {
    const threadId = freshThread([auth]);
    const { slot, options } = renderPicker(
      threadId,
      [
        {
          kind: "plugin",
          pluginId: "follow-up",
          provider: "follow-up",
          id: `${threadId}.${auth.id}`,
          label: auth.text,
          from: 0,
          to: auth.text.length,
        },
      ],
      auth.text,
    );
    expect(options()).toEqual([]);
    expect(slot.getByText("Every open follow-up is already in the composer.")).toBeDefined();
  });

  it("says so when the thread has nothing to pick", () => {
    const { slot } = renderPicker(freshThread([]));
    expect(slot.getByText("No open follow-ups on this thread.")).toBeDefined();
  });
});

describe("the + menu row", () => {
  async function plusRow() {
    const app = await loadPluginApp(pluginApp);
    const item = app.composerCustomizations[0]?.plusMenu?.find((entry) => entry.id === "show-followups");
    expect(item).toBeDefined();
    return item!;
  }

  it("expands the banner when no popup opens, as with the harness composer", async () => {
    const item = await plusRow();
    const threadId = freshThread([auth]);
    setCollapsed(threadId, true);
    const held: { composer?: PluginComposerApi } = {};
    renderSlot({ component: () => ((held.composer = useComposer()), null) }, {}, {
      composer: { text: "", scope: { kind: "thread", threadId } },
    });
    expect(held.composer!.experimental_openPopup(PICKER_POPUP_ID)).toBe(false);
    await item.run({ composer: held.composer! });
    expect(peekFollowUpState(threadId).collapsed).toBe(false);
  });

  it("opens the picker instead where bb can, and leaves the banner alone", async () => {
    const item = await plusRow();
    const threadId = freshThread([auth]);
    setCollapsed(threadId, true);
    const openPopup = vi.fn(() => true);
    await item.run({
      composer: { scope: { kind: "thread", threadId }, experimental_openPopup: openPopup } as never,
    });
    expect(openPopup).toHaveBeenCalledWith(PICKER_POPUP_ID);
    expect(peekFollowUpState(threadId).collapsed).toBe(true);
  });

  it("has the picker in its own thread-only customization", async () => {
    const app = await loadPluginApp(pluginApp);
    const picker = app.composerCustomizations.find((entry) => entry.id === "follow-up-picker");
    expect(picker?.scopes).toEqual(["thread"]);
    expect(picker?.experimental_popups?.map((popup) => popup.id)).toEqual([PICKER_POPUP_ID]);
    expect(app.composerCustomizations[0]?.experimental_popups).toBeUndefined();
  });
});

describe("the insert command", () => {
  it("is registered, with no default shortcut, only where the method exists", () => {
    const register = vi.fn();
    expect(registerInsertCommand({ experimental_registerCommand: register })).toBe(true);
    expect(register).toHaveBeenCalledWith(insertCommand);
    expect(insertCommand.defaultShortcut).toBeUndefined();
    expect(registerInsertCommand({})).toBe(false);
  });

  it("opens the picker, and says why when it cannot", async () => {
    const opened = vi.fn(() => true);
    await insertCommand.run({ composer: { experimental_openPopup: opened } as never });
    expect(opened).toHaveBeenCalledWith(PICKER_POPUP_ID);
    expect(toast.error).not.toHaveBeenCalled();
    await insertCommand.run({ composer: { experimental_openPopup: () => false } as never });
    expect(toast.error).toHaveBeenCalledWith("The follow-up picker opens in a thread's composer.");
  });
});
