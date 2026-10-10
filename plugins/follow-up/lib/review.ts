// Reviewing a pull request on its card: its changes, comments on lines, and
// the one message "Request changes" sends.
//
// Pure, like page.ts: no plugin API. The changes are read from the thread's
// worktree against the pull request's base branch (bb's own diff calls), so
// this is the branch as it stands locally, which is what the agent will edit.
//
// A comment is a draft until it is sent. It names its file and line and quotes
// the line it is about, so the message stands on its own: the agent that
// reads it is not looking at this card. All comments go as one message to the
// thread that opened the pull request, shown first in a box that can be
// edited, like everything else the page sends.
import { z } from "zod";
import { reveal } from "./unseen.ts";

/** The most of a pull request a card shows; past it the card says so and links GitHub. */
export const REVIEW_FILES_MAX = 50;
export const REVIEW_PATCH_MAX = 40_000;
export const REVIEW_COMMENT_MAX = 4_000;

export const reviewFileSchema = z.object({
  path: z.string(),
  /** Where a renamed or copied file came from. */
  previousPath: z.string().nullable(),
  change: z.string(),
  additions: z.number(),
  deletions: z.number(),
  binary: z.boolean(),
  /** A unified patch for this one file; empty when it is binary or too large to load. */
  patch: z.string(),
  /** The patch was cut, here or by bb: comment on GitHub for the rest. */
  cut: z.boolean(),
});
export type ReviewFile = z.infer<typeof reviewFileSchema>;

export const reviewDiffSchema = z.object({
  files: z.array(reviewFileSchema),
  /** Files past REVIEW_FILES_MAX, not carried. */
  more: z.number(),
  base: z.string(),
});
export type ReviewDiff = z.infer<typeof reviewDiffSchema>;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** The files `diffFiles` listed, in its order, capped; or null when it had none to give. */
export function reviewFileList(response: unknown): { files: Omit<ReviewFile, "patch" | "cut">[]; more: number } | null {
  const body = record(response);
  if (body === null || body.outcome !== "available" || !Array.isArray(body.files)) return null;
  const files = body.files.map(record).flatMap((file) => {
    if (file === null || typeof file.path !== "string" || file.path === "") return [];
    return [
      {
        path: file.path,
        previousPath: typeof file.previousPath === "string" && file.previousPath !== "" ? file.previousPath : null,
        change: typeof file.changeKind === "string" ? file.changeKind : "modified",
        additions: typeof file.additions === "number" ? file.additions : 0,
        deletions: typeof file.deletions === "number" ? file.deletions : 0,
        binary: file.binary === true,
      },
    ];
  });
  return { files: files.slice(0, REVIEW_FILES_MAX), more: Math.max(0, files.length - REVIEW_FILES_MAX) };
}

/** Each file's patch from `diffPatch`, by path, with whether bb cut it. */
export function reviewPatches(response: unknown): Map<string, { patch: string; truncated: boolean }> {
  const body = record(response);
  const out = new Map<string, { patch: string; truncated: boolean }>();
  if (body === null || body.outcome !== "available" || !Array.isArray(body.patches)) return out;
  for (const entry of body.patches.map(record)) {
    if (entry === null || typeof entry.path !== "string" || typeof entry.patch !== "string") continue;
    out.set(entry.path, { patch: entry.patch, truncated: entry.truncated === true });
  }
  return out;
}

/**
 * The changes as a card shows them. A patch is cut on a line end, so what is
 * shown is whole lines. Any character that draws nothing is shown as its
 * code, as in an approval: a review is of what is there.
 */
export function reviewDiff(
  list: { files: Omit<ReviewFile, "patch" | "cut">[]; more: number },
  patches: ReadonlyMap<string, { patch: string; truncated: boolean }>,
  base: string,
): ReviewDiff {
  return {
    base,
    more: list.more,
    files: list.files.map((file) => {
      const found = patches.get(file.path);
      const whole = reveal(found?.patch ?? "");
      const over = whole.length > REVIEW_PATCH_MAX;
      const patch = over ? whole.slice(0, whole.lastIndexOf("\n", REVIEW_PATCH_MAX) + 1) : whole;
      return { ...file, path: file.path, patch, cut: over || found?.truncated === true || (found === undefined && !file.binary) };
    }),
  };
}

// --- lines ------------------------------------------------------------------------

export type Side = "old" | "new";

export interface PatchLine {
  kind: "add" | "del" | "context";
  /** Its number in the file before the change; null for an added line. */
  old: number | null;
  /** Its number in the file after the change; null for a removed line. */
  new: number | null;
  text: string;
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** The lines of a one-file unified patch, each with its numbers either side. */
export function patchLines(patch: string): PatchLine[] {
  const lines: PatchLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  for (const raw of patch.split("\n")) {
    const hunk = HUNK.exec(raw);
    if (hunk !== null) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      inHunk = true;
      continue;
    }
    if (!inHunk || raw.startsWith("\\")) continue;
    if (raw.startsWith("+")) {
      lines.push({ kind: "add", old: null, new: newLine, text: raw.slice(1) });
      newLine += 1;
    } else if (raw.startsWith("-")) {
      lines.push({ kind: "del", old: oldLine, new: null, text: raw.slice(1) });
      oldLine += 1;
    } else if (raw.startsWith(" ")) {
      lines.push({ kind: "context", old: oldLine, new: newLine, text: raw.slice(1) });
      oldLine += 1;
      newLine += 1;
    }
  }
  return lines;
}

/** The line a comment would sit on, or null when the patch does not show it. */
export function lineAt(patch: string, side: Side, line: number): PatchLine | null {
  // An added line has no old number and a removed one no new, so the side alone decides.
  return patchLines(patch).find((entry) => entry[side] === line) ?? null;
}

// --- comments ---------------------------------------------------------------------

export const lineCommentSchema = z.object({
  id: z.string(),
  path: z.string(),
  side: z.enum(["old", "new"]),
  line: z.number(),
  /** The line as the diff showed it, quoted in the message. */
  text: z.string(),
  body: z.string(),
});
export type LineComment = z.infer<typeof lineCommentSchema>;

/** Comments in the order the diff shows them: by file as listed, then by line. */
export function orderComments(comments: readonly LineComment[], paths: readonly string[]): LineComment[] {
  const position = new Map(paths.map((path, index) => [path, index]));
  return [...comments].sort(
    (a, b) =>
      (position.get(a.path) ?? paths.length) - (position.get(b.path) ?? paths.length) ||
      a.line - b.line ||
      (a.side === b.side ? 0 : a.side === "old" ? -1 : 1),
  );
}

/**
 * The message "Request changes" starts from: each comment with its file and
 * line and the line it is about. A removed line says so, since its number is
 * the old file's.
 */
export function reviewMessage(pr: { number: number; title: string }, comments: readonly LineComment[]): string {
  const head = `I reviewed PR #${pr.number} (${pr.title}) and want changes before it merges.`;
  if (comments.length === 0) return head;
  const blocks = comments.map((comment, index) => {
    const where = `${comment.path}:${comment.line}${comment.side === "old" ? " (removed line)" : ""}`;
    const quoted = comment.text.trim() === "" ? "   > (blank line)" : `   > ${comment.text.trim()}`;
    const body = comment.body
      .trim()
      .split("\n")
      .map((line) => `   ${line}`)
      .join("\n");
    return `${index + 1}. ${where}\n${quoted}\n${body}`;
  });
  return [head, "", ...blocks.flatMap((block) => [block, ""]), "Address each one, then push."].join("\n");
}
