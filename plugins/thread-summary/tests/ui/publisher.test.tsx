import { afterEach, describe, expect, it, vi } from "vitest";
import { act, waitFor } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import type { PluginSidebarPullRequest, PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { GIT_ID, PULL_REQUEST_ID } from "../../lib/order";
import { registry, sidebarThread } from "./fixtures";

// The harness fixes the sidebar's threads at render; a thread going from busy
// to idle needs them to change, so this one hook reads a store the test moves.
let sidebar: readonly PluginSidebarThread[] = [];
const sidebarListeners = new Set<() => void>();
function setSidebar(next: readonly PluginSidebarThread[]) {
  sidebar = next;
  for (const listener of [...sidebarListeners]) listener();
}
vi.mock("@get-bb/plugin-sdk/app", async (original) => ({
  ...(await original<typeof import("@get-bb/plugin-sdk/app")>()),
  experimental_useSidebarThreads: () => ({
    status: "ready",
    experimental_archived: null,
    threads: useSyncExternalStore(
      (listener) => {
        sidebarListeners.add(listener);
        return () => sidebarListeners.delete(listener);
      },
      () => sidebar,
    ),
  }),
}));

const { Publisher } = await import("../../src/publisher");
const { markOpen } = await import("../../src/open-cards");

let count = 0;
const fresh = () => `thr_pub${++count}`;
const subject = (id: string) => ({ kind: "thread", id });

const releases: (() => void)[] = [];
const want = (id: string, threadId: string) => releases.push(registry.want(id, subject(threadId)));
afterEach(() => {
  for (const release of releases.splice(0)) release();
  vi.useRealTimers();
});

function pr(number: number): PluginSidebarPullRequest {
  return {
    experimental_autoMerge: false,
    experimental_inMergeQueue: false,
    experimental_checks: { state: "failing" },
    experimental_review: { state: "none" },
    experimental_mergeability: { state: "mergeable" },
    number,
    title: `PR ${number}`,
    url: `https://github.com/x/y/pull/${number}`,
    state: "open",
    attention: "checks_failed",
  };
}

const clean = (ahead: number) => ({
  outcome: "available",
  workspace: {
    branch: { currentBranch: "feature", defaultBranch: "main" },
    checkout: { kind: "branch", branchName: "feature", headSha: null },
    mergeBase: { aheadCount: ahead, behindCount: 0, mergeBaseBranch: "main", files: [] },
    workingTree: { hasUncommittedChanges: false, files: [] },
  },
});

function render(threads: Record<string, { pr?: number }>, ahead = { value: 1 }) {
  const statusCalls: string[] = [];
  const slot = renderSlot({ component: Publisher }, {}, {
    sidebarPullRequests: Object.fromEntries(
      Object.entries(threads)
        .filter(([, entry]) => entry.pr !== undefined)
        .map(([threadId, entry]) => [threadId, pr(entry.pr!)]),
    ),
    sdk: {
      threads: { get: async ({ threadId }: { threadId: string }) => ({ environmentId: `env_${threadId}` }) },
      environments: {
        get: async () => ({ mergeBaseBranch: "main", defaultBranch: "main" }),
        status: async ({ environmentId }: { environmentId: string }) => {
          statusCalls.push(environmentId);
          return clean(ahead.value);
        },
      },
    } as never,
  });
  return { slot, statusCalls };
}

describe("the publisher", () => {
  it("answers the pull request for wanted threads only", async () => {
    const wanted = fresh();
    const other = fresh();
    want(PULL_REQUEST_ID, wanted);
    render({ [wanted]: { pr: 7 }, [other]: { pr: 8 } });
    await waitFor(() => expect(registry.read(PULL_REQUEST_ID, subject(wanted))?.label).toBe("#7 PR 7"));
    expect(registry.read(PULL_REQUEST_ID, subject(wanted))?.tone).toBe("error");
    expect(registry.read(PULL_REQUEST_ID, subject(other))).toBeUndefined();
  });

  it("says nothing to say for a wanted thread without a pull request", async () => {
    const threadId = fresh();
    want(PULL_REQUEST_ID, threadId);
    render({ [threadId]: {} });
    await waitFor(() => expect(registry.read(PULL_REQUEST_ID, subject(threadId))).toBeNull());
  });

  it("answers Git for wanted threads only, asking each one's environment", async () => {
    const wanted = fresh();
    const other = fresh();
    want(GIT_ID, wanted);
    const { statusCalls } = render({ [wanted]: {}, [other]: {} });
    await waitFor(() => expect(registry.read(GIT_ID, subject(wanted))?.label).toBe("feature → main"));
    expect(statusCalls).toEqual([`env_${wanted}`]);
    expect(registry.read(GIT_ID, subject(other))).toBeUndefined();
  });

  it("answers a thread wanted after it loaded", async () => {
    const { statusCalls } = render({});
    const late = fresh();
    want(GIT_ID, late);
    await waitFor(() => expect(statusCalls).toEqual([`env_${late}`]));
  });

  it("asks Git again when the thread's agent goes from busy to idle", async () => {
    const threadId = fresh();
    want(GIT_ID, threadId);
    const ahead = { value: 1 };
    act(() => setSidebar([sidebarThread(threadId, "env", "active")]));
    const { statusCalls } = render({ [threadId]: {} }, ahead);
    await waitFor(() => expect(registry.read(GIT_ID, subject(threadId))?.text).toBe("↑1"));
    ahead.value = 2;
    act(() => setSidebar([sidebarThread(threadId, "env", "active")]));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(statusCalls).toHaveLength(1);
    act(() => setSidebar([sidebarThread(threadId, "env", "idle")]));
    await waitFor(() => expect(registry.read(GIT_ID, subject(threadId))?.text).toBe("↑2"));
    expect(statusCalls).toHaveLength(2);
  });

  it("asks Git again when a card opens, and every 20 seconds while it stays open", async () => {
    const threadId = fresh();
    want(GIT_ID, threadId);
    const { statusCalls } = render({ [threadId]: {} });
    await waitFor(() => expect(statusCalls).toHaveLength(1));
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"], shouldAdvanceTime: true });
    let close = () => undefined as void;
    act(() => {
      close = markOpen(threadId);
    });
    await waitFor(() => expect(statusCalls).toHaveLength(2));
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    await waitFor(() => expect(statusCalls).toHaveLength(3));
    act(() => close());
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(statusCalls).toHaveLength(3);
  });
});
