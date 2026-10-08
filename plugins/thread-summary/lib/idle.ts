// When a thread's agent finishes: the moment its branch is most likely to
// have changed, and the one Git refresh signal a plugin can see. bb sends a
// plugin no turn or diff events, but the sidebar's live thread list carries
// every thread's status.

/** Statuses bb sorts as busy; anything else, unknown included, is idle. */
const BUSY: ReadonlySet<string> = new Set(["starting", "active", "stopping"]);

export function isBusy(status: string): boolean {
  return BUSY.has(status);
}

/**
 * The threads that went from busy to idle since `previous`, and the busy map
 * to compare against next time. A thread seen for the first time has not
 * finished anything: it was not seen busy.
 */
export function finishedSince(
  previous: ReadonlyMap<string, boolean>,
  threads: readonly { id: string; status: string }[],
): { busy: Map<string, boolean>; finished: string[] } {
  const busy = new Map<string, boolean>();
  const finished: string[] = [];
  for (const thread of threads) {
    const now = isBusy(thread.status);
    if (previous.get(thread.id) === true && !now) finished.push(thread.id);
    busy.set(thread.id, now);
  }
  return { busy, finished };
}
