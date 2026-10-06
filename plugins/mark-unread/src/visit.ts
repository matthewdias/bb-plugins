// The visit in progress: which thread is in view, since when, and whether this
// visit has already scrolled to the read point.
//
// Kept in sessionStorage rather than component state so it outlives the
// overlay. A plugin reload or disable unmounts the overlay while you stay in
// the thread; with the visit kept here, the overlay that mounts next carries
// on the same visit instead of taking the unmount for leaving (and forgetting
// the point) or the remount for arriving (and scrolling you back to it).
// sessionStorage is per tab, which is what a visit is.

export interface Visit {
  threadId: string;
  /** Epoch ms. A point set before this has been seen by this visit. */
  startedAt: number;
  /** The setAt of the point this visit has scrolled to, if it has. */
  revealedSetAt: number | null;
}

export const VISIT_KEY = "mark-unread:visit";

export function readVisit(storage: Storage): Visit | null {
  try {
    const value: unknown = JSON.parse(storage.getItem(VISIT_KEY) ?? "null");
    if (typeof value !== "object" || value === null) return null;
    const { threadId, startedAt, revealedSetAt } = value as Record<string, unknown>;
    if (typeof threadId !== "string" || threadId === "" || typeof startedAt !== "number") return null;
    return { threadId, startedAt, revealedSetAt: typeof revealedSetAt === "number" ? revealedSetAt : null };
  } catch {
    return null;
  }
}

export function writeVisit(storage: Storage, visit: Visit | null): void {
  try {
    if (visit) storage.setItem(VISIT_KEY, JSON.stringify(visit));
    else storage.removeItem(VISIT_KEY);
  } catch {
    // Storage full or blocked: visits fall back to lasting one mount.
  }
}

/**
 * The visit for the thread now in view: the stored one if it is for this
 * thread, so a remount continues it, otherwise a new one starting now.
 */
export function visitFor(storage: Storage, threadId: string | null, now: number): Visit | null {
  if (!threadId) return null;
  const stored = readVisit(storage);
  return stored?.threadId === threadId ? stored : { threadId, startedAt: now, revealedSetAt: null };
}
