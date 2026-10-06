// The job queue the server works through: installs now, updates and removals
// in later decks. Pure transitions over a plain array, so the runner, the RPC
// handlers and the tests all agree on what each state allows.
//
// A job waits out a grace period before it runs, which is what lets a swipe
// be undone. bb serializes plugin installs and updates itself, so the runner
// takes one job at a time and gains nothing from more.

export type JobState = "pending" | "running" | "done" | "failed" | "cancelled";

export interface InstallJob {
  id: string;
  kind: "install";
  /** The deck card the job came from. */
  key: string;
  entryId: string;
  marketplace: string;
  displayName: string;
  /** The source the card showed, so bb refuses if the listing moved since. */
  confirmedSource: unknown;
  createdAt: number;
  /** Not before this time (epoch ms): the undo window. */
  runAfter: number;
  state: JobState;
  startedAt: number | null;
  finishedAt: number | null;
  /** The installed plugin's id, once done. */
  pluginId: string | null;
  error: string | null;
}

export type Job = InstallJob;

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

/** The oldest pending job whose grace period is over, if nothing is running. */
export function nextRunnable(jobs: readonly Job[], now: number): Job | null {
  if (jobs.some((job) => job.state === "running")) return null;
  let next: Job | null = null;
  for (const job of jobs) {
    if (job.state !== "pending" || job.runAfter > now) continue;
    if (next === null || job.runAfter < next.runAfter) next = job;
  }
  return next;
}

/** When the runner should look again, or null if nothing is waiting. */
export function nextWakeAt(jobs: readonly Job[]): number | null {
  let wake: number | null = null;
  for (const job of jobs) {
    if (job.state !== "pending") continue;
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
  outcome: { ok: true; pluginId: string } | { ok: false; error: string },
): Job[] {
  return prune(
    jobs.map((job) => {
      if (job.id !== id || job.state !== "running") return job;
      return outcome.ok
        ? { ...job, state: "done" as const, finishedAt: now, pluginId: outcome.pluginId, error: null }
        : { ...job, state: "failed" as const, finishedAt: now, error: outcome.error };
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
