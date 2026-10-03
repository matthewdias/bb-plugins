import { describe, expect, it } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { RecordDraftAction } from "../../src/record-draft.tsx";

// Kept small on purpose: the button is replaced by a send-menu row and a
// composer command, so this pins only what that move has to account for.
describe("RecordDraftAction", () => {
  it("locks the composer across the call, then clears a recorded draft", async () => {
    const slot = renderSlot({ component: RecordDraftAction }, {}, {
      composer: { text: "look at the flaky test", scope: { kind: "thread", threadId: "thr_a" } },
      rpc: {
        followups_add: async () => ({ outcome: "added", id: "abc12345", followUps: [], done: [] }),
      } as never,
    });
    fireEvent.click(slot.getByRole("button"));
    await waitFor(() => expect(slot.inspection.composer.text).toBe(""));
    expect(slot.inspection.composer.inputLockCalls).toEqual([true, false]);
    expect(slot.inspection.rpcCalls).toEqual([
      { method: "followups_add", input: { threadId: "thr_a", text: "look at the flaky test" } },
    ]);
  });
});
