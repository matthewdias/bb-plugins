// The Git complication: a thread's branch against its base, from bb's
// environment status.
//
// Small sizes say where the branch stands — `↑ahead ↓behind` — and turn amber
// when it is behind or has uncommitted work, the two states that bite at merge
// time. The detail adds the counts and the files that changed most, each one
// a link into the thread's workspace.
import { MAX_VALUE_LENGTH, type ComplicationValue } from "./complications";
import type { DetailRow } from "./validate";

type FileStatus = "?" | "??" | "A" | "C" | "D" | "M" | "R" | "U";

interface ChangedFile {
  path: string;
  insertions: number | null;
  deletions: number | null;
  status: FileStatus;
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
          files: readonly ChangedFile[];
        } | null;
        workingTree: {
          hasUncommittedChanges: boolean;
          files: readonly ChangedFile[];
        };
      };
    }
  | { outcome: "not_applicable" | "unavailable" };

interface FileChange {
  path: string;
  added: number;
  removed: number;
  deleted: boolean;
}

/**
 * Every file the thread changed against its base: the branch's commits and
 * the working tree on top, summed per path, most lines first. A file deleted
 * in the newer of the two keeps its row but loses its link, since there is
 * nothing left to open.
 */
export function changedFiles(status: Extract<GitStatus, { outcome: "available" }>): FileChange[] {
  const byPath = new Map<string, FileChange>();
  const add = (file: ChangedFile) => {
    const entry = byPath.get(file.path) ?? { path: file.path, added: 0, removed: 0, deleted: false };
    entry.added += file.insertions ?? 0;
    entry.removed += file.deletions ?? 0;
    entry.deleted = file.status === "D";
    byPath.set(file.path, entry);
  };
  // Committed first, so the working tree's status is the one that sticks.
  for (const file of status.workspace.mergeBase?.files ?? []) add(file);
  for (const file of status.workspace.workingTree.files) add(file);
  return [...byPath.values()].sort(
    (a, b) => b.added + b.removed - (a.added + a.removed) || a.path.localeCompare(b.path),
  );
}

function branchName(workspace: Extract<GitStatus, { outcome: "available" }>["workspace"]): string {
  const { checkout } = workspace;
  if (checkout.kind === "branch") return checkout.branchName;
  if (checkout.kind === "unborn" && checkout.branchName !== null) return checkout.branchName;
  if (checkout.kind === "detached" && checkout.headSha !== null) {
    return `detached at ${checkout.headSha.slice(0, 7)}`;
  }
  return workspace.branch.currentBranch ?? "HEAD";
}

function plural(count: number, one: string): string {
  return `${count} ${one}${count === 1 ? "" : "s"}`;
}

/** `null` when the thread has no git checkout to describe. */
export function gitValue(status: GitStatus): ComplicationValue | null {
  if (status.outcome !== "available") return null;
  const { workspace } = status;
  const branch = branchName(workspace);
  const base = workspace.mergeBase?.mergeBaseBranch ?? null;
  const ahead = workspace.mergeBase?.aheadCount ?? 0;
  const behind = workspace.mergeBase?.behindCount ?? 0;
  const uncommitted = workspace.workingTree.files.length;
  const dirty = workspace.workingTree.hasUncommittedChanges;
  const label = base === null ? branch : `${branch} → ${base}`;

  const rows: DetailRow[] = [];
  if (workspace.mergeBase !== null) {
    rows.push({
      label: "Ahead · behind",
      value: `${ahead} · ${behind}`,
      ...(behind > 0 ? { tone: "warning" } : {}),
    });
  }
  rows.push({
    label: "Uncommitted",
    value: plural(uncommitted, "file"),
    ...(dirty ? { tone: "warning" } : {}),
  });

  const value = {
    icon: "GitBranch",
    label,
    text: behind > 0 ? `↑${ahead} ↓${behind}` : `↑${ahead}`,
    tone: behind > 0 || dirty ? "warning" : "default",
    detail: { title: label, rows },
  };

  // As many of the busiest files as fit: the registry refuses a value whose
  // JSON is over its limit, and a refused value would draw nothing at all.
  for (const file of changedFiles(status)) {
    const row: DetailRow = {
      label: file.path,
      value: `+${file.added} −${file.removed}`,
      ...(file.deleted ? {} : { file: file.path }),
    };
    rows.push(row);
    if (JSON.stringify(value).length > MAX_VALUE_LENGTH) {
      rows.pop();
      break;
    }
  }
  return value;
}
