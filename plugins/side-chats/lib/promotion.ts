// What makes a thread a side chat, what state one is in, whether it may be
// promoted or archived, and what a promoted one is called. Pure, so the policy
// is tested without a host.
//
// A side chat is bb's built-in side-chat plugin's hidden fork of a thread,
// owned by that thread's lifecycle: archiving the main thread archives it, and
// ownership can never be changed. Promotion therefore forks the side chat
// again, as a visible thread with no owner, rather than un-hiding it.

/** The built-in plugin that creates side chats. */
export const SIDE_CHAT_PLUGIN_ID = "side-chat";

/** Realtime channel: a thread's set of side chats changed. */
export const SIDE_CHATS_CHANGED = "side-chats-changed";

/** The seed the side-chat plugin puts before the replied-to message. */
const REPLY_SEED_PREFIX = "Replying to this earlier message in the conversation:";

const TITLE_MAX = 60;

/** The thread fields this module reads. */
export interface ThreadFacts {
  id: string;
  originKind: string | null;
  originPluginId: string | null;
  visibility: "hidden" | "visible";
  archivedAt: number | null;
  status: string;
  queuedMessageCount: number;
  sourceThreadId: string | null;
}

/**
 * The same test bb's app applies: a hidden fork made by the side-chat plugin.
 * One made visible by hand is no longer a side chat to anyone.
 */
export function isSideChat(thread: Pick<ThreadFacts, "originKind" | "originPluginId" | "visibility">): boolean {
  return (
    thread.originKind === "fork" &&
    thread.originPluginId === SIDE_CHAT_PLUGIN_ID &&
    thread.visibility === "hidden"
  );
}

/**
 * Why `thread` cannot be promoted right now, or null when it can.
 *
 * A side chat mid-turn or with queued messages would be forked without the
 * reply in flight or the messages waiting, and then archived with them, so
 * both are refused rather than silently dropped.
 */
export function refusalFor(thread: ThreadFacts, hasUserMessage: boolean): string | null {
  if (!isSideChat(thread)) return `${thread.id} is not a side chat.`;
  if (thread.archivedAt !== null) return `Side chat ${thread.id} is archived.`;
  if (thread.status !== "idle" && thread.status !== "error") {
    return `Side chat ${thread.id} is still working. Promote it once it has finished.`;
  }
  if (thread.queuedMessageCount > 0) {
    return `Side chat ${thread.id} has queued messages. Send or delete them first.`;
  }
  if (!hasUserMessage) return `Side chat ${thread.id} has no messages yet.`;
  return null;
}

/** Why a side chat cannot be archived, or null when it can. A busy one may be: archiving stops it. */
export function archiveRefusalFor(thread: ThreadFacts): string | null {
  if (!isSideChat(thread)) return `${thread.id} is not a side chat.`;
  if (thread.archivedAt !== null) return `Side chat ${thread.id} is already archived.`;
  return null;
}

/**
 * Why an archived side chat cannot be brought back, or null when it can. bb
 * refuses to restore one while its main thread is archived. One that was
 * promoted lives on as the promoted thread; restoring it would put the same
 * conversation in two places.
 */
export function unarchiveRefusalFor(
  thread: ThreadFacts,
  context: { mainArchived: boolean; promotedTo: string | null },
): string | null {
  if (!isSideChat(thread)) return `${thread.id} is not a side chat.`;
  if (thread.archivedAt === null) return `Side chat ${thread.id} is not archived.`;
  if (context.promotedTo !== null) {
    return `Side chat ${thread.id} was promoted to ${context.promotedTo}; open that thread instead.`;
  }
  if (context.mainArchived) {
    return `The main thread of side chat ${thread.id} is archived. Unarchive it first.`;
  }
  return null;
}

/** Statuses in which a thread is doing, or about to do, a turn. */
const WORKING = new Set(["pending", "starting", "active", "stopping"]);

/**
 * What the list shows beside a side chat: replying now, a reply nobody has
 * looked at, or neither. bb moves `latestAttentionAt` when the thread wants
 * the user, such as a finished reply, and `lastReadAt` when the thread is
 * viewed, in the side-chat panel too, so a reply that arrived after its tab
 * was closed stays unread.
 */
export function sideChatState(thread: {
  status: string;
  lastReadAt: number | null;
  latestAttentionAt: number | null;
}): "working" | "unread" | "read" {
  if (WORKING.has(thread.status)) return "working";
  if (thread.latestAttentionAt !== null && thread.latestAttentionAt > (thread.lastReadAt ?? 0)) {
    return "unread";
  }
  return "read";
}

/**
 * The replied-to text the side-chat plugin seeded, read back from bb's
 * fallback title (which bb may have shortened). Null for a side chat started
 * from the panel, which replies to nothing.
 */
export function anchorFrom(titleFallback: string | null | undefined): string | null {
  if (titleFallback == null || !titleFallback.startsWith(REPLY_SEED_PREFIX)) return null;
  const anchor = titleFallback.slice(REPLY_SEED_PREFIX.length).trim();
  return anchor === "" ? null : anchor;
}

/** A timeline row, as far as finding the first user message needs. */
export interface TimelineRowLike {
  kind: string;
  role?: string;
  text?: string;
  children?: readonly TimelineRowLike[] | null;
}

/** The label bb puts before a message another thread sent, as in `bb thread tell`. */
const SENDER_LABEL = /^\[bb message from [^\]\n]*\]\s*/;

/** The first message the user wrote in the side chat, in timeline order. */
export function firstUserText(rows: readonly TimelineRowLike[]): string | null {
  for (const row of rows) {
    if (row.kind === "conversation" && row.role === "user") {
      const text = (row.text ?? "").trim().replace(SENDER_LABEL, "");
      if (text !== "") return text;
    }
    if (row.kind === "turn" && row.children != null) {
      const nested = firstUserText(row.children);
      if (nested !== null) return nested;
    }
  }
  return null;
}

/**
 * One line, at most `max` characters, cut at a word boundary when one is near.
 * Used for titles and for the previews the header lists.
 */
export function oneLine(text: string, max = TITLE_MAX): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space >= max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * The promoted thread's title: what the user first asked in the side chat.
 * Side chats have no title of their own, so bb's default for a fork
 * ("(1) <source title>") has nothing to number.
 */
export function titleFor(firstUser: string): string {
  return oneLine(firstUser);
}

/**
 * The panel tabs on the main thread that show `sideChatId`: the side-chat
 * plugin's own, and this plugin's (pass its id as `ownPluginId`). Matched on
 * the tab's params rather than its id, whose encoding is the host's business.
 */
export function isTabFor(
  tab: { kind: string; pluginId?: string; paramsJson?: string | null },
  sideChatId: string,
  ownPluginId: string,
): boolean {
  if (tab.kind !== "plugin-panel") return false;
  if (tab.pluginId !== SIDE_CHAT_PLUGIN_ID && tab.pluginId !== ownPluginId) return false;
  if (typeof tab.paramsJson !== "string") return false;
  try {
    const params = JSON.parse(tab.paramsJson) as unknown;
    return (
      typeof params === "object" &&
      params !== null &&
      (params as { threadId?: unknown }).threadId === sideChatId
    );
  } catch {
    return false;
  }
}
