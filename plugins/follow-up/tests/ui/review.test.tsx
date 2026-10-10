import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { calls, diffOf, file, prCard, renderReview } from "./review-fixture.tsx";

// Reviewing a pull request on its card. Here bb's diff is the test harness's
// plain stand-in, which takes no rows: each file falls back to a comment box
// under it. review-inline.test.tsx covers comments drawn inside the diff.

vi.mock("sonner", () => {
  const toast = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() });
  return { toast };
});
beforeEach(() => vi.clearAllMocks());

const WAIT = { timeout: 4000 };

describe("a pull request's changes on its card", () => {
  it("lists the files against the base branch, the first few open", async () => {
    const files = ["a.ts", "b.ts", "c.ts", "d.ts"].map((path) => file(`src/${path}`));
    const slot = renderReview(prCard("thr_list"), { outcome: "ok", diff: diffOf(files, 2) });
    fireEvent.click(await slot.findByRole("button", { name: /Review changes/ }));
    const review = await slot.findByRole("region", { name: "Changes in #71" });
    expect(review.textContent).toContain("4 files against main, from the thread's worktree.");
    expect(slot.queryByRole("button", { name: /Review changes/ })).toBeNull();
    expect(within(review).getAllByTestId("bb-diff").map((diff) => [diff.getAttribute("data-path"), diff.getAttribute("data-view")])).toEqual([
      ["src/a.ts", "unified"],
      ["src/b.ts", "unified"],
      ["src/c.ts", "unified"],
    ]);
    expect(within(review).getByRole("button", { name: /src\/d\.ts/ }).getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(within(review).getByRole("button", { name: /src\/d\.ts/ }));
    expect(within(review).getAllByTestId("bb-diff")).toHaveLength(4);
    expect(within(review).getByText("2 more files are not shown here. They are on GitHub.")).toBeTruthy();
    expect(calls(slot, "page_pr_diff")).toEqual([{ threadId: "thr_list" }]);
  });

  it("shows a rename, a binary file and a file too large to show as what they are", async () => {
    const slot = renderReview(prCard("thr_kinds"), {
      outcome: "ok",
      diff: diffOf([file("src/new.ts", { previousPath: "src/old.ts", cut: true }), file("logo.png", { binary: true, patch: "" }), file("big.json", { patch: "", cut: true })]),
    });
    fireEvent.click(await slot.findByRole("button", { name: /Review changes/ }));
    const review = await slot.findByRole("region", { name: "Changes in #71" });
    expect(within(review).getByRole("button", { name: /src\/old\.ts → src\/new\.ts/ })).toBeTruthy();
    expect(within(review).getByText("The rest of this file's changes are on GitHub.")).toBeTruthy();
    expect(within(review).getByText("A binary file.")).toBeTruthy();
    expect(within(review).getByText("Too large to show here. It is on GitHub.")).toBeTruthy();
    expect(within(review).getAllByTestId("bb-diff")).toHaveLength(1);
  });

  it.each([
    ["none", "There are no changes to read on this thread's worktree."],
    ["unavailable", "The changes could not be read here. They are on GitHub."],
  ])("says so when the changes come back %s, and closes", async (outcome, message) => {
    const slot = renderReview(prCard(`thr_${outcome}`), { outcome, diff: null });
    fireEvent.click(await slot.findByRole("button", { name: /Review changes/ }));
    expect(await slot.findByText(message)).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Close" }));
    expect(await slot.findByRole("button", { name: /Review changes/ })).toBeTruthy();
  });
});

describe("commenting where the diff takes no rows", () => {
  it("takes a line number, quotes that line, and sends every comment as one message shown first", async () => {
    const slot = renderReview(prCard("thr_plain"), { outcome: "ok", diff: diffOf([file("src/queue.ts")]) });
    fireEvent.click(await slot.findByRole("button", { name: /Review changes/ }));
    const review = await slot.findByRole("region", { name: "Changes in #71" });
    const request = within(review).getByRole("button", { name: "Request changes" }) as HTMLButtonElement;
    expect(request.disabled).toBe(true);
    const line = await within(review).findByLabelText("Line in src/queue.ts", {}, WAIT);
    const add = within(review).getByRole("button", { name: "Add comment" }) as HTMLButtonElement;
    fireEvent.change(line, { target: { value: "40" } });
    fireEvent.change(within(review).getByLabelText("Comment on src/queue.ts"), { target: { value: "  Cap the backoff at an hour.  " } });
    expect(within(review).getByText("The changes shown don't include that line of the new file.")).toBeTruthy();
    expect(add.disabled).toBe(true);
    fireEvent.change(line, { target: { value: "13" } });
    expect(add.disabled).toBe(false);
    fireEvent.click(add);
    expect(within(review).getByText("Cap the backoff at an hour.")).toBeTruthy();
    expect(within(review).getByText("retry(job, { backoff: true });")).toBeTruthy();
    expect((line as HTMLInputElement).value).toBe("");
    // A second, on an earlier line: the message lists them as the diff does, not as they were typed.
    fireEvent.change(line, { target: { value: "12" } });
    fireEvent.change(within(review).getByLabelText("Comment on src/queue.ts"), { target: { value: "Name this number." } });
    fireEvent.click(add);
    fireEvent.click(within(review).getByRole("button", { name: "Request changes (2)" }));
    // The message, in a box, before anything is sent.
    const box = (await slot.findByRole("textbox", { name: "The message to send" })) as HTMLTextAreaElement;
    expect(box.value).toBe(
      [
        "I reviewed PR #71 (Add the offline queue) and want changes before it merges.",
        "",
        "1. src/queue.ts:12",
        "   > const max = 5;",
        "   Name this number.",
        "",
        "2. src/queue.ts:13",
        "   > retry(job, { backoff: true });",
        "   Cap the backoff at an hour.",
        "",
        "Address each one, then push.",
      ].join("\n"),
    );
    expect(calls(slot, "page_reply")).toHaveLength(0);
    fireEvent.click(slot.getByRole("button", { name: "Send to the thread" }));
    await waitFor(() => expect(calls(slot, "page_reply")).toHaveLength(1));
    expect(calls(slot, "page_reply")[0]).toEqual({ threadId: "thr_plain", text: box.value });
    // Sent: the changes close, and the drafts are drafts no longer.
    fireEvent.click(await slot.findByRole("button", { name: /Review changes/ }));
    const again = await slot.findByRole("region", { name: "Changes in #71" });
    expect(within(again).queryByText("Cap the backoff at an hour.")).toBeNull();
  });

  it("keeps drafts when the changes are closed, and lets one be edited or removed", async () => {
    const slot = renderReview(prCard("thr_keep"), { outcome: "ok", diff: diffOf([file("src/queue.ts")]) });
    fireEvent.click(await slot.findByRole("button", { name: /Review changes/ }));
    let review = await slot.findByRole("region", { name: "Changes in #71" });
    fireEvent.change(await within(review).findByLabelText("Line in src/queue.ts", {}, WAIT), { target: { value: "14" } });
    fireEvent.change(within(review).getByLabelText("Comment on src/queue.ts"), { target: { value: "Why log here?" } });
    fireEvent.click(within(review).getByRole("button", { name: "Add comment" }));
    expect(within(review).getByText("Comments are kept until you send them.")).toBeTruthy();
    fireEvent.click(within(review).getByRole("button", { name: "Close the changes" }));
    fireEvent.click(await slot.findByRole("button", { name: /Review changes/ }));
    review = await slot.findByRole("region", { name: "Changes in #71" });
    expect(within(review).getByText("Why log here?")).toBeTruthy();
    fireEvent.click(within(review).getByRole("button", { name: "Edit" }));
    fireEvent.change(within(review).getByLabelText("Edit the comment on line 14"), { target: { value: "Drop this log." } });
    fireEvent.click(within(review).getByRole("button", { name: "Save" }));
    expect(within(review).getByText("Drop this log.")).toBeTruthy();
    expect(within(review).queryByText("Why log here?")).toBeNull();
    fireEvent.click(within(review).getByRole("button", { name: "Remove" }));
    expect(within(review).queryByText("Drop this log.")).toBeNull();
    expect((within(review).getByRole("button", { name: "Request changes" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
