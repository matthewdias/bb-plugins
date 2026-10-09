import { describe, expect, it } from "vitest";
import type { PluginSidebarPullRequest } from "@get-bb/plugin-sdk/app";
import { normalizeValue } from "../lib/complications";
import { prValue } from "../lib/pr-value";
import { readDetail, readOpen } from "../lib/validate";

function pr(overrides: Partial<PluginSidebarPullRequest> = {}): PluginSidebarPullRequest {
  return {
    experimental_autoMerge: false,
    experimental_inMergeQueue: false,
    experimental_checks: { state: "passing" },
    experimental_review: { state: "none" },
    experimental_mergeability: { state: "mergeable" },
    number: 41,
    title: "Thread Summary",
    url: "https://github.com/matthewdias/bb-plugins/pull/41",
    state: "open",
    attention: "none",
    ...overrides,
  };
}

describe("prValue", () => {
  it("has nothing to say without a pull request", () => {
    expect(prValue(null)).toBeNull();
  });

  it("is the PR icon, number and title, opening the PR", () => {
    const value = prValue(pr())!;
    expect(value).toMatchObject({ icon: "GitPullRequest", label: "#41 Thread Summary" });
    expect(readOpen(value)).toEqual({ href: "https://github.com/matthewdias/bb-plugins/pull/41" });
    expect(normalizeValue(value)).toBeTruthy();
  });

  it.each([
    ["checks_failed", "error", "checks failing"],
    ["conflicts", "error", "conflicts"],
    ["checks_pending", "running", "checks running"],
    ["changes_requested", "warning", "changes requested"],
    ["blocked", "warning", "blocked"],
    ["review_requested", "info", "review requested"],
    ["ready_to_merge", "success", "ready to merge"],
    ["queued", "running", "in merge queue"],
    ["merged", "success", "merged"],
    ["draft", "default", "draft"],
    ["closed", "default", "closed"],
  ] as const)("reads %s as %s, saying %s", (attention, tone, text) => {
    expect(prValue(pr({ attention }))).toMatchObject({ tone, text });
  });

  it("says nothing beside the glyph for a quiet open PR", () => {
    const value = prValue(pr({ attention: "none" }))!;
    expect(value.tone).toBe("default");
    expect(value.text).toBeUndefined();
  });

  it("treats an attention state bb adds later as default", () => {
    const value = prValue(pr({ attention: "something_new" as PluginSidebarPullRequest["attention"] }))!;
    expect(value.tone).toBe("default");
    expect(value.text).toBeUndefined();
  });

  it("is one line: no detail, and a link to the pull request", () => {
    const value = prValue(pr({ attention: "checks_failed", experimental_autoMerge: true, experimental_inMergeQueue: true })) as unknown as Record<string, unknown>;
    expect(Object.keys(value).sort()).toEqual(["icon", "label", "open", "text", "tone"]);
    expect(readDetail(value)).toBeNull();
  });
});
