// Plugin Triage — server entry.
//
// Holds what the page cannot: the decisions made on each card, and the queue
// of installs and updates those decisions start. The queue lives here rather than in the
// page so a batch keeps going when the window closes, and it is persisted so
// it survives this plugin's own reload or update. bb itself serializes plugin
// installs, so the runner takes one job at a time.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { CHANGED_CHANNEL } from "./lib/channel.ts";
import { rpcContract } from "./lib/contract.ts";
import {
  FIRST_RUN_WINDOW_MS,
  buildNewDeck,
  buildSavedList,
  type CatalogEntry,
  type Decisions,
} from "./lib/new-deck.ts";
import {
  liveJobs,
  releaseHeld,
  cancelPending,
  enqueue,
  failuresByKey,
  liveJob,
  markFinished,
  markRunning,
  nextRunnable,
  nextWakeAt,
  recover,
  type InstallJob,
  type Job,
  type UpdateJob,
} from "./lib/queue.ts";
import {
  SNOOZE_MS,
  buildUpdatesDeck,
  updateKey,
  type InstalledPlugin,
  type UpdateDecision,
  type UpdateDecisions,
  type UpdateResult,
} from "./lib/updates-deck.ts";
import { summarizeSource, type ResolvedSource } from "./lib/source.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { LOW_BUDGET, changesKey, fetchChanges, type Budget, type Changes } from "./lib/changes.ts";
import { gitHubLogin } from "./lib/github-auth.ts";

export { rpcContract };

const DECISIONS = "decisions";
const UPDATE_DECISIONS = "updateDecisions";
/** Finished updates the Updates tab lists. */
const HISTORY_SHOWN = 20;
/** The marketplace of plugins bundled with bb. */
const BUNDLED_MARKETPLACE = "bb-official";
const JOBS = "jobs";
const FIRST_RUN_AT = "firstRunAt";

/** bb's refusal when the plugin landed after all — a resumed job, say. */
const ALREADY_INSTALLED = /is already installed/i;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default async function plugin(bb: BbPluginApi) {
  const kv = bb.storage.kv;

  const settings = bb.settings.define({
    useGitHubLogin: {
      type: "boolean",
      label: "Use this machine's GitHub login for update change lists",
      description:
        "Uses the login the GitHub CLI holds (gh auth token), as bb itself does for git, or GH_TOKEN if it is set. The token is only sent to api.github.com, for read-only lookups of the commits an update brings, and lifts GitHub's limit from 60 requests an hour to 5,000. Off, change lists are looked up without a login.",
      default: true,
    },
  });

  const run = promisify(execFile);
  const login = gitHubLogin({
    enabled: async () => (await settings.get()).useGitHubLogin,
    env: process.env,
    runGh: async (command, args) => (await run(command, args, { timeout: 15_000, maxBuffer: 64 * 1024 })).stdout,
  });
  /** What GitHub last said is left of the hourly limit, for the login in use then. */
  let budget: (Budget & { withLogin: boolean }) | null = null;

  // Every read-modify-write of decisions or jobs goes through here, so an RPC
  // and the runner never interleave and lose each other's change.
  let chain: Promise<unknown> = Promise.resolve();
  function locked<T>(work: () => Promise<T>): Promise<T> {
    const run = chain.then(work, work);
    chain = run.catch(() => undefined);
    return run;
  }

  const readDecisions = async () => (await kv.get<Decisions>(DECISIONS)) ?? {};
  const readJobs = async () => (await kv.get<Job[]>(JOBS)) ?? [];
  const readUpdateDecisions = async () => (await kv.get<UpdateDecisions>(UPDATE_DECISIONS)) ?? {};

  function changed(reason: string): void {
    bb.realtime.publish(CHANGED_CHANNEL, { reason });
  }

  async function catalog(): Promise<CatalogEntry[]> {
    const { results } = await bb.sdk.plugins.catalog.search({ query: "" });
    return results as CatalogEntry[];
  }

  /** The first visit fixes how far back "new" reaches, for good. */
  async function cutoff(): Promise<number> {
    let first = await kv.get<number>(FIRST_RUN_AT);
    if (first === null || first === undefined) {
      first = Date.now();
      await kv.set(FIRST_RUN_AT, first);
    }
    return first - FIRST_RUN_WINDOW_MS;
  }

  // The runner sleeps until the next job's grace period ends, or until an
  // RPC wakes it with a new job.
  let wake: (() => void) | null = null;
  const poke = () => wake?.();

  type Outcome =
    | { ok: true; pluginId: string; result?: "updated" | "current"; to?: { version: string; display: string } }
    | { ok: false; error: string };

  async function install(job: InstallJob): Promise<Outcome> {
    try {
      const installed = await bb.sdk.plugins.catalog.install({
        entryId: job.entryId,
        marketplace: job.marketplace,
        ...(job.confirmedSource == null ? {} : { confirmedSource: job.confirmedSource as never }),
      });
      return { ok: true, pluginId: installed.id };
    } catch (error) {
      const text = message(error);
      return ALREADY_INSTALLED.test(text) ? { ok: true, pluginId: job.pluginId ?? job.entryId } : { ok: false, error: text };
    }
  }

  async function update(job: UpdateJob): Promise<Outcome> {
    try {
      // bb's applyUpdate takes no version: it lands on whatever the source
      // offers when it runs. A branch can move between the swipe and the
      // batch, so check again first, and apply only the version the card
      // showed. A changed offer comes back as a card to review instead.
      const [offer] = await bb.sdk.plugins.checkUpdates({ pluginId: job.pluginId });
      if (offer?.outcome === "current") return { ok: true, pluginId: job.pluginId, result: "current" };
      if (offer?.outcome !== "update-available" || offer.candidate?.version !== job.to.version) {
        const now = offer?.candidate?.display ?? offer?.detail ?? offer?.outcome ?? "nothing";
        return { ok: false, error: `The update on offer changed since you queued it (now ${now}). Review it again.` };
      }
      const result = await bb.sdk.plugins.applyUpdate({ pluginId: job.pluginId });
      // bb resolves the source again inside applyUpdate, so a move in that
      // window can still land elsewhere: record what actually landed.
      if (result.to !== undefined && result.to.version !== job.to.version) {
        bb.log.warn(`update of ${job.pluginId} landed on ${result.to.display}, not the queued ${job.to.display}`);
      }
      if (result.outcome === "rolled-back") {
        return { ok: false, error: `bb rolled it back${result.detail ? `: ${result.detail}` : "."}` };
      }
      return { ok: true, pluginId: job.pluginId, result: result.outcome, ...(result.to ? { to: result.to } : {}) };
    } catch (error) {
      return { ok: false, error: message(error) };
    }
  }

  async function runJob(job: Job, signal: AbortSignal): Promise<void> {
    const outcome = job.kind === "update" ? await update(job) : await install(job);
    // Reloaded mid-job (this plugin updating itself, say): the next load
    // finds the job still running, runs it again, and records that outcome.
    // An update that did land comes back "current" then.
    if (signal.aborted) return;
    await locked(async () => {
      await kv.set(JOBS, markFinished(await readJobs(), job.id, Date.now(), outcome));
      if (job.kind === "update") {
        // Done, the plugin is current and leaves the deck by itself; failed,
        // its card comes back carrying the error.
        const decisions = await readUpdateDecisions();
        if (decisions[job.pluginId]?.action === "queue") {
          delete decisions[job.pluginId];
          await kv.set(UPDATE_DECISIONS, decisions);
        }
      } else if (!outcome.ok) {
        // The card goes back in the deck, carrying the failure.
        const decisions = await readDecisions();
        delete decisions[job.key];
        await kv.set(DECISIONS, decisions);
      }
    });
    const what = job.kind === "update" ? `update of ${job.pluginId}` : `install of ${job.entryId}@${job.marketplace}`;
    if (outcome.ok) bb.log.info(`${what}: ${outcome.result ?? "done"}`);
    else bb.log.warn(`${what} failed: ${outcome.error}`);
    changed("job");
  }

  bb.background.service("queue", {
    async start(signal) {
      await locked(async () => kv.set(JOBS, recover(await readJobs())));
      while (!signal.aborted) {
        const job = await locked(async () => {
          const jobs = await readJobs();
          // This plugin's own update reloads it, so it waits for the rest.
          const next = nextRunnable(jobs, Date.now(), bb.pluginId);
          if (next !== null) await kv.set(JOBS, markRunning(jobs, next.id, Date.now()));
          return next;
        });
        if (job !== null) {
          changed("job");
          await runJob(job, signal);
          continue;
        }
        const at = nextWakeAt(await readJobs());
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            signal.removeEventListener("abort", done);
            wake = null;
            resolve();
          };
          const timer = at === null ? undefined : setTimeout(done, Math.max(0, at - Date.now()));
          wake = done;
          signal.addEventListener("abort", done, { once: true });
        });
      }
    },
  });

  bb.rpc.register(rpcContract, {
    deck_new: async ({ includeIncompatible }) => {
      const [entries, decisions, jobs, from] = await Promise.all([catalog(), readDecisions(), readJobs(), cutoff()]);
      return {
        cards: buildNewDeck({
          entries,
          decisions,
          cutoff: from,
          failures: failuresByKey(jobs),
          includeIncompatible: includeIncompatible ?? false,
        }),
        cutoff: from,
      };
    },

    deck_saved: async () => {
      const [entries, decisions] = await Promise.all([catalog(), readDecisions()]);
      return { cards: buildSavedList(entries, decisions) };
    },

    entry_plan: async ({ entryId, marketplace }) => {
      const plan = await bb.sdk.plugins.catalog.installPlan({ entryId, marketplace });
      if (plan.kind !== "marketplace") {
        return {
          summary: null,
          confirmedSource: null,
          compatible: plan.compatible,
          incompatibleReason: plan.incompatibleReason,
        };
      }
      return {
        summary: summarizeSource(plan.resolvedSource as ResolvedSource),
        confirmedSource: plan.resolvedSource,
        compatible: plan.compatible,
        incompatibleReason: plan.incompatibleReason,
      };
    },

    decide: async (input) => {
      // Fail closed: without the source the card showed, bb could not refuse
      // an install whose listing moved after the swipe. Only plugins bundled
      // with bb, whose plan has no listing source, install without one.
      if (input.action === "install" && input.confirmedSource == null && input.marketplace !== BUNDLED_MARKETPLACE) {
        throw new Error("This install is missing the source its card showed. Reload Triage and try again.");
      }
      const { job, previous } = await locked(async () => {
        const decisions = await readDecisions();
        const previous = decisions[input.key] ?? null;
        decisions[input.key] = { action: input.action, at: Date.now() };
        await kv.set(DECISIONS, decisions);
        if (input.action !== "install") return { job: null, previous };
        const now = Date.now();
        const next: Job = {
          id: `job_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          kind: "install",
          key: input.key,
          entryId: input.entryId,
          marketplace: input.marketplace,
          displayName: input.displayName,
          confirmedSource: input.confirmedSource ?? null,
          createdAt: now,
          runAfter: now,
          // Waits for Run all with the rest of the queue.
          held: true,
          previous,
          state: "pending",
          startedAt: null,
          finishedAt: null,
          pluginId: input.pluginId,
          error: null,
        };
        const jobs = enqueue(await readJobs(), next);
        await kv.set(JOBS, jobs);
        return { job: liveJob(jobs, input.key), previous };
      });
      changed("decision");
      return { job, previous };
    },

    undo: async ({ key, restore }) => {
      const result = await locked(async () => {
        const jobs = await readJobs();
        const live = liveJob(jobs, key);
        if (live?.state === "running") return { undone: false, reason: "It's already installing." };
        const decisions = await readDecisions();
        if (decisions[key]?.action === "install" && live === null) {
          return { undone: false, reason: "It's already installed. Remove it from Installed plugins instead." };
        }
        const { jobs: next } = cancelPending(jobs, key, Date.now());
        await kv.set(JOBS, next);
        if (restore == null) delete decisions[key];
        else decisions[key] = restore;
        await kv.set(DECISIONS, decisions);
        return { undone: true, reason: null };
      });
      if (result.undone) changed("undo");
      return result;
    },

    jobs_list: async () => ({ jobs: await readJobs() }),

    updates_deck: async () => {
      const [results, list, decisions, jobs] = await Promise.all([
        bb.sdk.plugins.listUpdateResults(),
        bb.sdk.plugins.list(),
        readUpdateDecisions(),
        readJobs(),
      ]);
      const { cards, unavailable } = buildUpdatesDeck({
        results: results as UpdateResult[],
        plugins: list.plugins as InstalledPlugin[],
        decisions,
        jobs,
        now: Date.now(),
        selfId: bb.pluginId,
      });
      const updates = jobs.filter((job): job is UpdateJob => job.kind === "update");
      return {
        cards,
        unavailable,
        history: updates
          .filter((job) => job.state === "done" || job.state === "failed")
          .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))
          .slice(0, HISTORY_SHOWN),
      };
    },

    update_decide: async (input) => {
      const previous = await locked(async () => {
        const decisions = await readUpdateDecisions();
        const previous = decisions[input.pluginId] ?? null;
        const now = Date.now();
        const version = input.to.version;
        decisions[input.pluginId] =
          input.action === "snooze" ? { action: "snooze", version, at: now, until: now + SNOOZE_MS } : { action: input.action, version, at: now };
        await kv.set(UPDATE_DECISIONS, decisions);
        if (input.action === "queue") {
          const job: UpdateJob = {
            id: `job_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
            kind: "update",
            key: updateKey(input.pluginId),
            pluginId: input.pluginId,
            displayName: input.displayName,
            from: input.from,
            to: input.to,
            held: true,
            previous,
            result: null,
            createdAt: now,
            runAfter: now,
            state: "pending",
            startedAt: null,
            finishedAt: null,
            error: null,
          };
          await kv.set(JOBS, enqueue(await readJobs(), job));
        }
        return previous;
      });
      changed("update-decision");
      return { previous };
    },

    update_undo: async ({ pluginId, restore }) => {
      const result = await locked(async () => {
        const jobs = await readJobs();
        const key = updateKey(pluginId);
        const live = liveJob(jobs, key);
        if (live?.state === "running") return { undone: false, reason: "It's already updating." };
        const { jobs: next } = cancelPending(jobs, key, Date.now());
        await kv.set(JOBS, next);
        const decisions = await readUpdateDecisions();
        if (restore == null) delete decisions[pluginId];
        else decisions[pluginId] = restore as UpdateDecision;
        await kv.set(UPDATE_DECISIONS, decisions);
        return { undone: true, reason: null };
      });
      if (result.undone) changed("undo");
      return result;
    },

    update_changes: async ({ pluginId, from, to, force }): Promise<Changes> => {
      let subdirectory: string | null = null;
      try {
        subdirectory = (await bb.sdk.plugins.getSource({ pluginId })).subdirectory ?? null;
      } catch {
        // Unknown source: describe the whole repository rather than nothing.
      }
      const key = changesKey(from, to, subdirectory);
      if (key === null) return { kind: "none" };
      // A commit range never changes, so an answer is good for good.
      const cached = await kv.get<Changes>(key);
      if (cached !== null && cached !== undefined) return cached;
      const token = await login.token();
      // Nearly out of requests: leave the rest to cards someone asks about.
      // A budget read without a login says nothing about one with it.
      if (
        force !== true &&
        budget !== null &&
        budget.withLogin === (token !== null) &&
        budget.remaining < LOW_BUDGET &&
        (budget.resetAt === null || Date.now() < budget.resetAt)
      ) {
        return { kind: "deferred", remaining: budget.remaining, resetAt: budget.resetAt };
      }
      const access = {
        token,
        onUnauthorized: () => login.reject(),
        onBudget: (next: Budget) => {
          budget = { ...next, withLogin: access.token !== null };
        },
      };
      const changes = await fetchChanges(fetch as never, from, to, subdirectory, access);
      if (changes.kind === "github" || changes.kind === "none") await kv.set(key, changes);
      return changes;
    },

    queue_status: async () => {
      const live = liveJobs(await readJobs(), bb.pluginId);
      return { jobs: live, running: live.some((job) => job.state === "running" || job.held !== true) };
    },

    queue_start: async () => {
      const started = await locked(async () => {
        const { jobs, released } = releaseHeld(await readJobs(), Date.now());
        await kv.set(JOBS, jobs);
        return released;
      });
      poke();
      changed("job");
      return { started };
    },

    unqueue: async ({ key }) => {
      const result = await locked(async () => {
        const jobs = await readJobs();
        const job = liveJob(jobs, key);
        if (job === null) return { removed: false, reason: "It's no longer queued." };
        if (job.state === "running") {
          return { removed: false, reason: job.kind === "update" ? "It's already updating." : "It's already installing." };
        }
        await kv.set(JOBS, cancelPending(jobs, key, Date.now()).jobs);
        // The card goes back to what it was before it was queued.
        if (job.kind === "install") {
          const decisions = await readDecisions();
          if (job.previous == null) delete decisions[key];
          else decisions[key] = job.previous as Decisions[string];
          await kv.set(DECISIONS, decisions);
        } else {
          const decisions = await readUpdateDecisions();
          if (job.previous == null) delete decisions[job.pluginId];
          else decisions[job.pluginId] = job.previous as UpdateDecision;
          await kv.set(UPDATE_DECISIONS, decisions);
        }
        return { removed: true, reason: null };
      });
      if (result.removed) changed("undo");
      return result;
    },

    updates_check: async ({ pluginId }) => {
      const checked = await bb.sdk.plugins.checkUpdates(pluginId === undefined ? {} : { pluginId });
      changed("updates");
      return { checked: checked.length };
    },
  });
}
