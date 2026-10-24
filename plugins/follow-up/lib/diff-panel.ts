// Where a thread's panel is pointed, as bb stores it.
//
// Pure, like page.ts: no plugin API and no browser. bb keeps each thread's
// panel (its tabs, which one shows, whether it is open) in the browser's
// storage, one entry a thread, and reads the entry again whenever the thread
// comes on screen. The plugin SDK cannot select bb's own diff tab: its
// `openFixedTab` reaches only the tabs a plugin declares. So the page writes
// the entry bb would have written had the reader pressed the tab themselves.
//
// bb promises none of this. The key, the shape and the tab's id are bb 0.45's,
// read from its app. Hence the one rule here: change an entry only when it
// reads as expected, and leave anything else exactly as it is. The thread
// still opens then, on whichever tab it had.

/** bb's storage key for one thread's panel. */
export function panelStateKey(threadId: string): string {
  return `bb.thread.fixedPanelTabsState-${encodeURIComponent(threadId.trim())}-1`;
}

/** The two tabs bb gives every thread in a git checkout, as bb names them. */
const INFO_TAB = { id: "thread-info:thread-info:none", kind: "thread-info" } as const;
const DIFF_TAB = { id: "git-diff:git-diff:none", kind: "git-diff" } as const;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * The entry to store so a thread's panel is open on bb's diff tab, given what
 * is stored now: null for a thread this browser has never opened. Answers
 * null itself when the stored entry is not one this knows how to change.
 * Everything else in the entry, the reader's other tabs included, is kept.
 */
export function panelOnDiff(stored: string | null, now: number): string | null {
  if (stored === null) {
    return JSON.stringify({ version: 1, secondary: { tabs: [INFO_TAB, DIFF_TAB], activeTabId: DIFF_TAB.id, isOpen: true }, lastUsedAt: now });
  }
  let state: Record<string, unknown> | null;
  try {
    state = record(JSON.parse(stored));
  } catch {
    return null;
  }
  const secondary = record(state?.secondary);
  if (state === null || state.version !== 1 || secondary === null || !Array.isArray(secondary.tabs)) return null;
  // bb drops an active tab that is not among the entry's tabs.
  const tabs = secondary.tabs.some((tab) => record(tab)?.id === DIFF_TAB.id) ? secondary.tabs : [...secondary.tabs, DIFF_TAB];
  return JSON.stringify({ ...state, secondary: { ...secondary, tabs, activeTabId: DIFF_TAB.id, isOpen: true }, lastUsedAt: now });
}
