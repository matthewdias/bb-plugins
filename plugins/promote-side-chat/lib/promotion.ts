// What makes a thread a side chat, whether one may be promoted, and what the
// promoted thread is called. Pure, so the policy is tested without a host.
//
// A side chat is bb's built-in side-chat plugin's hidden fork of a thread,
// owned by that thread's lifecycle: archiving the main thread archives it, and
// ownership can never be changed. Promotion therefore forks the side chat
// again, as a visible thread with no owner, rather than un-hiding it.

/** The built-in plugin that creates side chats. */
export const SIDE_CHAT_PLUGIN_ID = "side-chat";

/** Realtime channel: a thread's set of side chats changed. */
export const SIDE_CHATS_CHANGED = "side-chats-changed";

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
 * The side-chat panel tabs on the main thread that show `sideChatId`. Matched
 * on the tab's params rather than its id, whose encoding is the side-chat
 * plugin's business.
 */
export function isTabFor(
  tab: { kind: string; pluginId?: string; paramsJson?: string | null },
  sideChatId: string,
): boolean {
  if (tab.kind !== "plugin-panel" || tab.pluginId !== SIDE_CHAT_PLUGIN_ID) return false;
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
