import { beforeEach, describe, expect, it, vi } from "vitest";
import { useComposer, useRpc, type ComposerMention, type PluginComposerApi, type PluginComposerScope } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
// Loaded at the top, not inside a test: the first load pulls in every hugeicons icon,
// which can take longer than a test's 5s timeout on a busy machine.
import pluginApp from "../../app.tsx";
import { toast } from "sonner";
import {
  recordCommand,
  recordDraftAndReport,
  recordSendMenuItem,
  REFUSAL_DETAIL,
  registerRecordCommand,
} from "../../src/record-draft.ts";
import { rememberRpc, type FollowUpRpc } from "../../src/rpc.ts";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const THREAD = "thr_rec";
const thread: PluginComposerScope = { kind: "thread", threadId: THREAD };

type AddInput = { threadId: string; text: string; detail?: string; file?: string };

/**
 * Render a slot that does nothing but hand back its composer and rpc client,
 * so the flow can be driven the way the send menu and the command drive it.
 */
function probe(options: {
  text: string;
  mentions?: ComposerMention[];
  scope?: PluginComposerScope;
  add?: (input: AddInput) => unknown;
}) {
  const held: { composer?: PluginComposerApi; rpc?: FollowUpRpc } = {};
  function Probe() {
    held.composer = useComposer();
    held.rpc = useRpc() as FollowUpRpc;
    return null;
  }
  const add =
    options.add ?? (() => ({ outcome: "added", id: "abc12345", followUps: [], done: [] }));
  const slot = renderSlot({ component: Probe }, {}, {
    composer: { text: options.text, mentions: options.mentions ?? [], scope: options.scope ?? thread },
    rpc: { followups_add: async (input: AddInput) => add(input) } as never,
  });
  return { slot, composer: held.composer!, rpc: held.rpc! };
}

const pathMention = (text: string, path: string): ComposerMention => ({
  kind: "path",
  path,
  source: "workspace",
  entryKind: "file",
  label: path,
  from: text.indexOf(path),
  to: text.indexOf(path) + path.length,
});

beforeEach(() => {
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

describe("recordDraft", () => {
  it("records the draft, clears it, and says so", async () => {
    const { slot, composer, rpc } = probe({ text: "look at the flaky test" });
    expect(await recordDraftAndReport(composer, rpc)).toBe("added");
    expect(slot.inspection.rpcCalls).toEqual([
      { method: "followups_add", input: { threadId: THREAD, text: "look at the flaky test" } },
    ]);
    expect(slot.inspection.composer.draft).toMatchObject({ text: "", mentions: [] });
    expect(toast.success).toHaveBeenCalledWith("Recorded as a follow-up");
    expect(toast.error).not.toHaveBeenCalled();
    // No lock: neither entry point has a slot for one to belong to.
    expect(slot.inspection.composer.inputLockCalls).toEqual([]);
  });

  it.each(["duplicate", "dismissed", "full"] as const)(
    "keeps the draft and says why when the server refuses it as %s",
    async (outcome) => {
      const { slot, composer, rpc } = probe({
        text: "look at the flaky test",
        add: () => ({ outcome, id: null, followUps: [], done: [] }),
      });
      expect(await recordDraftAndReport(composer, rpc)).toBe(outcome);
      expect(slot.inspection.composer.text).toBe("look at the flaky test");
      expect(toast.error).toHaveBeenCalledWith(REFUSAL_DETAIL[outcome]);
      expect(toast.success).not.toHaveBeenCalled();
    },
  );

  it("keeps the draft when the call fails", async () => {
    const { slot, composer, rpc } = probe({
      text: "look at the flaky test",
      add: () => {
        throw new Error("server down");
      },
    });
    expect(await recordDraftAndReport(composer, rpc)).toBe("failed");
    expect(slot.inspection.composer.text).toBe("look at the flaky test");
    expect(toast.error).toHaveBeenCalledWith(REFUSAL_DETAIL.failed);
  });

  it("anchors the row to a file mentioned in the draft", async () => {
    const text = "check src/auth.ts for the race";
    const { slot, composer, rpc } = probe({ text, mentions: [pathMention(text, "src/auth.ts")] });
    await recordDraftAndReport(composer, rpc);
    expect(slot.inspection.rpcCalls[0]?.input).toEqual({
      threadId: THREAD,
      text,
      file: "src/auth.ts",
    });
  });

  it("refuses a draft with no text, as an attachment-only draft is, without calling the server", async () => {
    const { slot, composer, rpc } = probe({ text: "   " });
    expect(await recordDraftAndReport(composer, rpc)).toBe("empty");
    expect(slot.inspection.rpcCalls).toEqual([]);
    expect(toast.error).toHaveBeenCalledWith("Nothing to record: the draft has no text.");
  });

  it("refuses in a composer with no thread", async () => {
    const { slot, composer, rpc } = probe({
      text: "look at the flaky test",
      scope: { kind: "new-thread", projectId: "proj_1" },
    });
    expect(await recordDraftAndReport(composer, rpc)).toBe("no-thread");
    expect(slot.inspection.rpcCalls).toEqual([]);
    expect(slot.inspection.composer.text).toBe("look at the flaky test");
    expect(toast.error).toHaveBeenCalledWith(REFUSAL_DETAIL["no-thread"]);
  });
});

describe("the send-menu row", () => {
  it("is disabled in a composer with no thread", () => {
    const disabled = recordSendMenuItem.disabled as (composer: PluginComposerApi) => boolean;
    expect(disabled({ scope: thread } as PluginComposerApi)).toBe(false);
    expect(disabled({ scope: { kind: "new-thread", projectId: null } } as PluginComposerApi)).toBe(true);
  });

  it("records through the client a mounted surface left behind", async () => {
    const { slot, composer, rpc } = probe({ text: "look at the flaky test" });
    rememberRpc(rpc);
    await recordSendMenuItem.run({ composer });
    expect(slot.inspection.composer.text).toBe("");
    expect(toast.success).toHaveBeenCalledOnce();
  });
});

describe("the composer command", () => {
  it("is registered, with no default shortcut, where the method exists", () => {
    const register = vi.fn();
    expect(registerRecordCommand({ experimental_registerCommand: register })).toBe(true);
    expect(register).toHaveBeenCalledWith(recordCommand);
    expect(recordCommand.defaultShortcut).toBeUndefined();
    expect(recordCommand.title).toBe("Follow-ups: record the draft");
  });

  it("is skipped, without throwing, where the method is missing", () => {
    expect(registerRecordCommand({})).toBe(false);
  });

  it("records the composer it is run in", async () => {
    const { slot, composer, rpc } = probe({ text: "look at the flaky test" });
    rememberRpc(rpc);
    await recordCommand.run({ composer });
    expect(slot.inspection.composer.text).toBe("");
  });
});

describe("app.tsx", () => {
  it("puts the row in the send menu and has no action-row button", async () => {
    const app = await loadPluginApp(pluginApp);
    const customization = app.composerCustomizations[0];
    expect(customization?.sendMenu?.map((item) => item.id)).toEqual(["record-as-follow-up"]);
    expect(customization?.actions ?? []).toEqual([]);
  });

  it("reports a message action's refusal in a toast rather than opening the panel", async () => {
    const app = await loadPluginApp(pluginApp);
    const action = app.messageActions.find((entry) => entry.id === "record-follow-up");
    rememberRpc({
      call: async () => ({ outcome: "dismissed", id: null, followUps: [], done: [] }),
    } as unknown as FollowUpRpc);
    const openPanel = vi.fn(() => true);
    await action?.run({
      threadId: THREAD,
      message: { threadId: THREAD, role: "assistant", text: "Fix the race in auth.", sourceSeqEnd: 1 } as never,
      selectedText: "Fix the race in auth.",
      openPanel,
      composer: null,
    });
    expect(toast.error).toHaveBeenCalledWith(REFUSAL_DETAIL.dismissed);
    expect(openPanel).not.toHaveBeenCalled();
  });
});
