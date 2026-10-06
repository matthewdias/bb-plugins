// The job queue the server works through: installs from the New deck and
// updates from the Updates deck. Pure transitions over a plain array, so the
// runner, the RPC handlers and the tests all agree on what each state allows.
//
// A swipe queues a job held until the batch is started, so a run of swipes
// across both decks becomes one background batch, and every decision can be
// taken back until then. bb serializes plugin installs and updates itself,
// so the runner takes one job at a time and gains nothing from more.

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
  /** Not before this time (epoch ms). */
  runAfter: number;
  /** Queued but not started: waits for the batch. Absent on jobs from before batches. */
  held?: boolean;
  /** What the card was before this decision (a save, say), restored if it is taken off the queue. */
  previous?: unknown;
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
  /** What bb did: updated, or found it already current. */
  result: "updated" | "current" | null;
}

/** Uninstalling, from the Cleanup deck. */
export interface RemoveJob extends JobBase {
  kind: "remove";
  pluginId: string;
}

export type Job = InstallJob | UpdateJob | RemoveJob;

/** The order a run takes: installs, then updates, then removals. */
const KIND_ORDER: Record<Job["kind"], number> = { install: 0, update: 1, remove: 2 };

const isHeld = (job: Job) => job.held === true;

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

/** Jobs queued or under way, in the order they will run. */
export function liveJobs(jobs: readonly Job[], last: string | null = null): Job[] {
  const rank = (job: Job) => (last !== null && job.pluginId === last ? 3 : KIND_ORDER[job.kind]);
  return jobs
    .filter((job) => !isFinished(job))
    .map((job, index) => ({ job, index }))
    .sort((a, b) => rank(a.job) - rank(b.job) || a.index - b.index)
    .map(({ job }) => job);
}

export function liveJob(jobs: readonly Job[], key: string): Job | null {
  return jobs.find((job) => job.key === key && !isFinished(job)) ?? null;
}

/**
 * The pending job to run next, if nothing is running: installs, then
 * updates, then removals, each in the order queued. A job for `last` (this plugin, whose
 * own update reloads it mid-batch) waits until no other job is ready.
 */
export function nextRunnable(jobs: readonly Job[], now: number, last: string | null = null): Job | null {
  if (jobs.some((job) => job.state === "running")) return null;
  const rank = (job: Job) => [last !== null && job.pluginId === last ? 1 : 0, KIND_ORDER[job.kind], job.runAfter];
  let next: Job | null = null;
  for (const job of jobs) {
    if (job.state !== "pending" || isHeld(job) || job.runAfter > now) continue;
    if (next === null) {
      next = job;
      continue;
    }
    const [a, b] = [rank(job), rank(next)];
    const i = a.findIndex((value, k) => value !== b[k]);
    if (i !== -1 && a[i]! < b[i]!) next = job;
  }
  return next;
}

/**
 * Starts the batch: every held job becomes ready at the same moment, so all
 * are candidates together and nextRunnable's order (installs, then updates,
 * this plugin last) decides. Staggered times would let whichever came first
 * run alone, this plugin included.
 */
export function releaseHeld(jobs: readonly Job[], now: number): { jobs: Job[]; released: number } {
  let released = 0;
  const next = jobs.map((job) => {
    if (!isHeld(job) || job.state !== "pending") return job;
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
