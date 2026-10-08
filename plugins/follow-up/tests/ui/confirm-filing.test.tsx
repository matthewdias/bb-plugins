import { describe, expect, it, vi } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { ConfirmFiling } from "../../src/confirm-filing.tsx";

// The one tap an agent's file_follow_ups waits on.

function renderConfirm(payload: unknown) {
  const submit = vi.fn(async () => {});
  const cancel = vi.fn(async () => {});
  const slot = renderSlot({ component: ConfirmFiling }, {
    interaction: {
      id: "int_1",
      threadId: "thr_a",
      title: "File 2 follow-ups to Jira ENG?",
      payload,
      createdAt: 0,
      expiresAt: null,
    },
    submit,
    cancel,
  } as never, {});
  return { slot, submit };
}

const payload = {
  destination: "Jira ENG",
  kind: "agent",
  rows: [
    { id: "a1", text: "Fix the restore", detail: "It drops the source.\nEvery time.", file: "src/restore.ts" },
    { id: "b2", text: "Rate-limit the export", detail: null, file: null },
  ],
};

describe("confirming an agent's filing", () => {
  it("names where the rows go, and lists them", async () => {
    const { slot } = renderConfirm(payload);
    expect(await slot.findByText("Jira ENG")).toBeDefined();
    expect(slot.getByText(/by a helper following your recipe/)).toBeDefined();
    expect(slot.getByText("Fix the restore")).toBeDefined();
    expect(slot.getByText("Rate-limit the export")).toBeDefined();
  });

  it("shows all of what each row sends: title, detail and file", async () => {
    const { slot } = renderConfirm(payload);
    expect(await slot.findByText("src/restore.ts")).toBeDefined();
    expect(slot.getByText(/It drops the source\.\s+Every time\./)).toBeDefined();
    expect(slot.queryByRole("alert")).toBeNull();
  });

  it("flags a row carrying characters that do not show", async () => {
    const { slot } = renderConfirm({
      ...payload,
      rows: [{ id: "a1", text: "Fix the\u200B restore", detail: null, file: null }],
    });
    expect((await slot.findByRole("alert")).textContent).toMatch(/do not show on screen/);
  });

  it("File answers yes; Don't file answers no", async () => {
    const yes = renderConfirm(payload);
    fireEvent.click(await yes.slot.findByRole("button", { name: "File all 2" }));
    await waitFor(() => expect(yes.submit).toHaveBeenCalledWith({ file: true }));
    yes.slot.unmount();
    const no = renderConfirm(payload);
    fireEvent.click(await no.slot.findByRole("button", { name: "Don’t file" }));
    await waitFor(() => expect(no.submit).toHaveBeenCalledWith({ file: false }));
  });

  it("a request it cannot read can only be declined", async () => {
    const { slot, submit } = renderConfirm({ nonsense: true });
    expect(slot.queryByRole("button", { name: /^File/ })).toBeNull();
    fireEvent.click(await slot.findByRole("button", { name: "Don’t file" }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith({ file: false }));
  });
});
