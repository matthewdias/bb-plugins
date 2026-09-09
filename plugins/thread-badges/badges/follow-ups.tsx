// The follow-ups badge: a ring showing how much of a thread's follow-up list
// has been closed.
//
// Unlike the pull-request badge, this one reads another plugin's state — but
// through a declared contract rather than a borrowed call. Follow-ups'
// `getFollowUpCountsV1` is batch and versioned, so the whole sidebar costs one
// request; ./follow-up-counts owns that request, its 30s refresh, and the
// staleness this file used to worry about. Follow-ups absent, disabled, or
// answering a version this code does not read all end the same way: no ring,
// nothing else affected.
import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  getCounts,
  requestCounts,
  subscribeCounts,
  type Counts,
} from "./follow-up-counts";
import type { BadgeProps } from "./components";

function useFollowUpCounts(threadId: string, revision: number): Counts | null {
  // `revision` is the host's focus signal, shared by every row, so all of them
  // ask again on the same tick and the batch collects them into one request.
  // It is no longer the only refresh — the store polls the visible rows every
  // 30s — but it is still the one that fires the instant you come back, ahead
  // of the next tick.
  useEffect(() => {
    requestCounts(threadId, revision);
  }, [threadId, revision]);

  // Memoised because React re-subscribes whenever this identity changes, and
  // these rows re-render constantly.
  const subscribe = useCallback(
    (listener: () => void) => subscribeCounts(threadId, listener),
    [threadId],
  );
  const read = useCallback(() => getCounts(threadId), [threadId]);
  return useSyncExternalStore(subscribe, read, read);
}

const SIZE = 14;
const RADIUS = 5;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function FollowUpsBadge({ threadId, values, revision }: BadgeProps) {
  const counts = useFollowUpCounts(threadId, revision);
  if (counts === null) return null;
  const total = counts.open + counts.done;
  // A thread that never recorded one has nothing to say about follow-ups.
  if (total === 0) return null;
  const complete = counts.open === 0;
  if (complete && values.followUps_hideWhenComplete === true) return null;

  const fraction = counts.done / total;
  const label = complete
    ? `All ${total} follow-up${total === 1 ? "" : "s"} done`
    : `${counts.done} of ${total} follow-ups done`;
  // Green only when the list is actually clear, matching the pull-request
  // badge; otherwise the ring stays quiet chrome.
  const arc = complete ? "light-dark(#1a7f37, #3fb950)" : "var(--muted-foreground)";

  return (
    <span
      aria-label={label}
      style={{
        alignItems: "center",
        color: "var(--muted-foreground)",
        display: "inline-flex",
        fontSize: 11,
        gap: 2,
        lineHeight: 1,
      }}
      title={label}
    >
      <svg
        aria-hidden
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        width={SIZE}
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          fill="none"
          r={RADIUS}
          stroke="var(--border)"
          strokeWidth={2}
        />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          fill="none"
          r={RADIUS}
          stroke={arc}
          strokeDasharray={`${fraction * CIRCUMFERENCE} ${CIRCUMFERENCE}`}
          // Butt, not round: at 27 of 28 a rounded cap closes the last gap and
          // the ring reads as finished when it is not.
          strokeLinecap="butt"
          strokeWidth={2}
          // Start the arc at twelve o'clock rather than three.
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        />
      </svg>
      {values.followUps_showOpenCount === true && counts.open > 0 ? (
        <span>{counts.open}</span>
      ) : null}
    </span>
  );
}
