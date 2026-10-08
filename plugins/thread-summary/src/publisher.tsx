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
import { useEffect, useMemo, useRef, useState } from "react";
import {
  experimental_useSidebarThreadPullRequest,
  experimental_useSidebarThreads,
  useSdk,
} from "@get-bb/plugin-sdk/app";
import {
  getComplications,
  type ComplicationProviderHandle,
} from "../lib/complications";
import { readGitStatus, type GitSdk } from "../lib/git-source";
import { gitValue } from "../lib/git-value";
import { finishedSince } from "../lib/idle";
import { prValue } from "../lib/pr-value";
import { gitRegistration, pullRequestRegistration } from "../lib/registrations";
import { thread } from "./complications";
import { isOpen, onOpenChange } from "./open-cards";

/** How often Git is asked again while a card is open for the thread. */
export const GIT_POLL_MS = 20_000;
/** How often a thread no surface wants any more stops being probed. */
const PRUNE_MS = 10_000;

/** Threads a provider was asked about and is still wanted for. */
function useWanted(handle: ComplicationProviderHandle | null, asked: readonly string[]): string[] {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (handle === null) return;
    // The registry tells a provider when a subject becomes wanted, never when
    // it stops: a row scrolling away just releases it. So look again now and
    // then, and drop the probes nobody needs.
    const timer = window.setInterval(() => setTick((tick) => tick + 1), PRUNE_MS);
    return () => window.clearInterval(timer);
  }, [handle]);
  return handle === null ? [] : asked.filter((id) => handle.isWanted(thread(id)));
}

function useProvider(
  register: (ask: (threadIds: string[]) => void) => Parameters<
    NonNullable<ReturnType<typeof getComplications>>["provide"]
  >[0],
): [ComplicationProviderHandle | null, string[]] {
  const [handle, setHandle] = useState<ComplicationProviderHandle | null>(null);
  const [asked, setAsked] = useState<string[]>([]);
  useEffect(() => {
    const registry = getComplications();
    if (registry === null) return;
    const ask = (threadIds: string[]) =>
      setAsked((current) => {
        const fresh = threadIds.filter((id) => !current.includes(id));
        return fresh.length === 0 ? current : [...current, ...fresh];
      });
    const next = registry.provide(register(ask));
    setHandle(next);
    return () => {
      setHandle(null);
      next.dispose();
    };
  }, [register]);
  const wanted = useWanted(handle, asked);
  return [handle, wanted];
}

function PullRequestProbe({ threadId, handle }: { threadId: string; handle: ComplicationProviderHandle }) {
  const { isLoading, pullRequest } = experimental_useSidebarThreadPullRequest(threadId);
  const value = useMemo(() => prValue(pullRequest), [pullRequest]);
  useEffect(() => {
    // Until the first lookup lands there is nothing to say either way.
    if (isLoading) return;
    handle.set(thread(threadId), value);
  }, [handle, isLoading, threadId, value]);
  return null;
}

function GitProbe({
  threadId,
  handle,
  idleRevision,
}: {
  threadId: string;
  handle: ComplicationProviderHandle;
  /** Moves each time this thread's agent goes from busy to idle. */
  idleRevision: number;
}) {
  const sdk = useSdk();
  const sdkRef = useRef(sdk);
  sdkRef.current = sdk;
  const environmentRef = useRef<string | null | undefined>(undefined);
  const sequenceRef = useRef(0);
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

  useEffect(() => {
    let live = true;
    const sequence = ++sequenceRef.current;
    const refresh = async () => {
      try {
        const status = await readGitStatus(sdkRef.current as unknown as GitSdk, threadId, environmentRef);
        // A slower, older answer must not overwrite a newer one.
        if (live && sequence === sequenceRef.current) {
          handle.set(thread(threadId), status === null ? null : gitValue(status));
        }
      } catch {
        // Keep the last good value: a failed refresh is not "no branch".
      }
    };
    void refresh();
    return () => {
      live = false;
    };
  }, [handle, threadId, idleRevision, openRevision]);

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
function useIdleRevisions(): ReadonlyMap<string, number> {
  const { threads } = experimental_useSidebarThreads();
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
  const idle = useIdleRevisions();
  return (
    <>
      {gitHandle !== null
        ? gitThreads.map((threadId) => (
            <GitProbe
              handle={gitHandle}
              idleRevision={idle.get(threadId) ?? 0}
              key={threadId}
              threadId={threadId}
            />
          ))
        : null}
      {prHandle !== null
        ? prThreads.map((threadId) => (
            <PullRequestProbe handle={prHandle} key={threadId} threadId={threadId} />
          ))
        : null}
    </>
  );
}
