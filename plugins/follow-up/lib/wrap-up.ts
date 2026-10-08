// Wrap up: take a thread to done in one pass.
//
// Every open row gets a disposition — filed somewhere, handed to a thread of
// its own, done, dismissed, or kept — and then, unless the person says
// otherwise, the thread is archived. Asked each time, with Archive chosen.
//
// The archive waits. An environment provider may tear a checkout down when its
// last thread is archived, and a command destination runs in that checkout,
// as does an agent recipe's helper. So the archive happens on the server once
// every filing has landed, and not at all if one did not: a row someone asked
// to send somewhere must not be left on an archived thread, still open, with
// nobody looking at it.
import { z } from "zod";
import { isFiled, isFiling, type FollowUp } from "./followups.ts";

export const dispositionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("file"), destinationId: z.string().min(1).max(60) }).strict(),
  /**
   * An independent thread, never a child: archiving this thread archives its
   * children, and a wrap-up is about to archive it. "here" reuses this
   * thread's checkout, which stays while the new thread is open.
   */
  z.object({ kind: z.literal("handoff"), where: z.enum(["here", "new-worktree"]) }).strict(),
  z.object({ kind: z.literal("done") }).strict(),
  z.object({ kind: z.literal("dismiss") }).strict(),
  z.object({ kind: z.literal("keep") }).strict(),
]);
export type Disposition = z.infer<typeof dispositionSchema>;

/**
 * What a row starts as: the project's default destination when there is one,
 * else Keep open. Keep is the honest default with nowhere to file — nothing
 * happens to a row nobody decided about.
 */
export function defaultDisposition(defaultDestinationId: string | null): Disposition {
  return defaultDestinationId === null
    ? { kind: "keep" }
    : { kind: "file", destinationId: defaultDestinationId };
}

/** The same disposition, compared by value: a select's value round trip. */
export function dispositionKey(disposition: Disposition): string {
  switch (disposition.kind) {
    case "file":
      return `file:${disposition.destinationId}`;
    case "handoff":
      return `handoff:${disposition.where}`;
    default:
      return disposition.kind;
  }
}

export function dispositionFromKey(key: string): Disposition | null {
  if (key.startsWith("file:") && key.length > "file:".length) {
    return { kind: "file", destinationId: key.slice("file:".length) };
  }
  if (key === "handoff:here") return { kind: "handoff", where: "here" };
  if (key === "handoff:new-worktree") return { kind: "handoff", where: "new-worktree" };
  if (key === "done" || key === "dismiss" || key === "keep") return { kind: key };
  return null;
}

/**
 * One line saying what the button will do, in the order it happens. Rows kept
 * open are left out: "keeps 2" is not something the button does.
 */
export function wrapUpSummary(
  dispositions: readonly Disposition[],
  destinationName: (id: string) => string,
  archive: boolean,
): string {
  const filing = new Map<string, number>();
  let handoffs = 0;
  let done = 0;
  let dismissed = 0;
  for (const disposition of dispositions) {
    if (disposition.kind === "file") {
      const name = destinationName(disposition.destinationId);
      filing.set(name, (filing.get(name) ?? 0) + 1);
    } else if (disposition.kind === "handoff") handoffs += 1;
    else if (disposition.kind === "done") done += 1;
    else if (disposition.kind === "dismiss") dismissed += 1;
  }
  const parts = [
    ...[...filing].map(([name, count]) => `files ${count} to ${name}`),
    ...(handoffs > 0 ? [`hands off ${handoffs}`] : []),
    ...(done > 0 ? [`marks ${done} done`] : []),
    ...(dismissed > 0 ? [`dismisses ${dismissed}`] : []),
  ];
  const then = archive ? "archives this thread" : "leaves this thread open";
  if (parts.length === 0) return capitalise(`${then}.`);
  const list =
    parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  return capitalise(`${list}, then ${then}.`);
}

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * A wrap-up that has started and not yet finished, one per thread. Kept in
 * storage rather than memory: a command can run for two minutes and a helper
 * for longer, and the archive must still happen, or still be held, across a
 * restart in between.
 */
export type WrapUpRecord = {
  startedAt: string;
  archive: boolean;
  /** Rows whose filing has to land before the thread may be archived. */
  waitingOn: string[];
  /** Rows that could not be carried out when the wrap-up started, and why. */
  failures: { id: string; text: string; note: string }[];
  /** False while the dispositions are still being carried out. */
  dispatched: boolean;
  /** Set once it has settled short of the archive: why it stopped. */
  held: string | null;
};

export type WrapUpCheck =
  | { outcome: "waiting" }
  | { outcome: "landed" }
  | { outcome: "held"; failed: { id: string; text: string; note: string }[] };

/**
 * Where a wrap-up stands, given every row the thread now has (open and done).
 *
 * A row it waits on is fine once filed, still pending while filing, and failed
 * otherwise — with its own note, or a plain one if a filing went quiet past
 * the point `isFiling` stops believing it. A row that has gone altogether was
 * dismissed or cleared in the meantime by someone deciding about it, so it
 * holds nothing up.
 */
export function checkWrapUp(
  record: WrapUpRecord,
  rows: readonly FollowUp[],
  now: number = Date.now(),
): WrapUpCheck {
  const failed = [...record.failures];
  for (const id of record.waitingOn) {
    const row = rows.find((entry) => entry.id === id);
    if (row === undefined || isFiled(row)) continue;
    if (isFiling(row, now)) return { outcome: "waiting" };
    failed.push({ id, text: row.text, note: row.filingNote ?? "Its filing never reported back." });
  }
  return failed.length === 0 ? { outcome: "landed" } : { outcome: "held", failed };
}

/**
 * What a wrap-up says about rows that did not go where they were sent: on the
 * card and in the popup when it held the archive, in a toast when there was no
 * archive to hold.
 */
export function failedMessage(failed: readonly { note: string }[], held: boolean): string {
  const count = failed.length;
  const what = count === 1 ? "1 follow-up didn't go" : `${count} follow-ups didn't go`;
  const where = `where you sent ${count === 1 ? "it" : "them"}`;
  return held ? `${what} ${where}, so this thread was not archived.` : `${what} ${where}.`;
}

/** bb's own worktree provider: what its composer's "New worktree" asks for. */
export const GIT_WORKTREE = "git-worktree";

/** The parts of an environment record a new worktree is modelled on. */
export type EnvironmentShape = {
  hostId: string;
  isGitRepo: boolean;
  environmentProviderId: string | null;
  environmentProviderSelection: { inputs: unknown } | null;
};

type BranchFrom = { kind: "default" } | { kind: "named"; name: string };

/**
 * git-worktree's "branch from" input, or null for anything else. Its other
 * form, `{ kind: "existing", path }`, reuses a worktree that already exists,
 * and so does every other provider's `path`: re-sending one of those would put
 * the hand-off in a checkout that is not new at all.
 */
function branchFrom(inputs: unknown): BranchFrom | null {
  if (typeof inputs !== "object" || inputs === null) return null;
  const branch = (inputs as { branch?: unknown }).branch;
  if (typeof branch !== "object" || branch === null) return null;
  const { kind, name } = branch as { kind?: unknown; name?: unknown };
  if (kind === "default") return { kind: "default" };
  if (kind === "named" && typeof name === "string" && name !== "") return { kind: "named", name };
  return null;
}

/**
 * How to ask git-worktree for a new worktree for a hand-off, or null where
 * there cannot be one (not a git repository). Whether the provider is there
 * to ask is the server's question; see `followups_wrap_up_get`.
 *
 * A thread in a git-worktree worktree branches from where it did: a new
 * branch, never the same one, so one started from an epic branch hands off
 * onto that epic. Anything else, such as a project checkout, a reused
 * worktree or another provider's environment, branches from the default
 * branch. Always on the same machine: a hand-off is work on this code, not a
 * reason to provision hardware.
 */
export function newWorktreeEnvironment(environment: EnvironmentShape): Record<string, unknown> | null {
  if (!environment.isGitRepo) return null;
  const from =
    environment.environmentProviderId === GIT_WORKTREE
      ? branchFrom(environment.environmentProviderSelection?.inputs)
      : null;
  return {
    environmentProviderId: GIT_WORKTREE,
    inputs: { branch: from ?? { kind: "default" } },
    machine: { type: "existing", hostId: environment.hostId },
  };
}
