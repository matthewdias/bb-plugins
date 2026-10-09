import { describe, expect, it, vi } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { FollowUpPage, FollowUpPageCount, NeedsYouStrip } from "../../src/page/page.tsx";
import type { Card, LaneGroup, PrSummary, Running } from "../../lib/page.ts";

// The Follow Up page: one card per thread that wants you, answered in place,
// beside what is running and every open follow-up.

vi.mock("sonner", () => {
  const toast = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() });
  return { toast };
});

const NOW = Date.now();

const card = (threadId: string, extra: Partial<Card> = {}): Card => ({
  threadId,
  title: `Thread ${threadId}`,
  projectId: "prj_1",
  parentThreadId: null,
  parentTitle: null,
  tier: "finished",
  lead: "finished",
  since: NOW - 5 * 60_000,
  asks: [],
  offer: null,
  openFollowUps: 0,
  wrapUp: null,
  pr: null,
  pageUrl: null,
  excerpt: null,
  unread: true,
  status: "idle",
  reviewThreadId: null,
  ...extra,
});

const question = (threadId: string): Card =>
  card(threadId, {
    tier: "blocked",
    lead: "question",
    status: "active",
    asks: [
      {
        kind: "question",
        interactionId: "int_1",
        createdAt: NOW - 11 * 60_000,
        questions: [
          {
            id: "q1",
            prompt: "Should middle-click open a background tab?",
            shortLabel: null,
            multiSelect: false,
            allowFreeText: true,
            options: [
              { label: "Background tab", value: "bg", description: "Matches browsers." },
              { label: "Foreground tab", value: "fg", description: null },
            ],
          },
        ],
      },
    ],
    since: NOW - 11 * 60_000,
  });

const pr = (attention: string, extra: Partial<PrSummary> = {}) => ({
  number: 44,
  title: "Add the page",
  url: "https://github.com/o/r/pull/44",
  state: "open",
  attention,
  headRefName: "feature",
  baseRefName: "main",
  checks: { state: "passing", passed: 14, failed: 0, pending: 0, total: 14 },
  mergeability: "mergeable",
  ...extra,
});

function renderPage({
  cards = [],
  running = [],
  followUps = [],
  handlers = {},
}: {
  cards?: Card[];
  running?: Running[];
  followUps?: LaneGroup[];
  handlers?: Record<string, (input: any) => Promise<unknown>>;
}) {
  const rpc = {
    page_snapshot: async () => ({
      cards,
      moreFinished: 0,
      count: cards.filter((c) => c.tier !== "finished").length,
      running,
      followUps,
      projects: [{ id: "prj_1", name: "bb-plugins" }],
    }),
    page_answer: async () => ({ outcome: "answered" }),
    page_hide: async () => ({ outcome: "done" }),
    page_reply: async () => ({ outcome: "sent" }),
    page_mark_read: async () => ({ outcome: "done" }),
    followups_next_take: async () => ({ outcome: "sent" }),
    ...handlers,
  };
  return renderSlot({ component: FollowUpPage }, { subPath: "" }, { rpc: rpc as never });
}

type Slot = ReturnType<typeof renderPage>;
const calls = (slot: Slot, method: string) =>
  slot.inspection.rpcCalls.filter((call) => call.method === method).map((call) => call.input);

describe("the page", () => {
  it("puts blocked threads first, then your turn, then finished", async () => {
    const slot = renderPage({
      cards: [
        question("thr_q"),
        card("thr_next", { tier: "turn", lead: "next", offer: { steps: ["Open a PR"], goalMet: false, offeredAt: "x" } }),
        card("thr_done", { excerpt: "All done." }),
      ],
    });
    const sections = await slot.findAllByRole("region");
    expect(sections.map((section) => section.getAttribute("aria-label")).slice(0, 3)).toEqual([
      "Blocked",
      "Your turn",
      "Finished",
    ]);
    expect(slot.getByText("1 blocked")).toBeTruthy();
    expect(slot.getByText("1 your turn")).toBeTruthy();
  });

  it("answers a question in place, with the option's value and any text", async () => {
    const slot = renderPage({ cards: [question("thr_q")] });
    const send = await slot.findByRole("button", { name: "Send answer" });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(slot.getByRole("radio", { name: /Background tab/ }));
    fireEvent.change(slot.getByLabelText(/Your own answer to/), { target: { value: "and remember it" } });
    fireEvent.click(send);
    await waitFor(() => expect(calls(slot, "page_answer")).toHaveLength(1));
    expect(calls(slot, "page_answer")[0]).toEqual({
      threadId: "thr_q",
      interactionId: "int_1",
      answers: { q1: { selected: ["bg"], freeText: "and remember it" } },
    });
  });

  it("presses a next step with the offer it belongs to", async () => {
    const slot = renderPage({
      cards: [card("thr_next", { tier: "turn", lead: "next", offer: { steps: ["Delete the branch"], goalMet: false, offeredAt: "at-1" } })],
    });
    fireEvent.click(await slot.findByRole("button", { name: 'Send "Delete the branch"' }));
    await waitFor(() => expect(calls(slot, "followups_next_take")).toHaveLength(1));
    expect(calls(slot, "followups_next_take")[0]).toEqual({ threadId: "thr_next", offeredAt: "at-1", index: 0 });
  });

  it("Not now hides a card at the attention it was showing", async () => {
    const done = card("thr_done", { since: 12345 });
    const slot = renderPage({ cards: [done] });
    fireEvent.click(await slot.findByRole("button", { name: /Not now/ }));
    await waitFor(() => expect(calls(slot, "page_hide")).toEqual([{ threadId: "thr_done", at: 12345 }]));
  });

  it("a blocked card cannot be put off", async () => {
    const slot = renderPage({ cards: [question("thr_q")] });
    await slot.findByRole("button", { name: "Send answer" });
    expect(slot.queryByRole("button", { name: /Not now/ })).toBeNull();
  });

  it("asks a project's merge method once, then merges with it", async () => {
    const merges: unknown[] = [];
    const slot = renderPage({
      cards: [card("thr_pr", { tier: "turn", lead: "pr", pr: { ...pr("ready_to_merge"), action: "merge" } })],
      handlers: {
        page_pr_merge: async (input: { method?: string }) => {
          merges.push(input);
          return input.method === undefined
            ? { outcome: "needs-method", method: null, message: null }
            : { outcome: "merged", method: input.method, message: null };
        },
      },
    });
    fireEvent.click(await slot.findByRole("button", { name: /^Merge$/ }));
    fireEvent.click(await slot.findByRole("button", { name: "Squash" }));
    await waitFor(() => expect(merges).toEqual([{ threadId: "thr_pr" }, { threadId: "thr_pr", method: "squash" }]));
  });

  it("shows a pull request's fix message before sending it, and sends what the box holds", async () => {
    const failing = { ...pr("checks_failed", { checks: { state: "failing", passed: 11, failed: 1, pending: 0, total: 12 } }), action: "fix" as const };
    const slot = renderPage({ cards: [card("thr_pr", { tier: "turn", lead: "pr", pr: failing })] });
    fireEvent.click(await slot.findByRole("button", { name: "Ask the thread to fix" }));
    const box = slot.getByRole("textbox") as HTMLTextAreaElement;
    expect(box.value).toBe("CI failed on PR #44: 1 check is failing. Find out why, fix it, and push.");
    fireEvent.change(box, { target: { value: "Fix the node 24 job only." } });
    fireEvent.click(slot.getByRole("button", { name: "Send to the thread" }));
    await waitFor(() => expect(calls(slot, "page_reply")).toEqual([{ threadId: "thr_pr", text: "Fix the node 24 job only." }]));
  });

  it("refetches when the server says something moved", async () => {
    const slot = renderPage({});
    await slot.findByText("No thread is waiting on you.");
    const before = calls(slot, "page_snapshot").length;
    await slot.emitRealtime("followups-page-changed", {});
    await waitFor(() => expect(calls(slot, "page_snapshot").length).toBe(before + 1));
  });

  it("lists running threads with what they are doing, and follow-ups by project", async () => {
    const slot = renderPage({
      running: [
        { threadId: "thr_run", title: "Updates deck", projectId: "prj_1", status: "active", startedAt: NOW - 12 * 60_000, now: "Running npm test", openFollowUps: 2, doneFollowUps: 1 },
      ],
      followUps: [
        {
          projectId: "prj_1",
          projectName: "bb-plugins",
          threads: [
            { threadId: "thr_arch", title: "Old work", archived: true, rows: [{ id: "r1", text: "Retry expired tokens", reason: "blocked", lead: "handoff", inProgress: false }] },
          ],
        },
      ],
    });
    const motion = await slot.findByRole("region", { name: "In motion" });
    expect(within(motion).getByText("Running npm test")).toBeTruthy();
    expect(within(motion).getByText(/2 of 3 follow-ups open/)).toBeTruthy();
    const lane = slot.getByRole("region", { name: "Follow-ups" });
    expect(within(lane).getByText("archived")).toBeTruthy();
    expect(within(lane).getByRole("button", { name: "Hand off" })).toBeTruthy();
  });
});

describe("the sidebar count and the new-thread strip", () => {
  const summary = {
    page_summary: async () => ({
      count: 4,
      top: [question("thr_q"), card("thr_pr", { tier: "turn", lead: "pr" }), card("thr_stop", { tier: "turn", lead: "stopped" })],
    }),
  };

  it("counts threads that want you", async () => {
    const slot = renderSlot({ component: FollowUpPageCount }, {}, { rpc: summary as never });
    expect((await slot.findByLabelText("4 threads need you")).textContent).toBe("4");
  });

  it("shows nothing when nothing is waiting", async () => {
    const slot = renderSlot({ component: FollowUpPageCount }, {}, {
      rpc: { page_summary: async () => ({ count: 0, top: [] }) } as never,
    });
    await waitFor(() => expect(slot.inspection.rpcCalls.length).toBe(1));
    expect(slot.container.textContent).toBe("");
  });

  it("links the first few threads and the page for the rest", async () => {
    const slot = renderSlot({ component: NeedsYouStrip }, { projectId: null }, { rpc: summary as never });
    fireEvent.click(await slot.findByText("Thread thr_q"));
    fireEvent.click(slot.getByRole("button", { name: "All 4 on the Follow Up page" }));
    expect(slot.inspection.navigateCalls).toEqual([
      { method: "toThread", threadId: "thr_q" },
      { method: "toPluginPanel", path: "page" },
    ]);
  });
});
