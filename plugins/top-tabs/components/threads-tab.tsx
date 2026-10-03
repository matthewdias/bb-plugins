// The Threads tab's contents: its label, and what the hidden thread list
// would tell you if you could see it.
import { useMemo } from "react";
import { experimental_useSidebarThreads } from "@get-bb/plugin-sdk/app";
import { groupThreads, threadIdFromPath } from "../lib/tabs-model.ts";

/**
 * "Threads", plus the thread it will return to while another tab is in view —
 * the strip's answer to a browser tab's page title.
 */
export function ThreadsLabel({ active, savedPath }: { active: boolean; savedPath: string | undefined }) {
  const { threads } = experimental_useSidebarThreads();
  const threadId = active ? null : threadIdFromPath(savedPath);
  const title =
    threadId === null ? null : (threads.find((t) => t.id === threadId)?.displayTitle ?? null);
  return (
    <span className="bb-top-tab-label bb-top-tab-threads-label">
      <span className="bb-top-tab-name">Threads</span>
      {title !== null && <span className="bb-top-tab-sublabel">{title}</span>}
    </span>
  );
}

/**
 * What the thread list would tell you if you could see it, as counts: how
 * many threads are waiting on you (the loud one), running, and finished since
 * you last looked. The marks are the thread switcher's, so the tab and its
 * card read the same.
 */
export function ThreadsStatus() {
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
  return (
    <span className="bb-top-tab-status" role="status" aria-label={label} title={label}>
      {waiting > 0 && <span className="bb-top-tab-attention">{waiting}</span>}
      {running > 0 && (
        <span className="bb-top-tab-count">
          <span className="bb-top-tabs-mark" data-kind="running" aria-hidden="true" />
          {running}
        </span>
      )}
      {finished > 0 && (
        <span className="bb-top-tab-count">
          <span className="bb-top-tabs-mark" data-kind={failed ? "error" : "done"} aria-hidden="true" />
          {finished}
        </span>
      )}
    </span>
  );
}
