// Destinations: where a follow-up goes when it is tracked somewhere else.
//
// The plugin knows nothing about Jira, GitHub or a backlog file. It knows two
// kinds of destination, and the user names and sets up each one:
//
// - "command": a shell command run on the thread's host, in its checkout. The
//   row reaches it as environment variables and as JSON on stdin, never by
//   being pasted into the command text, so an agent-written title cannot
//   become shell syntax. Quick, and spends no model time.
// - "agent": a recipe in the user's words, carried out by a hidden helper
//   thread in the same checkout (the way Describe works), which reports each
//   row back with `bb follow-up filed`. Reaches anything an agent can: an MCP
//   server, a CLI, a web page.
//
// Pure, like followups.ts: no plugin API, so every rule is testable.
import { z } from "zod";
import { expansionExecutionSchema } from "./expansion-execution.ts";
import type { FiledTo, FollowUp } from "./followups.ts";

export const DESTINATION_KINDS = ["command", "agent"] as const;
export type DestinationKind = (typeof DESTINATION_KINDS)[number];

export const DESTINATION_NAME_MAX = 40;
/** A command or a recipe: a paragraph, not a script. */
export const DESTINATION_BODY_MAX = 2000;
/** More than anyone files to, and a bound on one kv value. */
export const DESTINATIONS_MAX = 20;
/** What a destination's answer may be cut to before it is kept as the ref. */
export const REF_MAX = 200;

export const destinationSchema = z
  .object({
    id: z.string().min(1).max(60).regex(/^[a-z0-9-]+$/),
    name: z.string().trim().min(1).max(DESTINATION_NAME_MAX),
    kind: z.enum(DESTINATION_KINDS),
    /** kind "command": run with `sh -c` in the thread's checkout. */
    command: z.string().max(DESTINATION_BODY_MAX).optional(),
    /** kind "agent": what the helper is asked to do with the rows. */
    recipe: z.string().max(DESTINATION_BODY_MAX).optional(),
    /** kind "agent": the helper's model; absent means Describe's. */
    execution: expansionExecutionSchema.nullable().optional(),
  })
  .strict()
  .refine(
    (destination) =>
      destination.kind === "command"
        ? (destination.command ?? "").trim() !== ""
        : (destination.recipe ?? "").trim() !== "",
    { message: "A command destination needs a command, and an agent one a recipe." },
  );

export type Destination = z.infer<typeof destinationSchema>;

/** A name as an id: lowercase words joined by dashes. */
export function slugFor(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return slug === "" ? "destination" : slug;
}

/**
 * The stored list, re-validated on read. A kv value survives upgrades, so a
 * destination that no longer parses is dropped rather than throwing inside a
 * press, and a repeated id keeps its first holder.
 */
export function parseDestinations(value: unknown): Destination[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const kept: Destination[] = [];
  for (const entry of value) {
    const parsed = destinationSchema.safeParse(entry);
    if (!parsed.success || seen.has(parsed.data.id)) continue;
    seen.add(parsed.data.id);
    kept.push(parsed.data);
    if (kept.length === DESTINATIONS_MAX) break;
  }
  return kept;
}

/** The destination a word means: its id, or its name ignoring case. */
export function findDestination(
  destinations: readonly Destination[],
  nameOrId: string,
): Destination | null {
  const wanted = nameOrId.trim().toLowerCase();
  return (
    destinations.find((destination) => destination.id === wanted) ??
    destinations.find((destination) => destination.name.toLowerCase() === wanted) ??
    null
  );
}

/** What a filed row remembers of where it went. */
export function filedToOf(destination: Pick<Destination, "id" | "name">): FiledTo {
  return { id: destination.id, name: destination.name };
}

/**
 * The ref a command's output gives back: the first URL it printed, or failing
 * that its last non-empty line. `gh issue create` prints the issue's URL;
 * `jira issue create` prints a key, which is kept as text. Nothing printed is
 * no ref, and the row is filed without a link.
 */
export function refFromOutput(stdout: string): string | null {
  const url = stdout.match(/https?:\/\/[^\s"'<>]+/)?.[0];
  if (url !== undefined) return url.replace(/[.,;:!?)\]]+$/, "").slice(0, REF_MAX);
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const last = lines.at(-1);
  return last === undefined ? null : last.slice(0, REF_MAX);
}

/**
 * The row as a command sees it, in its environment. Read them quoted —
 * `"$FOLLOWUP_TITLE"` — and the text is passed as text: a variable's value is
 * never parsed as shell syntax, whoever wrote it.
 */
export function commandEnv(row: FollowUp, threadId: string): Record<string, string> {
  return {
    FOLLOWUP_ID: row.id,
    FOLLOWUP_TITLE: row.text,
    FOLLOWUP_DETAIL: row.detail ?? "",
    FOLLOWUP_FILE: row.file ?? "",
    FOLLOWUP_REASON: row.reason ?? "",
    FOLLOWUP_THREAD: threadId,
  };
}

/** The same row as JSON on stdin, for a script that would rather parse it. */
export function commandStdin(row: FollowUp, threadId: string): string {
  return `${JSON.stringify({
    id: row.id,
    title: row.text,
    detail: row.detail,
    file: row.file,
    reason: row.reason,
    thread: threadId,
  })}\n`;
}

/** Examples offered when no destination is set up yet: starting points, edited before use. */
export const DESTINATION_EXAMPLES: readonly Omit<Destination, "id">[] = [
  {
    name: "GitHub issue",
    kind: "command",
    command: 'gh issue create --title "$FOLLOWUP_TITLE" --body "$FOLLOWUP_DETAIL"',
  },
  {
    name: "Backlog",
    kind: "agent",
    recipe:
      "Add each follow-up to this project's backlog, wherever it keeps one (a BACKLOG.md, " +
      "a TODO file, the issue tracker). If there is none, say so and file nothing.",
  },
];
