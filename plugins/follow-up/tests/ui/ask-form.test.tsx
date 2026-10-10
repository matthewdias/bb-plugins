import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { toast } from "sonner";
import { FollowUpBanner } from "../../src/banner.tsx";
import { FollowUpPage } from "../../src/page/page.tsx";
import { makeForm, type Form, type PartInput } from "../../lib/ask.ts";
import type { Card } from "../../lib/page.ts";

// The form an agent asked with: above the thread's composer, on the page's
// card, and in Focus, where number keys pick and Enter sends.

vi.mock("sonner", () => {
  const toast = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() });
  return { toast };
});
beforeEach(() => vi.clearAllMocks());

const AT = "2026-10-09T12:00:00.000Z";
const NOW = Date.now();

const retry: PartInput = {
  type: "choice",
  id: "retry",
  prompt: "How should a failed upload retry?",
  options: [{ label: "Back off", description: "Survives a long outage." }, { label: "Retry at once" }],
  recommended: ["Back off"],
};
const issue = (n: number, extra: Partial<Extract<PartInput, { type: "item" }>> = {}): PartInput => ({
  type: "item",
  id: `issue-${n}`,
  title: `#${n} An issue`,
  choices: [{ label: "Close it" }, { label: "Leave open" }],
  ...extra,
});

function formOf(parts: PartInput[], title = "Offline queue"): Form {
  const made = makeForm(title, parts, AT);
  if (!made.ok) throw new Error(made.problem);
  return made.form;
}

// The banner's form store is module-wide, as its offers' is, so each test has its own thread.
let threads = 0;

function renderBanner(form: Form | null, { isRunning = false, outcome = "sent" as string } = {}) {
  const threadId = `thr_b${++threads}`;
  const state = { form };
  const handlers = {
    followups_list: async () => ({ followUps: [], done: [], everRecorded: false }),
    followups_next_get: async () => ({ offer: null }),
    ask_get: async () => ({ form: state.form }),
    ask_answer: async () => ({ outcome, problem: outcome === "invalid" ? "That was already answered." : null }),
    ask_clear: async () => {
      state.form = null;
      return { outcome: "cleared" };
    },
  };
  const slot = renderSlot({ component: FollowUpBanner }, {}, {
    composer: { text: "", mentions: [], scope: { kind: "thread", threadId }, isRunning },
    rpc: handlers as never,
  });
  return Object.assign(slot, { threadId });
}

function renderPage(form: Form, subPath = "") {
  const card: Card = {
    threadId: "thr_a",
    title: "Thread a",
    projectId: "prj_1",
    parentThreadId: null,
    parentTitle: null,
    tier: "turn",
    lead: "ask",
    since: NOW - 60_000,
    attentionAt: NOW - 60_000,
    asks: [],
    form,
    offer: null,
    openFollowUps: 0,
    followUps: [],
    wrapUp: null,
    pr: null,
    pageUrl: null,
    excerpt: null,
    unread: true,
    status: "idle",
    reviewThreadId: null,
    putAway: false,
    prKey: null,
    workers: [],
  };
  const rpc = {
    page_snapshot: async () => ({ cards: [card], putAway: [], moreFinished: 0, count: 1, running: [], followUps: [], projects: [{ id: "prj_1", name: "bb-plugins" }] }),
    ask_answer: async () => ({ outcome: "sent", problem: null }),
  };
  return renderSlot({ component: FollowUpPage }, { subPath }, { rpc: rpc as never });
}

type Slot = ReturnType<typeof renderBanner> | ReturnType<typeof renderPage>;
const calls = (slot: Slot, method: string) => slot.inspection.rpcCalls.filter((call) => call.method === method).map((call) => call.input);
const sends = (slot: Slot) => slot.getByLabelText("What will be sent").querySelector("pre")?.textContent;

describe("a form above the composer", () => {
  it("shows the agent's recommendation picked, and the message before it goes", async () => {
    const slot = renderBanner(formOf([{ type: "text", text: "Two things." }, retry]));
    const form = await slot.findByRole("region", { name: "Form: Offline queue" });
    expect(within(form).getByText("Two things.")).toBeTruthy();
    expect(within(form).getByRole("radio", { name: /Back off/ }).getAttribute("aria-checked")).toBe("true");
    expect(within(form).getByRole("radio", { name: /Back off/ }).textContent).toContain("recommended");
    expect(within(form).getByText("Survives a long outage.")).toBeTruthy();
    expect(sends(slot)).toBe("My answers to “Offline queue”:\n\n1. How should a failed upload retry?\n   Back off");
    fireEvent.click(within(form).getByRole("radio", { name: /Retry at once/ }));
    expect(sends(slot)).toContain("   Retry at once");
    fireEvent.click(within(form).getByRole("button", { name: "Send answers" }));
    await waitFor(() => expect(calls(slot, "ask_answer")).toHaveLength(1));
    expect(calls(slot, "ask_answer")[0]).toEqual({ threadId: slot.threadId, askedAt: AT, answers: { retry: { type: "choice", selected: ["Retry at once"] } } });
  });

  it("won't send while a question is unanswered, and says which", async () => {
    const slot = renderBanner(formOf([{ ...retry, recommended: [] }, { type: "answer", id: "why", prompt: "Why?" }]));
    const send = (await slot.findByRole("button", { name: "Send answers" })) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    expect(slot.getByText("Still to answer: How should a failed upload retry?")).toBeTruthy();
    expect(slot.queryByLabelText("What will be sent")).toBeNull();
    fireEvent.click(slot.getByRole("radio", { name: /Back off/ }));
    expect(slot.getByText("Still to answer: Why?")).toBeTruthy();
    fireEvent.change(slot.getByLabelText("Why?"), { target: { value: "Because." } });
    expect(send.disabled).toBe(false);
    expect(sends(slot)).toMatch(/2\. Why\?\n   Because\.$/);
  });

  it("takes several, an answer of your own, ticks and an order", async () => {
    const slot = renderBanner(
      formOf([
        { ...retry, id: "many", multiple: true, allow_other: true, recommended: [] },
        { type: "pick", id: "screens", prompt: "Which screens?", items: [{ label: "Inbox" }, { label: "Compose" }], picked: ["Inbox"] },
        { type: "rank", id: "order", prompt: "What first?", options: [{ label: "Queue" }, { label: "Badge" }] },
      ]),
    );
    await slot.findByRole("region", { name: "Form: Offline queue" });
    fireEvent.click(slot.getByRole("checkbox", { name: /Back off/ }));
    fireEvent.click(slot.getByRole("checkbox", { name: /Retry at once/ }));
    fireEvent.change(slot.getByLabelText(/Your own answer to/), { target: { value: "and log it" } });
    fireEvent.click(slot.getByRole("checkbox", { name: "Compose" }));
    fireEvent.click(slot.getByRole("checkbox", { name: "Inbox" }));
    fireEvent.click(slot.getByRole("button", { name: 'Move "Badge" up' }));
    expect((slot.getByRole("button", { name: 'Move "Badge" up' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(slot.getByRole("button", { name: "Send answers" }));
    await waitFor(() => expect(calls(slot, "ask_answer")).toHaveLength(1));
    expect((calls(slot, "ask_answer")[0] as { answers: unknown }).answers).toEqual({
      many: { type: "choice", selected: ["Back off", "Retry at once"], other: "and log it" },
      screens: { type: "pick", picked: ["Compose"] },
      order: { type: "rank", order: ["Badge", "Queue"] },
    });
  });

  it("on a single choice, an answer of your own takes the place of the pick", async () => {
    const slot = renderBanner(formOf([{ ...retry, allow_other: true }]));
    await slot.findByRole("region", { name: "Form: Offline queue" });
    fireEvent.change(slot.getByLabelText(/Your own answer to/), { target: { value: "Never retry" } });
    expect(slot.getByRole("radio", { name: /Back off/ }).getAttribute("aria-checked")).toBe("false");
    expect(sends(slot)).toMatch(/   Never retry$/);
  });

  it("can be dismissed, to answer in chat instead", async () => {
    const slot = renderBanner(formOf([retry]));
    fireEvent.click(await slot.findByRole("button", { name: "Dismiss the form and answer in chat" }));
    await waitFor(() => expect(slot.queryByRole("region", { name: "Form: Offline queue" })).toBeNull());
    expect(calls(slot, "ask_clear")).toEqual([{ threadId: slot.threadId, askedAt: AT }]);
  });

  it("is not shown while a turn runs", async () => {
    const slot = renderBanner(formOf([retry]), { isRunning: true });
    await waitFor(() => expect(calls(slot, "ask_get").length).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(slot.queryByRole("region", { name: "Form: Offline queue" })).toBeNull();
  });

  it("shows nothing when there is no form", async () => {
    const slot = renderBanner(null);
    await waitFor(() => expect(calls(slot, "ask_get").length).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(slot.queryByRole("region")).toBeNull();
  });

  it.each([
    ["stale", "error", "That form was replaced or withdrawn. Nothing was sent."],
    ["invalid", "error", "That was already answered."],
    ["failed", "error", "It was not sent. Try again."],
    ["queued", "plain", "Queued behind the current turn."],
  ])("says so when an answer comes back %s", async (outcome, kind, message) => {
    const slot = renderBanner(formOf([retry]), { outcome });
    fireEvent.click(await slot.findByRole("button", { name: "Send answers" }));
    await waitFor(() => expect(kind === "error" ? toast.error : toast).toHaveBeenCalledWith(message));
  });
});

describe("items on the page's card", () => {
  const triage = () =>
    formOf(
      [
        issue(101, { badges: [{ label: "Done", tone: "success" }], recommended: "Close it" }),
        issue(118, { summary: "Reported twice.", draft: { label: "Comment to post", text: "Which file type?" }, url: "https://x.test/118" }),
        issue(124, { choices: [{ label: "Do it", description: "A one-line rename." }, { label: "Skip" }] }),
      ],
      "Triage",
    );

  it("decides items one by one, sends once, and says what is left", async () => {
    const slot = renderPage(triage());
    const form = await slot.findByRole("region", { name: "Form: Triage" });
    const send = within(form).getByRole("button", { name: "Send 0 decisions" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    expect(within(form).getByText("Pick what you want decided, then send.")).toBeTruthy();
    expect(within(form).getByText("Done")).toBeTruthy();
    expect(within(form).getByText("A one-line rename.")).toBeTruthy();
    const second = within(form).getByRole("article", { name: "#118 An issue" });
    fireEvent.change(within(second).getByLabelText("Comment to post"), { target: { value: "Which file type, and how big?" } });
    fireEvent.click(within(second).getByRole("radio", { name: "Leave open" }));
    expect(sends(slot)).toBe("On “Triage”:\n\n- #118 An issue: Leave open\n  Comment to post, as I edited it:\n  > Which file type, and how big?\n\n2 items are still undecided.");
    fireEvent.click(within(form).getByRole("button", { name: "Send 1 decision" }));
    await waitFor(() => expect(calls(slot, "ask_answer")).toHaveLength(1));
    expect(calls(slot, "ask_answer")[0]).toEqual({
      threadId: "thr_a",
      askedAt: AT,
      answers: { "issue-118": { type: "item", choice: "Leave open", draft: "Which file type, and how big?" } },
    });
  });

  it("a second press takes a decision back", async () => {
    const slot = renderPage(triage());
    const first = within(await slot.findByRole("region", { name: "Form: Triage" })).getByRole("article", { name: "#101 An issue" });
    fireEvent.click(within(first).getByRole("radio", { name: /Close it/ }));
    expect(slot.getByRole("button", { name: "Send 1 decision" })).toBeTruthy();
    fireEvent.click(within(first).getByRole("radio", { name: /Close it/ }));
    expect(slot.getByRole("button", { name: "Send 0 decisions" })).toBeTruthy();
  });

  it("marks a recommendation without picking it, and takes them all in one press", async () => {
    const slot = renderPage(triage());
    const form = await slot.findByRole("region", { name: "Form: Triage" });
    const first = within(form).getByRole("article", { name: "#101 An issue" });
    expect(within(first).getByRole("radio", { name: /Close it/ }).getAttribute("aria-checked")).toBe("false");
    expect(within(first).getByRole("radio", { name: /Close it/ }).textContent).toContain("recommended");
    fireEvent.click(within(form).getByRole("button", { name: "Take the recommendation" }));
    expect(within(first).getByRole("radio", { name: /Close it/ }).getAttribute("aria-checked")).toBe("true");
    expect(within(form).queryByRole("button", { name: /Take the recommendation/ })).toBeNull();
    expect(sends(slot)).toMatch(/^On “Triage”:\n\n- #101 An issue: Close it\n\n2 items are still undecided\.$/);
  });

  it("folds what is already decided, and counts what is left", async () => {
    const slot = renderPage({ ...triage(), done: { "issue-101": "Close it" } });
    const form = await slot.findByRole("region", { name: "Form: Triage" });
    expect(within(form).getByRole("article", { name: "#101 An issue: Close it" })).toBeTruthy();
    expect(within(form).queryByRole("radiogroup", { name: "Decide: #101 An issue" })).toBeNull();
    expect(within(form).getByText("2 of 3 to decide")).toBeTruthy();
    // No way to drop a form from the page's card: that is the thread's, and Not now is the card's.
    expect(within(form).queryByRole("button", { name: /Dismiss the form/ })).toBeNull();
  });

  it("opens an item's link through bb", async () => {
    const slot = renderPage(triage());
    fireEvent.click(await slot.findByRole("button", { name: "#118 An issue" }));
    expect(slot.inspection.navigateCalls.at(-1)).toMatchObject({ method: "openUrl", url: "https://x.test/118" });
  });

  it("draws code, a diff, a table and a link from their parts", async () => {
    const slot = renderPage(
      formOf([
        { type: "code", title: "The guard", code: { text: "if (admin) {}" } },
        { type: "code", code: { text: "@@ -1 +1 @@\n-a\n+b", path: "src/a.ts", diff: true } },
        { type: "table", columns: ["Option", "Cost"], rows: [["Back off", "Low"]] },
        { type: "link", label: "The issue", url: "https://x.test/1" },
        retry,
      ]),
    );
    const form = await slot.findByRole("region", { name: "Form: Offline queue" });
    expect(within(form).getByText("The guard")).toBeTruthy();
    expect(within(form).getByText("if (admin) {}")).toBeTruthy();
    expect(within(form).getByTestId("bb-diff").getAttribute("data-path")).toBe("src/a.ts");
    expect(within(form).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Option", "Cost"]);
    expect(within(form).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["Back off", "Low"]);
    fireEvent.click(within(form).getByRole("button", { name: "The issue" }));
    expect(slot.inspection.navigateCalls.at(-1)).toMatchObject({ method: "openUrl", url: "https://x.test/1" });
  });
});

describe("a form's text", () => {
  it("is drawn by Follow Up, never by bb's Markdown, and can draw no image or HTML", async () => {
    const slot = renderPage(
      formOf([
        { type: "text", text: 'Read **this** and `that`.\n\n![shot](https://x.test/a.png) ![a [b] c](https://x.test/b.png)\n\n<img src="https://x.test/c.png"> <iframe src="https://x.test"></iframe>\n\n- one\n- two' },
        issue(1, { summary: "![shot](https://x.test/d.png) and [the issue](https://x.test/1)" }),
      ]),
    );
    const form = await slot.findByRole("region", { name: "Form: Offline queue" });
    expect(form.querySelectorAll("img, iframe, picture, svg image, video, object, embed").length).toBe(0);
    expect(within(form).queryByTestId("bb-markdown")).toBeNull();
    expect(form.querySelector("strong")?.textContent).toBe("this");
    expect(form.querySelector("code")?.textContent).toBe("that");
    expect(within(form).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["one", "two"]);
    expect(within(form).getByText(/<img src="https:\/\/x\.test\/c\.png">/)).toBeTruthy();
    // A link is pressed to be followed, through bb, and shows where it goes.
    const link = within(form).getByRole("button", { name: "the issue" });
    expect(link.getAttribute("title")).toBe("https://x.test/1");
    expect(slot.inspection.navigateCalls).toHaveLength(0);
    fireEvent.click(link);
    expect(slot.inspection.navigateCalls.at(-1)).toMatchObject({ method: "openUrl", url: "https://x.test/1" });
  });
});

describe("a form in Focus", () => {
  const key = (k: string) => fireEvent.keyDown(window, { key: k });

  it("number keys pick for the question, then for each item, and Enter sends", async () => {
    const slot = renderPage(formOf([{ ...retry, recommended: [] }, issue(1), issue(2)]), "focus");
    const form = await slot.findByRole("region", { name: "Form: Offline queue" });
    expect(within(form).getByRole("radio", { name: /Back off/ }).querySelector("kbd")?.textContent).toBe("1");
    key("Enter");
    expect(calls(slot, "ask_answer")).toHaveLength(0);
    key("2");
    expect(within(form).getByRole("radio", { name: /Retry at once/ }).getAttribute("aria-checked")).toBe("true");
    // The keys have moved on to the first item.
    expect(within(form).getByRole("radio", { name: /Back off/ }).querySelector("kbd")).toBeNull();
    key("1");
    expect(within(within(form).getByRole("article", { name: "#1 An issue" })).getByRole("radio", { name: /Close it/ }).getAttribute("aria-checked")).toBe("true");
    key("2");
    expect(within(within(form).getByRole("article", { name: "#2 An issue" })).getByRole("radio", { name: /Leave open/ }).getAttribute("aria-checked")).toBe("true");
    key("Enter");
    await waitFor(() => expect(calls(slot, "ask_answer")).toHaveLength(1));
    expect((calls(slot, "ask_answer")[0] as { answers: unknown }).answers).toEqual({
      retry: { type: "choice", selected: ["Retry at once"] },
      "issue-1": { type: "item", choice: "Close it" },
      "issue-2": { type: "item", choice: "Leave open" },
    });
  });

  it("shows no key numbers outside Focus", async () => {
    const slot = renderPage(formOf([retry, issue(1)]));
    const form = await slot.findByRole("region", { name: "Form: Offline queue" });
    expect(form.querySelector("kbd")).toBeNull();
  });
});
