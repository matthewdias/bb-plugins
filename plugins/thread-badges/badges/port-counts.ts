// One snapshot request per sidebar, not one per row.
//
// Worktree Ports already does everything hard about ports — lsof, Docker
// attribution, role classification, per-machine scanning — and its snapshot
// already carries the `environment → threads` mapping a badge needs. So this
// module reads, and nothing here scans.
//
// The store lives at module scope for the same reason ./follow-up-counts does:
// badges are portaled into sidebar rows one subtree at a time, so there is no
// common ancestor to hang a provider on.
//
// Two things differ from the follow-ups store, both because the shape of the
// source differs:
//
//   - No batching. Follow-ups answers about the threads you name, so rows have
//     to collect ids before asking. The ports snapshot is the whole picture in
//     one document, so a single request already answers for every row and the
//     ids only decide who gets notified.
//   - No version latch. Follow-ups stamps `protocolVersion` and this code stops
//     asking when it reads one it does not understand. The snapshot carries no
//     such stamp, so there is no such signal to act on: every failure here is
//     treated as transient and retried, because "Worktree Ports is not
//     installed" and "Worktree Ports changed shape" are indistinguishable from
//     the outside and only one of them is worth giving up over.

/** Worktree Ports' plugin id, and the route its own thread-row script reads. */
const PORTS_PLUGIN = "worktree-ports";
const SNAPSHOT_URL = `/api/v1/plugins/${PORTS_PLUGIN}/http/snapshot`;

/**
 * Deliberately the plain HTTP route rather than the `ports_snapshot` RPC.
 *
 * Both return the same document, but the RPC forces a fresh scan when the
 * cached one is stale and resets the scanner's idle counter — it exists for
 * someone who just opened the card and wants an answer now. A badge is the
 * opposite of that: it is passive, it is on screen whenever the sidebar is,
 * and calling the RPC on a timer would hold Worktree Ports on its fast cadence
 * forever, running lsof for a sidebar nobody is reading. This route is a pure
 * read of whatever the owner last scanned, which is the right thing for a
 * consumer to take.
 */

/**
 * How often the visible rows re-ask. Worktree Ports polls its own card every
 * 5s and the follow-ups ring polls every 30s; ports sit between them, because
 * a dev server coming up is news within seconds but nobody is watching the
 * badge for it. The request is one document for the whole sidebar, which is
 * what makes this affordable at all.
 */
const POLL_INTERVAL = 10_000;

/** A port on one thread's worktree, reduced to what a badge can draw. */
export interface ThreadPort {
  port: number;
  role: "app" | "service" | "internal";
  /** The name on the label: the ports.json label, else the service, else the process. */
  name: string;
  url: string;
}

/** Answers, kept across the constant unmount/remount of sidebar rows. */
const ports = new Map<string, readonly ThreadPort[]>();

/** Per thread, so an unchanged entry can keep its identity across a refresh. */
const signatures = new Map<string, string>();

const listeners = new Map<string, Set<() => void>>();

/** The revision the last request was made at, so re-renders do not re-ask. */
let askedRevision: number | null = null;

let inFlight = false;
let poll = 0;

function notify(threadId: string): void {
  for (const listener of listeners.get(threadId) ?? []) listener();
}

/** The snapshot as it arrives. Only the fields this badge reads are named. */
interface SnapshotBody {
  groups?: readonly {
    threads?: readonly { id?: string }[];
    ports?: readonly {
      port?: number;
      role?: string;
      label?: string | null;
      service?: string | null;
      container?: string | null;
      processName?: string;
      url?: string;
    }[];
  }[];
}

type SnapshotPort = NonNullable<NonNullable<SnapshotBody["groups"]>[number]["ports"]>[number];

/**
 * What to call a port, approximating Worktree Ports' own `pillName`.
 *
 * It resolves a compose service through a table this plugin cannot see, so
 * this reads the `service` field the snapshot already carries instead. The two
 * agree wherever compose named the service, which is the case that matters.
 */
function nameOf(port: SnapshotPort): string {
  return (
    port.label ??
    port.service ??
    port.container ??
    (port.processName === undefined || port.processName === "" ? "unknown" : port.processName)
  );
}

function roleOf(port: SnapshotPort): ThreadPort["role"] {
  return port.role === "app" || port.role === "service" ? port.role : "internal";
}

function toThreadPorts(group: NonNullable<SnapshotBody["groups"]>[number]): ThreadPort[] {
  const result: ThreadPort[] = [];
  for (const port of group.ports ?? []) {
    if (typeof port.port !== "number") continue;
    result.push({
      name: nameOf(port),
      port: port.port,
      role: roleOf(port),
      url: port.url ?? `http://localhost:${port.port}`,
    });
  }
  // Sorted so the label and the number a badge shows stay put between scans;
  // the scan's own order is whatever lsof happened to print.
  return result.sort((left, right) => left.port - right.port);
}

async function ask(): Promise<void> {
  const response = await fetch(SNAPSHOT_URL, { credentials: "same-origin" });
  // Worktree Ports absent means no plugin, no route, and a 404 here.
  if (!response.ok) return;
  const body = (await response.json()) as SnapshotBody;
  if (!Array.isArray(body.groups)) return;

  const next = new Map<string, ThreadPort[]>();
  for (const group of body.groups) {
    const groupPorts = toThreadPorts(group);
    if (groupPorts.length === 0) continue;
    // A worktree can carry several threads, and every one of them is serving
    // the same listeners.
    for (const thread of group.threads ?? []) {
      if (typeof thread.id !== "string" || thread.id === "") continue;
      next.set(thread.id, groupPorts);
    }
  }

  for (const [threadId, value] of next) {
    const signature = JSON.stringify(value);
    // Identity is the subscription's snapshot, so only replace it on a real
    // change: an unchanged array keeps `useSyncExternalStore` from re-rendering
    // every row on every poll.
    if (signatures.get(threadId) === signature) continue;
    signatures.set(threadId, signature);
    ports.set(threadId, value);
    notify(threadId);
  }
  for (const threadId of [...ports.keys()]) {
    if (next.has(threadId)) continue;
    ports.delete(threadId);
    signatures.delete(threadId);
    notify(threadId);
  }
}

function fetchSnapshot(): void {
  // One request at a time. A poll landing on a slow response would otherwise
  // queue a second answer about the same scan.
  if (inFlight) return;
  inFlight = true;
  void ask()
    .catch(() => undefined)
    .finally(() => {
      inFlight = false;
    });
}

/**
 * Re-read the snapshot for whoever is on screen.
 *
 * A hidden window is asking about a sidebar nobody is looking at; the host's
 * focus revision refreshes on the way back, so skipping here costs nothing.
 */
function tick(): void {
  if (document.hidden || listeners.size === 0) return;
  fetchSnapshot();
}

/**
 * Idempotent, and deliberately never stopped while the plugin is loaded.
 *
 * Tying the interval's life to the subscriptions is the obvious design and it
 * starves: sidebar rows re-render constantly, every re-subscribe would clear
 * and recreate the timer, and a timer recreated more often than every 10s
 * never fires at all. A tick with no listeners is one comparison.
 */
function startPolling(): void {
  if (poll !== 0) return;
  poll = window.setInterval(tick, POLL_INTERVAL);
}

/**
 * Say that a row needs ports as of `revision`. Every row announces the same
 * revision, so the first one through triggers the request and the rest are
 * free — which matters because sidebar rows re-render constantly.
 */
export function requestPorts(revision: number): void {
  if (askedRevision === revision) return;
  askedRevision = revision;
  fetchSnapshot();
}

/**
 * The first subscription starts the polling. The badge ships off, and a badge
 * switched off never subscribes — so an untouched install never starts a timer
 * or makes a request at all.
 */
export function subscribePorts(threadId: string, listener: () => void): () => void {
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

export function getPorts(threadId: string): readonly ThreadPort[] | null {
  return ports.get(threadId) ?? null;
}
