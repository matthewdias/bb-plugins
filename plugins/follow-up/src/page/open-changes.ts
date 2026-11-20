// Sending the reader to a pull request's changes: its thread, with bb's own
// diff view showing them. See lib/diff-panel.ts for what this leans on.
import { panelOnDiff, panelStateKey } from "../../lib/diff-panel.ts";

/** bb's own breakpoint: under it a thread's panel is a drawer, shut on arrival. */
const DRAWER_VIEWPORT = "(max-width: 767px)";
/** How long to look for the thread's panel control after going there. */
export const ARRIVAL_MS = 4000;
/**
 * How long the control has been there before it is pressed. A thread's view
 * shuts its drawer as it settles in, which would undo a press made at once.
 */
export const SETTLE_MS = 150;

/** Point a thread's panel at the diff tab, where bb reads it on arrival. */
export function pointPanelAtDiff(threadId: string): void {
  try {
    const key = panelStateKey(threadId);
    const next = panelOnDiff(window.localStorage.getItem(key), Date.now());
    if (next !== null) window.localStorage.setItem(key, next);
  } catch {
    // Storage is off or full: the thread opens on whichever tab it had.
  }
}

/**
 * On a narrow screen the panel is a drawer that starts shut whatever is
 * stored, so press bb's own control for it once the thread is on screen.
 * Found by its label; without one to find, nothing is pressed.
 */
export function showPanelOnArrival(threadId: string): void {
  if (window.matchMedia?.(DRAWER_VIEWPORT).matches !== true) return;
  const control = (does: "Show" | "Hide") => document.querySelector<HTMLButtonElement>(`button[aria-label^="${does} right panel"]`);
  const there = () => window.location.pathname.split("/").includes(threadId);

  const observer = new MutationObserver(() => look());
  const deadline = setTimeout(() => observer.disconnect(), ARRIVAL_MS);
  const stop = () => {
    observer.disconnect();
    clearTimeout(deadline);
  };
  const look = () => {
    if (!there()) return;
    // Open already: the reader got there first.
    if (control("Hide") !== null) return stop();
    if (control("Show") === null) return;
    stop();
    setTimeout(() => {
      if (there()) control("Show")?.click();
    }, SETTLE_MS);
  };
  observer.observe(document.body, { childList: true, subtree: true });
  look();
}

/** Go to a thread with bb's diff view showing its changes. */
export function openChanges(threadId: string, toThread: (threadId: string) => void): void {
  // Before going: bb reads the entry as the thread comes on screen.
  pointPanelAtDiff(threadId);
  toThread(threadId);
  showPanelOnArrival(threadId);
}
