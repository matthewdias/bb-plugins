// The Threads tab's contents: its label, and what the thread list would tell
// you if it were collapsed.
import { useMemo } from "react";
import { experimental_useSidebarThreads } from "@get-bb/plugin-sdk/app";
import { groupThreads, threadIdFromPath } from "../lib/tabs-model.ts";

/**
 * "Threads", and, while another tab is in view, the thread it will return to,
 * as a browser tab shows its page's title. Drawn only with names showing.
 */
export function ThreadsLabel({ active, savedPath }: { active: boolean; savedPath: string | undefined }) {
  const { threads } = experimental_useSidebarThreads();
  const threadId = threadIdFromPath(savedPath);
  const title =
    active || threadId === null ? null : (threads.find((t) => t.id === threadId)?.displayTitle ?? null);
  return (
    <span className="bb-tab-nav-label bb-tab-nav-threads-label">
      <span className="bb-tab-nav-name">Threads</span>
      {title !== null && <span className="bb-tab-nav-sublabel">{title}</span>}
    </span>
  );
}

/**
 * What the thread list would tell you if you could see it, as counts: how
 * many threads are waiting on you (the loud one), running, and finished since
 * you last looked. The marks are the thread switcher's, so the tab and its
 * card read the same.
 */
export function ThreadsStatus({ compact = false }: { compact?: boolean }) {
  const { threads } = experimental_useSidebarThreads();
  const counts = useMemo(() => {
    const groups = groupThreads(threads, []);
    return {
      waiting: groups.needsYou.length,
      running: groups.running.length,
      finished: groups.finished.length,
      failed: groups.finished.some((thread) => thread.indicator === "unread-error"),
    };
  }, [threads]);
  const { waiting, running, finished, failed } = counts;
  const parts = [
    waiting > 0 ? `${waiting} ${waiting === 1 ? "needs" : "need"} you` : null,
    running > 0 ? `${running} running` : null,
    finished > 0 ? `${finished} finished` : null,
  ].filter((part): part is string => part !== null);
  if (parts.length === 0) return null;
  const label = parts.join(", ");
  // On the narrow rail there is room for one mark on the icon's corner: how
  // many need you, or a running dot, as bb's Rail marks its icons.
  if (compact) {
    return (
      <span className="bb-tab-nav-status" data-compact="" role="status" aria-label={label}>
        {waiting > 0 ? (
          <span className="bb-tab-nav-attention">{waiting > 9 ? "9+" : waiting}</span>
        ) : (
          <span className="bb-tab-nav-mark" data-kind={running > 0 ? "running" : failed ? "error" : "done"} aria-hidden="true" />
        )}
      </span>
    );
  }
  return (
    <span className="bb-tab-nav-status" role="status" aria-label={label} title={label}>
      {waiting > 0 && <span className="bb-tab-nav-attention">{waiting}</span>}
      {running > 0 && (
        <span className="bb-tab-nav-count">
          <span className="bb-tab-nav-mark" data-kind="running" aria-hidden="true" />
          {running}
        </span>
      )}
      {finished > 0 && (
        <span className="bb-tab-nav-count">
          <span className="bb-tab-nav-mark" data-kind={failed ? "error" : "done"} aria-hidden="true" />
          {finished}
        </span>
      )}
    </span>
  );
}
