import { describe, expect, it, vi } from "vitest";
import { fireEvent, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { FollowUpBanner } from "../../src/banner.tsx";
import type { FollowUp } from "../../lib/followups.ts";

// A filed row sits in Done saying where it went, with the link back to it.

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const AT = "2026-10-06T12:00:00.000Z";
const base = (id: string, text: string, extra: Partial<FollowUp>): FollowUp => ({
  id,
  text,
  reason: "deferred",
  file: null,
  detail: null,
  createdAt: AT,
  doneAt: AT,
  doneBy: "user",
  ...extra,
});

const linked = base("f1", "Fix the restore", {
  filedAt: AT,
  filedTo: { id: "github", name: "GitHub" },
  filedRef: "https://github.com/acme/app/issues/212",
});
const keyed = base("f2", "Rate-limit the export", {
  filedAt: AT,
  filedTo: { id: "jira-eng", name: "Jira ENG" },
  filedRef: "ENG-1482",
});
const done = base("d1", "Tidy the loader", {});

function renderDone(threadId: string) {
  return renderSlot({ component: FollowUpBanner }, {}, {
    composer: { text: "", mentions: [], scope: { kind: "thread", threadId } },
    rpc: {
      followups_list: async () => ({ followUps: [], done: [linked, keyed, done], everRecorded: true }),
      followups_next_get: async () => ({ offer: null }),
    } as never,
  });
}

describe("filed rows in Done", () => {
  it("say where they went, linking a URL and showing a key as given", async () => {
    const slot = renderDone("thr_filed");
    fireEvent.click(await slot.findByRole("button", { name: "Show the 3 done follow-ups" }));
    const link = await slot.findByRole("link", { name: "Open GitHub: https://github.com/acme/app/issues/212" });
    expect(link.getAttribute("href")).toBe("https://github.com/acme/app/issues/212");
    expect(link.textContent).toBe("212");
    const keyedRow = (await slot.findByText("Rate-limit the export")).closest("li")!;
    expect(within(keyedRow).getByText("→ Jira ENG")).toBeDefined();
    expect(within(keyedRow).getByText("ENG-1482")).toBeDefined();
    expect(within(keyedRow).queryByRole("link")).toBeNull();
  });

  it("are not struck through: the work is tracked elsewhere, not done", async () => {
    const slot = renderDone("thr_filed_strike");
    fireEvent.click(await slot.findByRole("button", { name: "Show the 3 done follow-ups" }));
    expect((await slot.findByText("Fix the restore")).className).not.toMatch(/line-through/);
    expect((await slot.findByText("Tidy the loader")).className).toMatch(/line-through/);
  });
});
