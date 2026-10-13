import type { ThreadActionEntry } from "../lib/row-actions.ts";

/** bb's row: a container carrying `group/thread-row`, the anchor inside it. */
export function bbRow(threadId: string): { row: HTMLElement; anchor: HTMLAnchorElement; glyph: HTMLElement } {
  const row = document.createElement("div");
  row.className = "group/thread-row flex w-full";
  const glyph = document.createElement("span");
  const anchor = document.createElement("a");
  anchor.href = `/threads/${threadId}`;
  anchor.setAttribute("data-sidebar-thread-id", threadId);
  anchor.textContent = threadId;
  row.append(glyph, anchor);
  return { row, anchor, glyph };
}

export interface FakeThread {
  isUnread: boolean;
  isPinned: boolean;
  isArchived: boolean;
}

/**
 * bb's evaluation of thread action keys for one thread, near enough: its
 * labels and icons, a key nobody registered left out, and `ran` in place of
 * what running each does. `acme/*` stands for another plugin's actions.
 */
export function evaluate(
  keys: readonly string[],
  thread: FakeThread,
  ran: (key: string) => void,
): ThreadActionEntry[] {
  const actions: Record<string, Omit<ThreadActionEntry["action"], "run">> = {
    "bb--core/split": { label: "Open in split", icon: "Columns2" },
    "bb--core/copyLink": { label: "Copy thread link", icon: "Copy" },
    "bb--core/read": thread.isUnread ? { label: "Mark read", icon: "MailOpen" } : { label: "Mark unread", icon: "Mail" },
    "bb--core/pin": thread.isPinned ? { label: "Unpin", icon: "PinOff" } : { label: "Pin", icon: "Pin" },
    "bb--core/rename": { label: "Rename", icon: "Edit" },
    "bb--core/archive": { label: "Archive", icon: "Archive" },
    "thread-list/move": { label: "Move to section", icon: "SectionMove", choices: { items: [] } },
    "acme/deploy": { label: "Deploy", icon: "Rocket", variant: "destructive" },
    "acme/locked": { label: "Locked", icon: "Lock", disabled: true },
  };
  return keys.flatMap((key) => {
    const action = actions[key];
    return action === undefined ? [] : [{ key, action: { ...action, run: () => ran(key) } }];
  });
}
