import { describe, expect, it, vi } from "vitest";
import { environmentOf, readGitStatus, type GitSdk } from "../lib/git-source";

function sdk(
  environmentIds: (string | null)[] = ["env_1"],
  environment = { mergeBaseBranch: "main" as string | null, defaultBranch: "trunk" as string | null },
) {
  const calls: string[] = [];
  const queue = [...environmentIds];
  const fake: GitSdk = {
    threads: { get: vi.fn(async () => (calls.push("threads.get"), { environmentId: queue.shift() ?? null })) },
    environments: {
      get: vi.fn(async () => (calls.push("environments.get"), environment)),
      status: vi.fn(async (args) => (calls.push(`status ${JSON.stringify(args)}`), { outcome: "not_applicable" })),
    },
  };
  return { fake, calls };
}

describe("readGitStatus", () => {
  it("asks for the status against the environment's merge-base branch, and nothing else", async () => {
    const { fake, calls } = sdk();
    await readGitStatus(fake, "env_1");
    expect(calls).toEqual(["environments.get", 'status {"environmentId":"env_1","mergeBaseBranch":"main"}']);
  });

  it("falls back to the default branch, then to none", async () => {
    const fallback = sdk([], { mergeBaseBranch: null, defaultBranch: "trunk" });
    await readGitStatus(fallback.fake, "env_1");
    expect(fallback.calls.at(-1)).toBe('status {"environmentId":"env_1","mergeBaseBranch":"trunk"}');
    const none = sdk([], { mergeBaseBranch: null, defaultBranch: null });
    await readGitStatus(none.fake, "env_1");
    expect(none.calls.at(-1)).toBe('status {"environmentId":"env_1"}');
  });

  it("reads the merge-base branch every time, since it can change", async () => {
    const { fake, calls } = sdk();
    await readGitStatus(fake, "env_1");
    await readGitStatus(fake, "env_1");
    expect(calls.filter((call) => call === "environments.get")).toHaveLength(2);
  });
});

describe("environmentOf", () => {
  it("asks bb each time, so an environment created or replaced since is seen", async () => {
    const { fake } = sdk([null, "env_new", "env_moved"]);
    expect(await environmentOf(fake, "thr_1")).toBeNull();
    expect(await environmentOf(fake, "thr_1")).toBe("env_new");
    expect(await environmentOf(fake, "thr_1")).toBe("env_moved");
  });
});
