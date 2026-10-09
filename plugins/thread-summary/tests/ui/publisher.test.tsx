import { afterEach, describe, expect, it, vi } from "vitest";
import { act, waitFor } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import type {
  PluginSidebarPullRequest,
  PluginSidebarThread,
  PluginSidebarThreadPullRequestState,
} from "@get-bb/plugin-sdk/app";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { GIT_ID, PULL_REQUEST_ID } from "../../lib/order";
import { registry, sidebarThread } from "./fixtures";

// The harness fixes the sidebar's threads and pull requests at render. A
// thread going from busy to idle, getting an environment, or a pull request
// finishing its first lookup all need them to change, so both hooks read
// stores the test moves.
function store<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: T) {
      value = next;
      for (const listener of [...listeners]) listener();
    },
    use(): T {
      return useSyncExternalStore(
        (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        () => value,
      );
    },
  };
}

const sidebar = store<{ status: "loading" | "ready"; threads: readonly PluginSidebarThread[] }>({
  status: "ready",
  threads: [],
});
const pullRequests = store<Readonly<Record<string, PluginSidebarThreadPullRequestState>>>({});

vi.mock("@get-bb/plugin-sdk/app", async (original) => ({
  ...(await original<typeof import("@get-bb/plugin-sdk/app")>()),
  experimental_useSidebarThreads: () => ({ experimental_archived: null, ...sidebar.use() }),
  experimental_useSidebarThreadPullRequest: (threadId: string) =>
    pullRequests.use()[threadId] ?? { isLoading: false, pullRequest: null },
}));

const { Publisher, MAX_CONCURRENT_GIT, PRUNE_MS } = await import("../../src/publisher");
const { markOpen } = await import("../../src/open-cards");

let count = 0;
const fresh = () => `thr_pub${++count}`;
const subject = (id: string) => ({ kind: "thread", id });

const releases: (() => void)[] = [];
function want(id: string, threadId: string): () => void {
  const release = registry.want(id, subject(threadId));
  releases.push(release);
  return release;
}
afterEach(() => {
  for (const release of releases.splice(0)) release();
  vi.useRealTimers();
  act(() => {
    sidebar.set({ status: "ready", threads: [] });
    pullRequests.set({});
  });
});

/** Timers that still advance on their own, so `waitFor` keeps polling. */
const fakeIntervals = () => vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"], shouldAdvanceTime: true });
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));

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

const status = (ahead: number) => ({
  outcome: "available",
  workspace: {
    branch: { currentBranch: "feature", defaultBranch: "main" },
    checkout: { kind: "branch", branchName: "feature", headSha: null },
    mergeBase: { aheadCount: ahead, behindCount: 0, mergeBaseBranch: "main", files: [] },
    workingTree: { hasUncommittedChanges: false, files: [] },
  },
});

interface Backend {
  /** What the next status call answers; a function may hold its answer back. */
  answer?: (environmentId: string, call: number) => unknown;
  /** Environments `threads.get` reports, for threads the sidebar does not list. */
  threadEnvironments?: Record<string, string | null>;
}

function render({ answer = () => status(1), threadEnvironments = {} }: Backend = {}) {
  const statusCalls: string[] = [];
  const slot = renderSlot({ component: Publisher }, {}, {
    sdk: {
      threads: {
        get: async ({ threadId }: { threadId: string }) => ({
          environmentId: threadEnvironments[threadId] ?? null,
        }),
      },
      environments: {
        get: async () => ({ mergeBaseBranch: "main", defaultBranch: "main" }),
        status: async ({ environmentId }: { environmentId: string }) => {
          statusCalls.push(environmentId);
          return answer(environmentId, statusCalls.length);
        },
      },
    } as never,
  });
  const sdkCalls = () => slot.inspection.sdkCalls.map((call) => (call as { method?: string }).method ?? String(call));
  return { slot, statusCalls, sdkCalls };
}

const gitText = (threadId: string) => registry.read(GIT_ID, subject(threadId))?.text;

describe("the pull-request provider", () => {
  it("answers wanted threads only", async () => {
    const wanted = fresh();
    const other = fresh();
    act(() => pullRequests.set({ [wanted]: { isLoading: false, pullRequest: pr(7) }, [other]: { isLoading: false, pullRequest: pr(8) } }));
    want(PULL_REQUEST_ID, wanted);
    render();
    await waitFor(() => expect(registry.read(PULL_REQUEST_ID, subject(wanted))?.label).toBe("#7 PR 7"));
    expect(registry.read(PULL_REQUEST_ID, subject(wanted))?.tone).toBe("error");
    expect(registry.read(PULL_REQUEST_ID, subject(other))).toBeUndefined();
  });

  it("says there is nothing to say for a thread without a pull request", async () => {
    const threadId = fresh();
    want(PULL_REQUEST_ID, threadId);
    render();
    await waitFor(() => expect(registry.read(PULL_REQUEST_ID, subject(threadId))).toBeNull());
  });

  it("holds its answer until the first lookup lands", async () => {
    const threadId = fresh();
    act(() => pullRequests.set({ [threadId]: { isLoading: true, pullRequest: null } }));
    want(PULL_REQUEST_ID, threadId);
    render();
    await settle();
    // Not `null`: that would say "no pull request" over a value a surface kept.
    expect(registry.read(PULL_REQUEST_ID, subject(threadId))).toBeUndefined();
    act(() => pullRequests.set({ [threadId]: { isLoading: false, pullRequest: pr(9) } }));
    await waitFor(() => expect(registry.read(PULL_REQUEST_ID, subject(threadId))?.label).toBe("#9 PR 9"));
  });

  it("stops probing a thread nobody wants, and probes it again the moment it is wanted", async () => {
    fakeIntervals();
    const threadId = fresh();
    act(() => pullRequests.set({ [threadId]: { isLoading: false, pullRequest: pr(1) } }));
    const release = want(PULL_REQUEST_ID, threadId);
    render();
    await waitFor(() => expect(registry.read(PULL_REQUEST_ID, subject(threadId))?.label).toBe("#1 PR 1"));
    release();
    act(() => {
      vi.advanceTimersByTime(PRUNE_MS);
    });
    act(() => pullRequests.set({ [threadId]: { isLoading: false, pullRequest: pr(2) } }));
    await settle();
    expect(registry.read(PULL_REQUEST_ID, subject(threadId))?.label).toBe("#1 PR 1");
    want(PULL_REQUEST_ID, threadId);
    await waitFor(() => expect(registry.read(PULL_REQUEST_ID, subject(threadId))?.label).toBe("#2 PR 2"));
  });
});

describe("the Git provider", () => {
  it("answers wanted threads only, from the sidebar's environment, without asking for the thread", async () => {
    const wanted = fresh();
    const other = fresh();
    act(() => sidebar.set({ status: "ready", threads: [sidebarThread(wanted, "env_a"), sidebarThread(other, "env_b")] }));
    want(GIT_ID, wanted);
    const { statusCalls, sdkCalls } = render();
    await waitFor(() => expect(registry.read(GIT_ID, subject(wanted))?.label).toBe("feature → main"));
    expect(statusCalls).toEqual(["env_a"]);
    expect(registry.read(GIT_ID, subject(other))).toBeUndefined();
    // A refresh is the environment, for its merge-base branch, then the status.
    expect(sdkCalls()).toEqual(["environments.get", "environments.status"]);
  });

  it("answers a thread wanted after it loaded", async () => {
    const late = fresh();
    act(() => sidebar.set({ status: "ready", threads: [sidebarThread(late, "env_late")] }));
    const { statusCalls } = render();
    want(GIT_ID, late);
    await waitFor(() => expect(statusCalls).toEqual(["env_late"]));
  });

  it("waits for the sidebar's thread list before asking", async () => {
    const threadId = fresh();
    act(() => sidebar.set({ status: "loading", threads: [] }));
    want(GIT_ID, threadId);
    const { statusCalls, sdkCalls } = render();
    await settle();
    expect(statusCalls).toEqual([]);
    expect(sdkCalls()).toEqual([]);
    act(() => sidebar.set({ status: "ready", threads: [sidebarThread(threadId, "env_ready")] }));
    await waitFor(() => expect(statusCalls).toEqual(["env_ready"]));
  });

  it("answers again when a thread with no environment gets one", async () => {
    const threadId = fresh();
    act(() => sidebar.set({ status: "ready", threads: [sidebarThread(threadId, null)] }));
    want(GIT_ID, threadId);
    const { statusCalls } = render();
    await waitFor(() => expect(registry.read(GIT_ID, subject(threadId))).toBeNull());
    act(() => sidebar.set({ status: "ready", threads: [sidebarThread(threadId, "env_new")] }));
    await waitFor(() => expect(gitText(threadId)).toBe("↑1"));
    expect(statusCalls).toEqual(["env_new"]);
  });

  it("follows a thread that moves to another environment", async () => {
    const threadId = fresh();
    act(() => sidebar.set({ status: "ready", threads: [sidebarThread(threadId, "env_old")] }));
    want(GIT_ID, threadId);
    const { statusCalls } = render({ answer: (environmentId) => status(environmentId === "env_old" ? 1 : 5) });
    await waitFor(() => expect(gitText(threadId)).toBe("↑1"));
    act(() => sidebar.set({ status: "ready", threads: [sidebarThread(threadId, "env_moved")] }));
    await waitFor(() => expect(gitText(threadId)).toBe("↑5"));
    expect(statusCalls).toEqual(["env_old", "env_moved"]);
  });

  it("asks bb for the environment of a thread the sidebar does not list, every time", async () => {
    const threadId = fresh();
    want(GIT_ID, threadId);
    const { statusCalls, sdkCalls } = render({ threadEnvironments: { [threadId]: "env_archived" } });
    await waitFor(() => expect(statusCalls).toEqual(["env_archived"]));
    let close = () => undefined as void;
    act(() => {
      close = markOpen(threadId);
    });
    await waitFor(() => expect(statusCalls).toHaveLength(2));
    act(() => close());
    expect(sdkCalls().filter((call) => call === "threads.get")).toHaveLength(2);
  });

  it("asks Git again when the thread's agent goes from busy to idle", async () => {
    const threadId = fresh();
    act(() => sidebar.set({ status: "ready", threads: [sidebarThread(threadId, "env", "active")] }));
    want(GIT_ID, threadId);
    let ahead = 1;
    const { statusCalls } = render({ answer: () => status(ahead) });
    await waitFor(() => expect(gitText(threadId)).toBe("↑1"));
    ahead = 2;
    act(() => sidebar.set({ status: "ready", threads: [sidebarThread(threadId, "env", "active")] }));
    await settle();
    expect(statusCalls).toHaveLength(1);
    act(() => sidebar.set({ status: "ready", threads: [sidebarThread(threadId, "env", "idle")] }));
    await waitFor(() => expect(gitText(threadId)).toBe("↑2"));
    expect(statusCalls).toHaveLength(2);
  });

  it("asks Git again when a card opens, and every 20 seconds while it stays open", async () => {
    const threadId = fresh();
    act(() => sidebar.set({ status: "ready", threads: [sidebarThread(threadId, "env")] }));
    want(GIT_ID, threadId);
    const { statusCalls } = render();
    await waitFor(() => expect(statusCalls).toHaveLength(1));
    fakeIntervals();
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
    await settle();
    expect(statusCalls).toHaveLength(3);
  });

  it("asks afresh when a thread is wanted again before it was pruned", async () => {
    const threadId = fresh();
    act(() => sidebar.set({ status: "ready", threads: [sidebarThread(threadId, "env")] }));
    const release = want(GIT_ID, threadId);
    const { statusCalls } = render();
    await waitFor(() => expect(statusCalls).toHaveLength(1));
    release();
    want(GIT_ID, threadId);
    await waitFor(() => expect(statusCalls).toHaveLength(2));
  });

  it("probes a thread wanted again after it was pruned at once, card included", async () => {
    fakeIntervals();
    const threadId = fresh();
    act(() => sidebar.set({ status: "ready", threads: [sidebarThread(threadId, "env")] }));
    const release = want(GIT_ID, threadId);
    const { statusCalls } = render();
    await waitFor(() => expect(statusCalls).toHaveLength(1));
    release();
    act(() => {
      vi.advanceTimersByTime(PRUNE_MS);
    });
    // Pruned: nothing listens for this thread's card any more.
    let close = () => undefined as void;
    act(() => {
      close = markOpen(threadId);
    });
    await settle();
    expect(statusCalls).toHaveLength(1);
    act(() => close());
    // Wanted again: a probe at once, not at the next prune tick.
    want(GIT_ID, threadId);
    await waitFor(() => expect(statusCalls).toHaveLength(2));
    act(() => {
      close = markOpen(threadId);
    });
    await waitFor(() => expect(statusCalls).toHaveLength(3));
    act(() => close());
  });

  it("keeps the newest answer when an older one arrives late", async () => {
    const threadId = fresh();
    act(() => sidebar.set({ status: "ready", threads: [sidebarThread(threadId, "env")] }));
    want(GIT_ID, threadId);
    const held: ((value: unknown) => void)[] = [];
    render({ answer: () => new Promise((resolve) => held.push(resolve)) });
    await waitFor(() => expect(held).toHaveLength(1));
    let close = () => undefined as void;
    act(() => {
      close = markOpen(threadId);
    });
    await waitFor(() => expect(held).toHaveLength(2));
    await act(async () => {
      held[1](status(2));
    });
    await waitFor(() => expect(gitText(threadId)).toBe("↑2"));
    await act(async () => {
      held[0](status(1));
    });
    await settle();
    expect(gitText(threadId)).toBe("↑2");
    act(() => close());
  });

  it(`asks for at most ${4} statuses at once`, async () => {
    const threads = Array.from({ length: 10 }, () => fresh());
    act(() => sidebar.set({ status: "ready", threads: threads.map((id, index) => sidebarThread(id, `env_${index}`)) }));
    for (const threadId of threads) want(GIT_ID, threadId);
    const held: ((value: unknown) => void)[] = [];
    const { statusCalls } = render({ answer: () => new Promise((resolve) => held.push(resolve)) });
    await waitFor(() => expect(statusCalls).toHaveLength(MAX_CONCURRENT_GIT));
    await settle();
    expect(statusCalls).toHaveLength(MAX_CONCURRENT_GIT);
    expect(MAX_CONCURRENT_GIT).toBe(4);
    await act(async () => {
      held[0](status(1));
    });
    await waitFor(() => expect(statusCalls).toHaveLength(MAX_CONCURRENT_GIT + 1));
    // Let the rest finish, so nothing is left waiting.
    for (let index = 1; index < 10; index += 1) {
      await waitFor(() => expect(held.length).toBeGreaterThan(index));
      await act(async () => {
        held[index](status(1));
      });
    }
    await waitFor(() => expect(statusCalls).toHaveLength(10));
  });
});
