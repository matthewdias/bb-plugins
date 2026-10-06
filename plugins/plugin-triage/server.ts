// Plugin Triage — server entry.
//
// Holds what the page cannot: the decisions made on each card, and the queue
// of installs those decisions start. The queue lives here rather than in the
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
  GRACE_MS,
  cancelPending,
  enqueue,
  failuresByKey,
  liveJob,
  markFinished,
  markRunning,
  nextRunnable,
  nextWakeAt,
  recover,
  type Job,
} from "./lib/queue.ts";
import { summarizeSource, type ResolvedSource } from "./lib/source.ts";

export { rpcContract };

const DECISIONS = "decisions";
const JOBS = "jobs";
const FIRST_RUN_AT = "firstRunAt";

/** bb's refusal when the plugin landed after all — a resumed job, say. */
const ALREADY_INSTALLED = /is already installed/i;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default async function plugin(bb: BbPluginApi) {
  const kv = bb.storage.kv;

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

  async function runJob(job: Job, signal: AbortSignal): Promise<void> {
    let outcome: { ok: true; pluginId: string } | { ok: false; error: string };
    try {
      const installed = await bb.sdk.plugins.catalog.install({
        entryId: job.entryId,
        marketplace: job.marketplace,
        ...(job.confirmedSource == null ? {} : { confirmedSource: job.confirmedSource as never }),
      });
      outcome = { ok: true, pluginId: installed.id };
    } catch (error) {
      const text = message(error);
      outcome = ALREADY_INSTALLED.test(text)
        ? { ok: true, pluginId: job.pluginId ?? job.entryId }
        : { ok: false, error: text };
    }
    // Reloaded mid-install (this plugin updating itself, say): the next load
    // finds the job still running, runs it again, and records that outcome.
    if (signal.aborted) return;
    await locked(async () => {
      await kv.set(JOBS, markFinished(await readJobs(), job.id, Date.now(), outcome));
      if (!outcome.ok) {
        // The card goes back in the deck, carrying the failure.
        const decisions = await readDecisions();
        delete decisions[job.key];
        await kv.set(DECISIONS, decisions);
      }
    });
    if (outcome.ok) bb.log.info(`installed ${job.entryId}@${job.marketplace}`);
    else bb.log.warn(`install of ${job.entryId}@${job.marketplace} failed: ${outcome.error}`);
    changed("job");
  }

  bb.background.service("queue", {
    async start(signal) {
      await locked(async () => kv.set(JOBS, recover(await readJobs())));
      while (!signal.aborted) {
        const job = await locked(async () => {
          const jobs = await readJobs();
          const next = nextRunnable(jobs, Date.now());
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
          runAfter: now + GRACE_MS,
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
      poke();
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
  });
}
