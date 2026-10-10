import { useLayoutEffect, useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { patchLines } from "../../lib/review.ts";
import { OWNED } from "../../src/page/diff-rows.ts";
import { buildDiff, stacks, type FixtureLine } from "./diff-fixture.ts";
import { calls, diffOf, file, prCard, renderReview } from "./review-fixture.tsx";

// Comments drawn inside bb's diff, under the lines they are about. bb's Diff
// is replaced here by one that draws the markup bb's does (diff-fixture.ts),
// since the test harness's stand-in is a plain <pre>.

vi.mock("sonner", () => {
  const toast = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() });
  return { toast };
});
beforeEach(() => vi.clearAllMocks());

function FixtureDiff({ patch, path }: { patch: string; path: string }) {
  const holder = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const element = holder.current;
    if (element === null) return;
    const lines: FixtureLine[] = patchLines(patch).map((line) => ({
      type: line.kind === "add" ? "addition" : line.kind === "del" ? "deletion" : "context",
      line: (line.kind === "del" ? line.old : line.new) as number,
      text: line.text,
    }));
    const host = buildDiff(element, lines);
    return () => host.remove();
  }, [patch]);
  return <div ref={holder} data-testid="fixture-diff" data-path={path} />;
}

vi.mock("@get-bb/plugin-sdk/app", async (original) => ({
  ...(await original<typeof import("@get-bb/plugin-sdk/app")>()),
  experimental_Diff: FixtureDiff,
}));

/** bb's diff for a file, once Follow Up has found it. */
async function diffHost(review: HTMLElement): Promise<HTMLElement> {
  return waitFor(() => {
    const host = review.querySelector("diffs-container");
    if (!(host instanceof HTMLElement) || host.shadowRoot?.querySelector(`style[${OWNED}]`) == null) throw new Error("not decorated yet");
    return host;
  });
}

const pressLine = (host: HTMLElement, index: number) =>
  stacks(host).gutter.children[index]!.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));

describe("commenting inside bb's diff", () => {
  it("a press on a line's number opens a comment under that line, and adding it leaves it there", async () => {
    const slot = renderReview(prCard("thr_inline"), { outcome: "ok", diff: diffOf([file("src/queue.ts")]) });
    fireEvent.click(await slot.findByRole("button", { name: /Review changes/ }));
    const review = await slot.findByRole("region", { name: "Changes in #71" });
    const host = await diffHost(review);
    // No comment box under the file: the diff takes rows.
    expect(within(review).queryByLabelText("Line in src/queue.ts")).toBeNull();
    // Row 2 is the added line 13.
    pressLine(host, 2);
    const box = await within(review).findByLabelText("Comment on line 13");
    // Drawn under the host, in the page's document, and shown through a slot under the line.
    expect(box.closest(`[${OWNED}]`)?.parentElement).toBe(host);
    const { content, gutter } = stacks(host);
    expect(content.children[3]?.hasAttribute(OWNED)).toBe(true);
    expect(gutter.children[3]?.hasAttribute(OWNED)).toBe(true);
    expect(content.children.length).toBe(gutter.children.length);
    fireEvent.change(box, { target: { value: "Cap the backoff at an hour." } });
    fireEvent.click(within(review).getByRole("button", { name: "Add comment" }));
    await waitFor(() => expect(within(review).getByText("Cap the backoff at an hour.")).toBeTruthy());
    expect(within(review).queryByLabelText("Comment on line 13")).toBeNull();
    expect(stacks(host).content.children[3]?.hasAttribute(OWNED)).toBe(true);
    expect(stacks(host).content.querySelectorAll(`[${OWNED}]`).length).toBe(1);
    // The message quotes the line as the diff showed it.
    fireEvent.click(within(review).getByRole("button", { name: "Request changes (1)" }));
    const message = (await slot.findByRole("textbox", { name: "The message to send" })) as HTMLTextAreaElement;
    expect(message.value).toContain("1. src/queue.ts:13\n   > retry(job, { backoff: true });\n   Cap the backoff at an hour.");
    expect(calls(slot, "page_reply")).toHaveLength(0);
  });

  it("comments on a removed line as the old file's line, and cancelling leaves nothing behind", async () => {
    const slot = renderReview(prCard("thr_old"), { outcome: "ok", diff: diffOf([file("src/queue.ts")]) });
    fireEvent.click(await slot.findByRole("button", { name: /Review changes/ }));
    const review = await slot.findByRole("region", { name: "Changes in #71" });
    const host = await diffHost(review);
    const before = stacks(host).content.children.length;
    pressLine(host, 3);
    await within(review).findByLabelText("Comment on line 14");
    fireEvent.click(within(review).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(stacks(host).content.children.length).toBe(before));
    // Row 1 is the removed line 13.
    pressLine(host, 1);
    fireEvent.change(await within(review).findByLabelText("Comment on line 13"), { target: { value: "Why remove this?" } });
    fireEvent.click(within(review).getByRole("button", { name: "Add comment" }));
    await waitFor(() => expect(within(review).getByText("Why remove this?")).toBeTruthy());
    fireEvent.click(within(review).getByRole("button", { name: "Request changes (1)" }));
    const message = (await slot.findByRole("textbox", { name: "The message to send" })) as HTMLTextAreaElement;
    expect(message.value).toContain("1. src/queue.ts:13 (removed line)\n   > retry(job);\n   Why remove this?");
  });

  it("lists a comment under the file when bb is not drawing its line, with the line it was on", async () => {
    const slot = renderReview(prCard("thr_under"), { outcome: "ok", diff: diffOf([file("src/queue.ts")]) });
    fireEvent.click(await slot.findByRole("button", { name: /Review changes/ }));
    const review = await slot.findByRole("region", { name: "Changes in #71" });
    const host = await diffHost(review);
    pressLine(host, 4);
    fireEvent.change(await within(review).findByLabelText("Comment on line 15"), { target: { value: "Return the result instead." } });
    fireEvent.click(within(review).getByRole("button", { name: "Add comment" }));
    await waitFor(() => expect(stacks(host).content.querySelectorAll(`[${OWNED}]`).length).toBe(1));
    // bb stops drawing that line, as it does for rows scrolled far out of view.
    const { gutter, content } = stacks(host);
    for (const stack of [gutter, content]) {
      for (const child of Array.from(stack.children)) if (child.hasAttribute(OWNED)) child.remove();
      stack.lastElementChild!.remove();
      stack.setAttribute("style", "grid-row: span 4");
    }
    await waitFor(() => expect(within(review).getByText(/Line 15/)).toBeTruthy());
    expect(within(review).getByText("return job;")).toBeTruthy();
    expect(within(review).getByText("Return the result instead.")).toBeTruthy();
    expect(stacks(host).content.querySelectorAll(`[${OWNED}]`).length).toBe(0);
    // Still a diff that takes rows, so no box asking for a line number.
    expect(within(review).queryByLabelText("Line in src/queue.ts")).toBeNull();
  });

  it("puts the rows back when bb redraws its diff", async () => {
    const slot = renderReview(prCard("thr_redraw"), { outcome: "ok", diff: diffOf([file("src/queue.ts")]) });
    fireEvent.click(await slot.findByRole("button", { name: /Review changes/ }));
    const review = await slot.findByRole("region", { name: "Changes in #71" });
    const host = await diffHost(review);
    pressLine(host, 0);
    fireEvent.change(await within(review).findByLabelText("Comment on line 12"), { target: { value: "Name this." } });
    fireEvent.click(within(review).getByRole("button", { name: "Add comment" }));
    await waitFor(() => expect(stacks(host).content.querySelectorAll(`[${OWNED}]`).length).toBe(1));
    // bb draws the stacks again, without Follow Up's rows.
    const { gutter, content } = stacks(host);
    for (const stack of [gutter, content]) {
      for (const child of Array.from(stack.children)) if (child.hasAttribute(OWNED)) child.remove();
      stack.setAttribute("style", "grid-row: span 5");
      stack.append(stack.firstElementChild!.cloneNode(true));
      stack.lastElementChild!.remove();
    }
    await waitFor(() => expect(stacks(host).content.querySelectorAll(`[${OWNED}]`).length).toBe(1));
    expect(stacks(host).content.children[1]?.hasAttribute(OWNED)).toBe(true);
    expect(within(review).getByText("Name this.")).toBeTruthy();
  });
});
