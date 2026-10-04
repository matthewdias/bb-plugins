// The follow-ups badge: a ring showing how much of a thread's follow-up list
// has been closed.
//
// Unlike the pull-request badge, this one reads another plugin's state, and it
// has two ways to. The live one is the complications registry: Follow Up
// publishes each thread's progress there the moment it changes, because only
// Follow Up hears its own change signal. The fallback is its batch, versioned
// `getFollowUpCountsV1` contract, polled every 30s by ./follow-up-counts, for a
// Follow Up that predates the registry. Either way, Follow Up absent, disabled
// or answering in a shape this code does not read ends the same: no ring,
// nothing else affected.
import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { ComplicationValue } from "../lib/complications";
import { useComplication } from "./complication";
import {
  getCounts,
  requestCounts,
  subscribeCounts,
  type Counts,
} from "./follow-up-counts";
import type { BadgeProps } from "./components";

/** Follow Up's progress complication — `FOLLOW_UP_PROGRESS` over there. */
const FOLLOW_UP_PROGRESS = "follow-up/progress";

function useFollowUpCounts(threadId: string, revision: number, enabled: boolean): Counts | null {
  // `revision` is the host's focus signal, shared by every row, so all of them
  // ask again on the same tick and the batch collects them into one request.
  // It is no longer the only refresh — the store polls the visible rows every
  // 30s — but it is still the one that fires the instant you come back, ahead
  // of the next tick. None of it runs while the registry is answering: a row
  // that does not subscribe is a row the poll does not ask about.
  useEffect(() => {
    if (enabled) requestCounts(threadId, revision);
  }, [threadId, revision, enabled]);

  // Memoised because React re-subscribes whenever this identity changes, and
  // these rows re-render constantly.
  const subscribe = useCallback(
    (listener: () => void) =>
      enabled ? subscribeCounts(threadId, listener) : () => undefined,
    [threadId, enabled],
  );
  const read = useCallback(() => (enabled ? getCounts(threadId) : null), [threadId, enabled]);
  return useSyncExternalStore(subscribe, read, read);
}

/** What the ring draws, whichever path it came from. */
interface Ring {
  fraction: number;
  label: string;
  complete: boolean;
  /** Still open, when there is any. */
  open: string | undefined;
}

/**
 * A gauge drawn from the published value alone — nothing here knows what a
 * follow-up is, which is the point: the provider owns the meaning.
 */
function ringFromValue(value: ComplicationValue | null | undefined): Ring | null {
  if (value == null || value.fraction === undefined) return null;
  return {
    fraction: value.fraction,
    label: value.label,
    complete: value.fraction >= 1,
    open: value.text,
  };
}

function ringFromCounts(counts: Counts | null): Ring | null {
  if (counts === null) return null;
  const total = counts.open + counts.done;
  // A thread that never recorded one has nothing to say about follow-ups.
  if (total === 0) return null;
  const complete = counts.open === 0;
  return {
    fraction: counts.done / total,
    label: complete
      ? `All ${total} follow-up${total === 1 ? "" : "s"} done`
      : `${counts.done} of ${total} follow-ups done`,
    complete,
    open: counts.open > 0 ? String(counts.open) : undefined,
  };
}

const SIZE = 14;
const RADIUS = 5;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function FollowUpsBadge({ threadId, values, revision }: BadgeProps) {
  const live = useComplication(FOLLOW_UP_PROGRESS, threadId);
  const counts = useFollowUpCounts(threadId, revision, !live.provided);
  const ring = live.provided ? ringFromValue(live.value) : ringFromCounts(counts);
  if (ring === null) return null;
  if (ring.complete && values.followUps_hideWhenComplete === true) return null;

  const { fraction, label, complete } = ring;
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
      {values.followUps_showOpenCount === true && ring.open !== undefined ? (
        <span>{ring.open}</span>
      ) : null}
    </span>
  );
}
