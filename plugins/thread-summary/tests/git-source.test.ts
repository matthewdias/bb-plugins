import { describe, expect, it, vi } from "vitest";
import { readGitStatus, type GitSdk } from "../lib/git-source";

function sdk(environmentId: string | null, environment = { mergeBaseBranch: "main" as string | null, defaultBranch: "trunk" as string | null }) {
  const calls: string[] = [];
  const fake: GitSdk = {
    threads: { get: vi.fn(async () => (calls.push("threads.get"), { environmentId })) },
    environments: {
      get: vi.fn(async () => (calls.push("environments.get"), environment)),
      status: vi.fn(async (args) => (calls.push(`status ${JSON.stringify(args)}`), { outcome: "not_applicable" })),
    },
  };
  return { fake, calls };
}

describe("readGitStatus", () => {
  it("asks for the status against the environment's merge-base branch", async () => {
    const { fake, calls } = sdk("env_1");
    await readGitStatus(fake, "thr_1", { current: undefined });
    expect(calls).toEqual([
      "threads.get",
      "environments.get",
      'status {"environmentId":"env_1","mergeBaseBranch":"main"}',
    ]);
  });

  it("falls back to the default branch, then to none", async () => {
    const fallback = sdk("env_1", { mergeBaseBranch: null, defaultBranch: "trunk" });
    await readGitStatus(fallback.fake, "thr_1", { current: undefined });
    expect(fallback.calls.at(-1)).toBe('status {"environmentId":"env_1","mergeBaseBranch":"trunk"}');
    const none = sdk("env_1", { mergeBaseBranch: null, defaultBranch: null });
    await readGitStatus(none.fake, "thr_1", { current: undefined });
    expect(none.calls.at(-1)).toBe('status {"environmentId":"env_1"}');
  });

  it("reads the thread's environment once, but its merge-base branch every time", async () => {
    const { fake, calls } = sdk("env_1");
    const environment = { current: undefined as string | null | undefined };
    await readGitStatus(fake, "thr_1", environment);
    await readGitStatus(fake, "thr_1", environment);
    expect(calls.filter((call) => call === "threads.get")).toHaveLength(1);
    expect(calls.filter((call) => call === "environments.get")).toHaveLength(2);
  });

  it("is null for a thread with no environment, without asking for a status", async () => {
    const { fake, calls } = sdk(null);
    expect(await readGitStatus(fake, "thr_1", { current: undefined })).toBeNull();
    expect(calls).toEqual(["threads.get"]);
  });
});
