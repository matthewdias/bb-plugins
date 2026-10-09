import { describe, expect, it } from "vitest";
import { gitValue, type GitStatus } from "../lib/git-value";

interface Options {
  branch?: string;
  base?: string | null;
  ahead?: number;
  behind?: number;
  uncommitted?: number;
}

function status({ branch = "feature", base = "main", ahead = 0, behind = 0, uncommitted = 0 }: Options = {}): GitStatus {
  return {
    outcome: "available",
    workspace: {
      branch: { currentBranch: branch, defaultBranch: "main" },
      checkout: { kind: "branch", branchName: branch, headSha: "abcdef0123456789" },
      mergeBase: base === null ? null : { aheadCount: ahead, behindCount: behind, mergeBaseBranch: base },
      workingTree: {
        hasUncommittedChanges: uncommitted > 0,
        files: Array.from({ length: uncommitted }, (_, index) => ({ path: `file-${index}.ts` })),
      },
    },
  };
}

describe("gitValue", () => {
  it("names the branch against its base", () => {
    expect(gitValue(status({ ahead: 3 }))).toMatchObject({ icon: "GitBranch", label: "feature → main", tone: "default" });
  });

  it("is one line: no detail and nothing to open", () => {
    const value = gitValue(status({ ahead: 3, behind: 1, uncommitted: 2 })) as unknown as Record<string, unknown>;
    expect(Object.keys(value).sort()).toEqual(["icon", "label", "text", "tone"]);
  });

  it("turns amber when behind, or with uncommitted changes", () => {
    expect(gitValue(status({ behind: 2 }))?.tone).toBe("warning");
    expect(gitValue(status({ uncommitted: 1 }))?.tone).toBe("warning");
    expect(gitValue(status({ ahead: 5 }))?.tone).toBe("default");
  });

  it("draws just the branch when there is no merge base", () => {
    expect(gitValue(status({ base: null }))?.label).toBe("feature");
  });

  it("names a detached head by its short sha", () => {
    const detached = status();
    if (detached.outcome !== "available") throw new Error("unreachable");
    detached.workspace.checkout = { kind: "detached", headSha: "abcdef0123456789" };
    expect(gitValue(detached)!.label).toBe("detached at abcdef0 → main");
  });

  it("has nothing to say for an environment that is not git, or not reachable", () => {
    expect(gitValue({ outcome: "not_applicable" })).toBeNull();
    expect(gitValue({ outcome: "unavailable" })).toBeNull();
  });
});
