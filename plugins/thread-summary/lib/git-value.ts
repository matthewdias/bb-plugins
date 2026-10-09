// The Git complication: a thread's branch against its base, from bb's
// environment status.
//
// One line: `branch → base`, then where it stands. It turns amber when the
// branch is behind or has uncommitted work, the two states that bite at merge
// time. No detail: bb's own Info panel lists the changes and can act on them.
import type { ComplicationValue } from "./complications";

interface ChangedFile {
  path: string;
}

/**
 * The fields read from `useSdk().environments.status`, as the SDK's
 * `EnvironmentStatusResponse` names them. Declared here because the SDK does
 * not export that type, and narrowed to what this file uses.
 */
export type GitStatus =
  | {
      outcome: "available";
      workspace: {
        branch: { currentBranch: string | null; defaultBranch: string };
        checkout:
          | { kind: "branch"; branchName: string; headSha: string | null }
          | { kind: "detached"; headSha: string | null }
          | { kind: "unborn"; branchName: string | null }
          | { kind: "unknown"; reason: string };
        mergeBase: {
          aheadCount: number;
          behindCount: number;
          mergeBaseBranch: string;
        } | null;
        workingTree: {
          hasUncommittedChanges: boolean;
          files: readonly ChangedFile[];
        };
      };
    }
  | { outcome: "not_applicable" | "unavailable" };

function branchName(workspace: Extract<GitStatus, { outcome: "available" }>["workspace"]): string {
  const { checkout } = workspace;
  if (checkout.kind === "branch") return checkout.branchName;
  if (checkout.kind === "unborn" && checkout.branchName !== null) return checkout.branchName;
  if (checkout.kind === "detached" && checkout.headSha !== null) {
    return `detached at ${checkout.headSha.slice(0, 7)}`;
  }
  return workspace.branch.currentBranch ?? "HEAD";
}

/** Where the branch stands, beside its name: commits ahead, and behind when it is. */
export function gitText(ahead: number, behind: number): string {
  return behind > 0 ? `↑${ahead} ↓${behind}` : `↑${ahead}`;
}

/** `null` when the thread has no git checkout to describe. */
export function gitValue(status: GitStatus): ComplicationValue | null {
  if (status.outcome !== "available") return null;
  const { workspace } = status;
  const branch = branchName(workspace);
  const base = workspace.mergeBase?.mergeBaseBranch ?? null;
  const ahead = workspace.mergeBase?.aheadCount ?? 0;
  const behind = workspace.mergeBase?.behindCount ?? 0;
  const dirty = workspace.workingTree.hasUncommittedChanges;
  return {
    icon: "GitBranch",
    label: base === null ? branch : `${branch} → ${base}`,
    text: gitText(ahead, behind),
    tone: behind > 0 || dirty ? "warning" : "default",
  };
}
