import { describe, expect, it } from "vitest";
import { MAX_VALUE_LENGTH, normalizeValue } from "../lib/complications";
import { changedFiles, gitValue, type GitStatus } from "../lib/git-value";
import { readDetail } from "../lib/validate";

type File = { path: string; insertions: number | null; deletions: number | null; status: "M" | "A" | "D" | "??" };

interface Options {
  branch?: string;
  base?: string | null;
  ahead?: number;
  behind?: number;
  committed?: File[];
  working?: File[];
  dirty?: boolean;
}

function status({
  branch = "feature",
  base = "main",
  ahead = 0,
  behind = 0,
  committed = [],
  working = [],
  dirty = working.length > 0,
}: Options = {}): GitStatus {
  return {
    outcome: "available",
    workspace: {
      branch: { currentBranch: branch, defaultBranch: "main" },
      checkout: { kind: "branch", branchName: branch, headSha: "abcdef0123456789" },
      mergeBase:
        base === null
          ? null
          : { aheadCount: ahead, behindCount: behind, mergeBaseBranch: base, files: committed },
      workingTree: { hasUncommittedChanges: dirty, files: working },
    },
  };
}

const file = (path: string, insertions: number | null, deletions: number | null, s: File["status"] = "M"): File => ({
  path,
  insertions,
  deletions,
  status: s,
});

describe("gitValue", () => {
  it("names the branch against its base and counts commits ahead", () => {
    const value = gitValue(status({ ahead: 3 }))!;
    expect(value).toMatchObject({ icon: "GitBranch", label: "feature → main", text: "↑3", tone: "default" });
  });

  it("adds behind only when it is not zero, and turns amber", () => {
    expect(gitValue(status({ ahead: 3, behind: 2 }))).toMatchObject({ text: "↑3 ↓2", tone: "warning" });
    expect(gitValue(status({ ahead: 0, behind: 0 }))).toMatchObject({ text: "↑0", tone: "default" });
  });

  it("turns amber with uncommitted changes", () => {
    expect(gitValue(status({ working: [file("a.ts", 1, 0)] }))).toMatchObject({ tone: "warning" });
  });

  it("draws just the branch when there is no merge base, and no ahead/behind row", () => {
    const value = gitValue(status({ base: null }))!;
    expect(value.label).toBe("feature");
    expect(readDetail(value)!.rows.map((row) => row.label)).toEqual(["Uncommitted"]);
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

  it("lists ahead · behind, uncommitted, then the busiest files as workspace links", () => {
    const value = gitValue(
      status({
        ahead: 2,
        behind: 1,
        committed: [file("small.ts", 1, 1), file("big.ts", 40, 2)],
        working: [file("mid.ts", 5, 5)],
      }),
    )!;
    const detail = readDetail(value)!;
    expect(detail.title).toBe("feature → main");
    expect(detail.rows).toEqual([
      { label: "Ahead · behind", value: "2 · 1", tone: "warning" },
      { label: "Uncommitted", value: "1 file", tone: "warning" },
      { label: "big.ts", value: "+40 −2", file: "big.ts" },
      { label: "mid.ts", value: "+5 −5", file: "mid.ts" },
      { label: "small.ts", value: "+1 −1", file: "small.ts" },
    ]);
  });

  it("stays inside the registry's size limit however many files changed", () => {
    const many = Array.from({ length: 400 }, (_, index) =>
      file(`plugins/some/long/directory/name/file-${index}.ts`, index, 0),
    );
    const value = gitValue(status({ committed: many }))!;
    expect(JSON.stringify(value).length).toBeLessThanOrEqual(MAX_VALUE_LENGTH);
    // The registry would refuse it otherwise, and the card would draw nothing.
    expect(normalizeValue(value)).not.toBeUndefined();
    const rows = readDetail(value)!.rows;
    expect(rows.length).toBeGreaterThan(8);
    expect(rows[2].label).toBe("plugins/some/long/directory/name/file-399.ts");
  });
});

describe("changedFiles", () => {
  it("sums a path changed on the branch and again in the working tree", () => {
    const available = status({ committed: [file("a.ts", 10, 1)], working: [file("a.ts", 2, 3), file("b.ts", null, null, "??")] });
    if (available.outcome !== "available") throw new Error("unreachable");
    expect(changedFiles(available)).toEqual([
      { path: "a.ts", added: 12, removed: 4, deleted: false },
      { path: "b.ts", added: 0, removed: 0, deleted: false },
    ]);
  });

  it("drops the link for a file whose newest change deleted it", () => {
    const value = gitValue(status({ committed: [file("gone.ts", 0, 9, "D")], working: [file("back.ts", 0, 4, "D")] }))!;
    const rows = readDetail(value)!.rows.filter((row) => row.label.endsWith(".ts"));
    expect(rows).toEqual([
      { label: "gone.ts", value: "+0 −9" },
      { label: "back.ts", value: "+0 −4" },
    ]);
  });

  it("keeps the link for a file deleted on the branch and recreated since", () => {
    const value = gitValue(status({ committed: [file("again.ts", 0, 9, "D")], working: [file("again.ts", 3, 0, "??")] }))!;
    expect(readDetail(value)!.rows.find((row) => row.label === "again.ts")).toEqual({
      label: "again.ts",
      value: "+3 −9",
      file: "again.ts",
    });
  });

  it("orders ties by path", () => {
    const available = status({ committed: [file("b.ts", 1, 0), file("a.ts", 0, 1)] });
    if (available.outcome !== "available") throw new Error("unreachable");
    expect(changedFiles(available).map((entry) => entry.path)).toEqual(["a.ts", "b.ts"]);
  });
});
