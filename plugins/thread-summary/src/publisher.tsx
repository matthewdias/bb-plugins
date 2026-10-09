// The provider half of this plugin: the Git and pull-request complications.
//
// Mounted once per window as an app overlay, and renders nothing visible.
// Each provider answers only the threads some surface wants — this plugin's
// own header, or Thread Badges' rows once you turn them on there.
//
// The pull request comes from bb's per-thread hook, which owns the polling
// and staleness, so each wanted thread gets one hidden probe component that
// calls it. Git comes from the environment's status, asked again when a card
// opens for the thread, every 20 seconds while it stays open, and whenever the
// thread's agent goes from busy to idle: bb sends a plugin no turn or diff
// events of its own, and an agent finishing a turn is when a branch changes.
// A few threads at a time, so a surface that wants Git for every sidebar row
// does not start a `git status` per row at once.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  experimental_useSidebarThreadPullRequest,
  experimental_useSidebarThreads,
  useSdk,
} from "@get-bb/plugin-sdk/app";
import {
  getComplications,
  type ComplicationProviderHandle,
  type ComplicationProviderRegistration,
} from "../lib/complications";
import { environmentOf, readGitStatus, type GitSdk } from "../lib/git-source";
import { gitValue } from "../lib/git-value";
import { finishedSince } from "../lib/idle";
import { createLimiter } from "../lib/limit";
import { prValue } from "../lib/pr-value";
import { gitRegistration, pullRequestRegistration } from "../lib/registrations";
import { thread } from "./complications";
import { isOpen, onOpenChange } from "./open-cards";

/** How often Git is asked again while a card is open for the thread. */
export const GIT_POLL_MS = 20_000;
/** How often threads no surface wants any more stop being probed. */
export const PRUNE_MS = 10_000;
/** Git refreshes in flight at once, across every thread in the window. */
export const MAX_CONCURRENT_GIT = 4;

/** A wanted thread, and how many times it has been asked for. */
interface Asked {
  threadId: string;
  /** Moves each time a surface wants the thread afresh, which asks again. */
  revision: number;
}

/**
 * Register a provider, and track the threads it is asked about.
 *
 * The registry tells a provider when a subject becomes wanted, never when it
 * stops: a row scrolling away just releases it. So every so often the threads
 * no longer wanted are dropped, which unmounts their probes; wanting one again
 * asks again, which mounts its probe at once — or, if it was never dropped,
 * makes it ask afresh.
 */
function useProvider(
  register: (ask: (threadIds: string[]) => void) => ComplicationProviderRegistration,
): [ComplicationProviderHandle | null, Asked[]] {
  const [handle, setHandle] = useState<ComplicationProviderHandle | null>(null);
  const [asked, setAsked] = useState<ReadonlyMap<string, number>>(new Map());

  useEffect(() => {
    const registry = getComplications();
    if (registry === null) return;
    const ask = (threadIds: string[]) =>
      setAsked((current) => {
        const next = new Map(current);
        for (const id of threadIds) next.set(id, (current.get(id) ?? 0) + 1);
        return next;
      });
    const next = registry.provide(register(ask));
    setHandle(next);
    return () => {
      setHandle(null);
      setAsked(new Map());
      next.dispose();
    };
  }, [register]);

  useEffect(() => {
    if (handle === null) return;
    const timer = window.setInterval(
      () =>
        setAsked((current) => {
          const kept = [...current].filter(([id]) => handle.isWanted(thread(id)));
          return kept.length === current.size ? current : new Map(kept);
        }),
      PRUNE_MS,
    );
    return () => window.clearInterval(timer);
  }, [handle]);

  const wanted = useMemo(
    () => [...asked].map(([threadId, revision]) => ({ threadId, revision })),
    [asked],
  );
  return [handle, wanted];
}

function PullRequestProbe({ threadId, handle }: { threadId: string; handle: ComplicationProviderHandle }) {
  const { isLoading, pullRequest } = experimental_useSidebarThreadPullRequest(threadId);
  const value = useMemo(() => prValue(pullRequest), [pullRequest]);
  useEffect(() => {
    // Until the first lookup lands there is nothing to say either way, and
    // `null` would wipe the value a surface kept while this thread was away.
    if (isLoading) return;
    handle.set(thread(threadId), value);
  }, [handle, isLoading, threadId, value]);
  return null;
}

/**
 * Where a thread's environment comes from: the sidebar's list, read live, or
 * — for a thread it does not carry, such as an archived one — bb, asked at
 * each refresh. While the list loads, nothing is asked at all.
 */
type EnvironmentSource =
  | { from: "sidebar"; environmentId: string | null }
  | { from: "bb" }
  | { from: "loading" };

function GitProbe({
  threadId,
  handle,
  source,
  askRevision,
  idleRevision,
  limit,
}: {
  threadId: string;
  handle: ComplicationProviderHandle;
  source: EnvironmentSource;
  /** Moves each time a surface wants this thread afresh. */
  askRevision: number;
  /** Moves each time this thread's agent goes from busy to idle. */
  idleRevision: number;
  limit: <T>(task: () => Promise<T>) => Promise<T>;
}) {
  const sdk = useSdk();
  const sdkRef = useRef(sdk);
  sdkRef.current = sdk;
  const [openRevision, setOpenRevision] = useState(0);
  const [open, setOpen] = useState(() => isOpen(threadId));

  useEffect(
    () =>
      onOpenChange((id, nowOpen) => {
        if (id !== threadId) return;
        setOpen(nowOpen);
        if (nowOpen) setOpenRevision((revision) => revision + 1);
      }),
    [threadId],
  );

  // Primitives, so the refresh below runs when the environment changes and
  // not on every render that rebuilds the same source.
  const from = source.from;
  const sidebarEnvironment = source.from === "sidebar" ? source.environmentId : null;

  useEffect(() => {
    if (from === "loading") return;
    // False once this refresh is superseded: React cleans an effect up before
    // running it again, so a later refresh — or an unmount — ends this one.
    let live = true;
    const refresh = async () => {
      try {
        const value = await limit(async () => {
          // Queued behind other threads and since superseded: skip the calls.
          if (!live) return undefined;
          const sdkNow = sdkRef.current as unknown as GitSdk;
          const environmentId = from === "sidebar" ? sidebarEnvironment : await environmentOf(sdkNow, threadId);
          if (environmentId === null) return null;
          return gitValue(await readGitStatus(sdkNow, environmentId));
        });
        // A slower, older answer must not overwrite a newer one.
        if (value !== undefined && live) handle.set(thread(threadId), value);
      } catch {
        // Keep the last good value: a failed refresh is not "no branch".
      }
    };
    void refresh();
    return () => {
      live = false;
    };
  }, [handle, threadId, from, sidebarEnvironment, askRevision, idleRevision, openRevision, limit]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => setOpenRevision((revision) => revision + 1), GIT_POLL_MS);
    return () => window.clearInterval(timer);
  }, [open]);

  return null;
}

/**
 * Per thread, a number that moves each time the thread goes from busy to
 * idle, read from the sidebar's live thread list — the host's own cache, so
 * this costs no request.
 */
function useIdleRevisions(
  threads: readonly { id: string; status: string }[],
): ReadonlyMap<string, number> {
  const busyRef = useRef<ReadonlyMap<string, boolean>>(new Map());
  const [revisions, setRevisions] = useState<ReadonlyMap<string, number>>(new Map());
  useEffect(() => {
    const { busy, finished } = finishedSince(busyRef.current, threads);
    busyRef.current = busy;
    if (finished.length === 0) return;
    setRevisions((current) => {
      const next = new Map(current);
      for (const id of finished) next.set(id, (next.get(id) ?? 0) + 1);
      return next;
    });
  }, [threads]);
  return revisions;
}

export function Publisher() {
  const [gitHandle, gitThreads] = useProvider(gitRegistration);
  const [prHandle, prThreads] = useProvider(pullRequestRegistration);
  const { status, threads } = experimental_useSidebarThreads();
  const idle = useIdleRevisions(threads);
  const limit = useMemo(() => createLimiter(MAX_CONCURRENT_GIT), []);
  const environments = useMemo(
    () => new Map(threads.map((entry) => [entry.id, entry.environment?.id ?? null])),
    [threads],
  );
  const sourceOf = (threadId: string): EnvironmentSource => {
    if (status !== "ready") return { from: "loading" };
    const environmentId = environments.get(threadId);
    return environmentId === undefined ? { from: "bb" } : { from: "sidebar", environmentId };
  };
  return (
    <>
      {gitHandle !== null
        ? gitThreads.map(({ threadId, revision }) => (
            <GitProbe
              askRevision={revision}
              handle={gitHandle}
              idleRevision={idle.get(threadId) ?? 0}
              key={threadId}
              limit={limit}
              source={sourceOf(threadId)}
              threadId={threadId}
            />
          ))
        : null}
      {prHandle !== null
        ? prThreads.map(({ threadId }) => (
            <PullRequestProbe handle={prHandle} key={threadId} threadId={threadId} />
          ))
        : null}
    </>
  );
}
