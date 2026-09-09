// One counts request per sidebar, not one per row.
//
// Follow-ups exposes `getFollowUpCountsV1` as a real contract — batch,
// versioned, and answering for every thread asked about. This module is the
// consumer side of it: rows announce which thread they need, a short timer
// collects everything announced in the same render, and one request answers
// all of them.
//
// The store lives at module scope rather than in a React context because the
// badges are portaled into sidebar rows one subtree at a time; there is no
// common ancestor to hang a provider on. It also owns the refresh cadence,
// rather than leaning on the host's shared `revision`: a plugin hears only its
// own realtime signals, so counts recorded elsewhere have to be discovered by
// asking, and this is the only badge with that problem. Waking the others on
// a follow-ups timer would be someone else's staleness paid for by them.

/** Follow-ups' plugin id and its one cross-plugin method. */
const FOLLOW_UP_PLUGIN = "follow-up";
const COUNTS_METHOD = "getFollowUpCountsV1";

/**
 * The version this consumer understands. Follow-ups promises to bump it when
 * the shape changes, which is the whole reason to read it: a payload that
 * changed shape and a thread with nothing recorded both leave us holding no
 * counts, and only one of them should stop us asking again.
 */
const PROTOCOL_VERSION = 1;

/** Follow-ups refuses more than this many threads in one call. */
const MAX_THREADS = 500;

/**
 * How long to collect thread ids before asking. Long enough that a sidebar
 * mounting its rows lands in one request, short enough to be invisible.
 */
const BATCH_DELAY = 25;

/**
 * How often the visible rows re-ask. Batching is what makes this affordable —
 * a tick is one request for the whole sidebar, not one per row — and 30s
 * matches the interval bb itself polls a pull request's checks at, so the
 * sidebar keeps one rhythm rather than two.
 */
const POLL_INTERVAL = 30_000;

export interface Counts {
  open: number;
  done: number;
}

/** Answers, kept across the constant unmount/remount of sidebar rows. */
const counts = new Map<string, Counts>();

/** Which revision each thread was last asked at, so re-renders do not re-ask. */
const asked = new Map<string, number>();

const listeners = new Map<string, Set<() => void>>();

const pending = new Set<string>();
let timer = 0;
let poll = 0;

/**
 * Set once Follow-ups answers with a version this code does not understand.
 * Not the same as a failed request: a failure is worth retrying and a version
 * we cannot read is not, so this stops the asking entirely rather than
 * spending a request per revision on an answer that will not improve.
 */
let unsupported = false;

function notify(threadId: string): void {
  for (const listener of listeners.get(threadId) ?? []) listener();
}

async function ask(threadIds: readonly string[]): Promise<void> {
  const response = await fetch(
    `/api/v1/plugins/${FOLLOW_UP_PLUGIN}/rpc/${COUNTS_METHOD}`,
    {
      body: JSON.stringify({ threadIds }),
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  const envelope = (await response.json()) as {
    ok?: boolean;
    result?: {
      protocolVersion?: number;
      counts?: readonly { threadId?: string; open?: number; done?: number }[];
    };
  };
  if (envelope.ok !== true || envelope.result === undefined) return;
  if (envelope.result.protocolVersion !== PROTOCOL_VERSION) {
    unsupported = true;
    stopPolling();
    // The one thing worth saying out loud. Every other failure here is
    // "Follow-ups is not installed", which is not a problem; this one means
    // the two plugins disagree about a contract and a human has to look.
    console.warn(
      `[thread-badges] Follow-ups answered ${COUNTS_METHOD} with protocol ` +
        `${String(envelope.result.protocolVersion)}; this build reads ` +
        `${PROTOCOL_VERSION}. The follow-ups ring is off until they agree.`,
    );
    return;
  }
  for (const entry of envelope.result.counts ?? []) {
    if (typeof entry.threadId !== "string") continue;
    const next: Counts = { done: entry.done ?? 0, open: entry.open ?? 0 };
    const previous = counts.get(entry.threadId);
    // Identity is the subscription's snapshot, so only replace it on a real
    // change: an unchanged object keeps `useSyncExternalStore` from
    // re-rendering every row on every refresh.
    if (previous?.open === next.open && previous.done === next.done) continue;
    counts.set(entry.threadId, next);
    notify(entry.threadId);
  }
}

function flush(): void {
  timer = 0;
  const threadIds = [...pending];
  pending.clear();
  for (let start = 0; start < threadIds.length; start += MAX_THREADS) {
    const chunk = threadIds.slice(start, start + MAX_THREADS);
    // Follow-ups is optional: no plugin, no route, no answer, no ring. The
    // ids stay marked as asked, so a failure costs one revision rather than a
    // request on every re-render.
    void ask(chunk).catch(() => undefined);
  }
}

function schedule(): void {
  if (timer === 0) timer = window.setTimeout(flush, BATCH_DELAY);
}

/**
 * Re-ask for every thread currently on screen.
 *
 * Not gated on `asked`: a tick is precisely "ask again at the same revision",
 * which is the guard's whole purpose to prevent for re-renders. It shares the
 * batch timer, so a tick landing next to a focus refresh is one request rather
 * than two.
 */
function tick(): void {
  // A hidden window is asking about a sidebar nobody is looking at. The host's
  // focus revision already refreshes on the way back, so skipping here costs
  // nothing and stops a backgrounded window reading storage forever.
  if (unsupported || document.hidden || listeners.size === 0) return;
  for (const threadId of listeners.keys()) pending.add(threadId);
  schedule();
}

/**
 * Idempotent, and deliberately never stopped while the plugin is loaded.
 *
 * Tying the interval's life to the subscriptions is the obvious design and it
 * starves: sidebar rows re-render constantly, every re-subscribe would clear
 * and recreate the timer, and a timer recreated more often than every 30s
 * never fires at all. A tick with no listeners is one comparison, which is a
 * far cheaper thing to spend than that failure mode.
 */
function startPolling(): void {
  if (poll !== 0 || unsupported) return;
  poll = window.setInterval(tick, POLL_INTERVAL);
}

function stopPolling(): void {
  if (poll === 0) return;
  window.clearInterval(poll);
  poll = 0;
}

/**
 * Say that a row needs this thread's counts as of `revision`. Repeated calls
 * at the same revision are free, which matters because sidebar rows re-render
 * constantly.
 */
export function requestCounts(threadId: string, revision: number): void {
  if (unsupported) return;
  if (asked.get(threadId) === revision) return;
  asked.set(threadId, revision);
  pending.add(threadId);
  schedule();
}

/**
 * The first subscription starts the polling. A badge switched off in settings
 * never subscribes, so it never starts a timer at all.
 */
export function subscribeCounts(threadId: string, listener: () => void): () => void {
  let set = listeners.get(threadId);
  if (set === undefined) {
    set = new Set();
    listeners.set(threadId, set);
  }
  set.add(listener);
  startPolling();
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(threadId);
  };
}

export function getCounts(threadId: string): Counts | null {
  return counts.get(threadId) ?? null;
}
