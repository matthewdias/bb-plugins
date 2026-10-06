// The job queue the server works through: installs from the New deck and
// updates from the Updates deck. Pure transitions over a plain array, so the
// runner, the RPC handlers and the tests all agree on what each state allows.
//
// An install waits out a grace period before it runs, which is what lets a
// swipe be undone. An update waits longer: it is held until the batch is
// started, so a run of swipes becomes one background batch. bb serializes
// plugin installs and updates itself, so the runner takes one job at a time
// and gains nothing from more.

export type JobState = "pending" | "running" | "done" | "failed" | "cancelled";

/** A version as bb reports it: the raw version and a label fit to show. */
export interface VersionLabel {
  version: string;
  display: string;
}

interface JobBase {
  id: string;
  /** The deck card the job came from. */
  key: string;
  displayName: string;
  createdAt: number;
  /** Not before this time (epoch ms): the undo window. */
  runAfter: number;
  state: JobState;
  startedAt: number | null;
  finishedAt: number | null;
  /** The plugin's id: known up front for an update, once done for an install. */
  pluginId: string | null;
  error: string | null;
}

export interface InstallJob extends JobBase {
  kind: "install";
  entryId: string;
  marketplace: string;
  /** The source the card showed, so bb refuses if the listing moved since. */
  confirmedSource: unknown;
}

export interface UpdateJob extends JobBase {
  kind: "update";
  pluginId: string;
  from: VersionLabel;
  /** The version offered when queued; the one bb landed on, once done. */
  to: VersionLabel;
  /** Queued but not started: waits for the batch. */
  held: boolean;
  /** What bb did: updated, or found it already current. */
  result: "updated" | "current" | null;
}

export type Job = InstallJob | UpdateJob;

const isHeld = (job: Job) => job.kind === "update" && job.held;

/** How long a swipe can still be undone. */
export const GRACE_MS = 5_000;
/** Finished jobs kept for the page and its toasts. */
export const FINISHED_KEPT = 50;

const isFinished = (job: Job) => job.state !== "pending" && job.state !== "running";

export function enqueue(jobs: readonly Job[], job: Job): Job[] {
  // One live job per card: a second swipe on the same entry replaces nothing.
  if (jobs.some((other) => other.key === job.key && !isFinished(other))) return [...jobs];
  return [...jobs, job];
}

/** Cancels the card's job if it has not started. */
export function cancelPending(jobs: readonly Job[], key: string, now: number): { jobs: Job[]; cancelled: boolean } {
  let cancelled = false;
  const next = jobs.map((job) => {
    if (job.key !== key || job.state !== "pending") return job;
    cancelled = true;
    return { ...job, state: "cancelled" as const, finishedAt: now };
  });
  return { jobs: next, cancelled };
}

export function liveJob(jobs: readonly Job[], key: string): Job | null {
  return jobs.find((job) => job.key === key && !isFinished(job)) ?? null;
}

/**
 * The oldest pending job whose wait is over, if nothing is running. A job
 * for `last` (this plugin, whose own update reloads it mid-batch) waits
 * until no other job is ready.
 */
export function nextRunnable(jobs: readonly Job[], now: number, last: string | null = null): Job | null {
  if (jobs.some((job) => job.state === "running")) return null;
  let next: Job | null = null;
  const later = (job: Job) => last !== null && job.pluginId === last;
  for (const job of jobs) {
    if (job.state !== "pending" || isHeld(job) || job.runAfter > now) continue;
    if (
      next === null ||
      (later(next) && !later(job)) ||
      (later(next) === later(job) && job.runAfter < next.runAfter)
    ) {
      next = job;
    }
  }
  return next;
}

/**
 * Starts the batch: every held update becomes ready at the same moment, so
 * all are candidates together and nextRunnable's order (queue order, this
 * plugin last) decides. Staggered times would let whichever came first run
 * alone, this plugin included.
 */
export function releaseHeld(jobs: readonly Job[], now: number): { jobs: Job[]; released: number } {
  let released = 0;
  const next = jobs.map((job) => {
    if (job.kind !== "update" || !job.held || job.state !== "pending") return job;
    released++;
    return { ...job, held: false, runAfter: now };
  });
  return { jobs: next, released };
}

/** When the runner should look again, or null if nothing is waiting. */
export function nextWakeAt(jobs: readonly Job[]): number | null {
  let wake: number | null = null;
  for (const job of jobs) {
    if (job.state !== "pending" || isHeld(job)) continue;
    if (wake === null || job.runAfter < wake) wake = job.runAfter;
  }
  return wake;
}

export function markRunning(jobs: readonly Job[], id: string, now: number): Job[] {
  return jobs.map((job) =>
    job.id === id && job.state === "pending" ? { ...job, state: "running" as const, startedAt: now } : job,
  );
}

export function markFinished(
  jobs: readonly Job[],
  id: string,
  now: number,
  outcome:
    | { ok: true; pluginId: string; result?: "updated" | "current"; to?: VersionLabel }
    | { ok: false; error: string },
): Job[] {
  return prune(
    jobs.map((job): Job => {
      if (job.id !== id || job.state !== "running") return job;
      if (!outcome.ok) return { ...job, state: "failed", finishedAt: now, error: outcome.error };
      if (job.kind === "update") {
        return { ...job, state: "done", finishedAt: now, error: null, result: outcome.result ?? "updated", to: outcome.to ?? job.to };
      }
      return { ...job, state: "done", finishedAt: now, pluginId: outcome.pluginId, error: null };
    }),
  );
}

/**
 * A job left running by a reload never finished as far as this plugin knows.
 * Run it again: an install that did land is refused as already installed,
 * which the runner counts as done.
 */
export function recover(jobs: readonly Job[]): Job[] {
  return jobs.map((job) => (job.state === "running" ? { ...job, state: "pending" as const, startedAt: null } : job));
}

export function prune(jobs: readonly Job[], keep = FINISHED_KEPT): Job[] {
  const finished = jobs.filter(isFinished);
  if (finished.length <= keep) return [...jobs];
  const drop = new Set(
    finished
      .sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0))
      .slice(0, finished.length - keep)
      .map((job) => job.id),
  );
  return jobs.filter((job) => !drop.has(job.id));
}

/** The newest failure message per card, for the deck to show on the card. */
export function failuresByKey(jobs: readonly Job[]): Record<string, string> {
  const latest: Record<string, Job> = {};
  for (const job of jobs) {
    if (job.state !== "failed" && job.state !== "done") continue;
    const seen = latest[job.key];
    if (seen === undefined || (job.finishedAt ?? 0) > (seen.finishedAt ?? 0)) latest[job.key] = job;
  }
  const failures: Record<string, string> = {};
  for (const [key, job] of Object.entries(latest)) {
    if (job.state === "failed" && job.error !== null) failures[key] = job.error;
  }
  return failures;
}
