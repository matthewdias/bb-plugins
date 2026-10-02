// The feed every Glance client reads: what needs you, what is running, and
// what you touched last.
//
// "Needs you" is the rule bb-plugin-attention applies on bb's homepage, kept
// identical so the widget and the homepage never disagree: an error, a pending
// interaction, or a finished turn bb considers unread
// (latestAttentionAt > lastReadAt). Ranked error > interaction > unread, then
// most recently attended first.
//
// Pure on purpose: the server gathers threads, interactions and project names,
// and everything that decides what a client sees is here, under test.
import { createHash } from "node:crypto";

/** The subset of bb's thread row the feed reads. */
export interface ThreadRow {
  id: string;
  projectId: string;
  title: string | null;
  titleFallback?: string | null;
  status: string;
  visibility: string;
  archivedAt: number | null;
  deletedAt?: number | null;
  hasPendingInteraction?: boolean;
  latestAttentionAt: number;
  lastReadAt: number | null;
  updatedAt: number;
  runtime?: { displayStatus?: string } | null;
}

export interface PendingInteraction {
  label: string;
  detail?: string;
}

export type ItemState = "error" | "interaction" | "unread" | "running" | "idle";

export interface FeedItem {
  threadId: string;
  projectId: string;
  projectName: string | null;
  title: string;
  state: ItemState;
  label: string;
  detail?: string;
  attentionAt: number;
  updatedAt: number;
  /** Joined by the client with whatever base URL it reaches bb through. */
  path: string;
}

export interface Feed {
  schema: 1;
  /** Content hash; also the ETag. Stable while nothing a client sees changes. */
  version: string;
  generatedAt: number;
  actionsAllowed: boolean;
  needsMe: { total: number; items: FeedItem[] };
  running: { total: number; items: FeedItem[] };
  recent: { items: FeedItem[] };
}

export const LIMITS = { needsMe: 20, running: 20, recent: 10 } as const;

const RANK = { error: 0, interaction: 1, unread: 2 } as const;

export function threadTitle(thread: ThreadRow): string {
  return thread.title ?? thread.titleFallback ?? "Untitled thread";
}

export function threadPath(thread: Pick<ThreadRow, "id" | "projectId">): string {
  return `/projects/${encodeURIComponent(thread.projectId)}/threads/${encodeURIComponent(thread.id)}`;
}

/** Background workers and archived or deleted threads never reach a client. */
export function isListed(thread: ThreadRow): boolean {
  return (
    thread.visibility === "visible" &&
    thread.archivedAt === null &&
    (thread.deletedAt ?? null) === null
  );
}

export function isErrored(thread: ThreadRow): boolean {
  return thread.status === "error" || thread.runtime?.displayStatus === "error";
}

/** Threads whose pending interaction the server must look up. */
export function mayHaveInteraction(thread: ThreadRow): boolean {
  return !isErrored(thread) && (thread.hasPendingInteraction === true || thread.status === "active");
}

export function classify(
  thread: ThreadRow,
  pending: PendingInteraction | undefined,
): { state: ItemState; label: string; detail?: string } {
  if (isErrored(thread)) return { state: "error", label: "Failed" };
  if (pending !== undefined) {
    return { state: "interaction", label: pending.label, ...(pending.detail ? { detail: pending.detail } : {}) };
  }
  if (thread.status === "active") return { state: "running", label: "Running" };
  if (thread.status === "idle" && thread.latestAttentionAt > (thread.lastReadAt ?? 0)) {
    return { state: "unread", label: "Turn finished — reply needed" };
  }
  return { state: "idle", label: "Idle" };
}

export function buildFeed(input: {
  threads: readonly ThreadRow[];
  pending: ReadonlyMap<string, PendingInteraction>;
  projectNames: ReadonlyMap<string, string>;
  actionsAllowed: boolean;
  now: number;
}): Feed {
  const items: FeedItem[] = [];
  for (const thread of input.threads) {
    if (!isListed(thread)) continue;
    const verdict = classify(thread, input.pending.get(thread.id));
    items.push({
      threadId: thread.id,
      projectId: thread.projectId,
      projectName: input.projectNames.get(thread.projectId) ?? null,
      title: threadTitle(thread),
      ...verdict,
      attentionAt: thread.latestAttentionAt,
      updatedAt: thread.updatedAt,
      path: threadPath(thread),
    });
  }

  const needsMe = items
    .filter((item): item is FeedItem & { state: keyof typeof RANK } => item.state in RANK)
    .sort((a, b) => RANK[a.state] - RANK[b.state] || b.attentionAt - a.attentionAt);
  const running = items
    .filter((item) => item.state === "running")
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const recent = [...items].sort((a, b) => b.updatedAt - a.updatedAt);

  const body = {
    actionsAllowed: input.actionsAllowed,
    needsMe: { total: needsMe.length, items: needsMe.slice(0, LIMITS.needsMe) },
    running: { total: running.length, items: running.slice(0, LIMITS.running) },
    recent: { items: recent.slice(0, LIMITS.recent) },
  };
  return { schema: 1, version: feedVersion(body), generatedAt: input.now, ...body };
}

/**
 * Hashes only what a client renders, so `generatedAt` ticking over never looks
 * like a change: an unchanged version is what lets the Mac app skip a widget
 * reload, and WidgetKit budgets those.
 */
export function feedVersion(body: Omit<Feed, "schema" | "version" | "generatedAt">): string {
  return createHash("sha256").update(JSON.stringify(body)).digest("base64url").slice(0, 16);
}
