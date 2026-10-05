// The follow-up progress complication: how much of a thread's list is closed.
//
// Follow Up is the provider because Follow Up is the only plugin that hears
// its own `followups-changed` signal. Thread Badges used to draw this ring by
// polling `getFollowUpCountsV1` every 30 seconds, which is why recording a
// follow-up did not move the ring; publishing the value from here is what
// makes it move at once. See src/complication-publisher.tsx.
import type {
  ComplicationProviderRegistration,
  ComplicationSubject,
  ComplicationValue,
} from "./complications.ts";

/** The complication's id in the registry: `<pluginId>/<name>`. */
export const FOLLOW_UP_PROGRESS = "follow-up/progress";

/**
 * How Follow Up registers. Here rather than in the publisher so a test can
 * prove the registry accepts it: a registration the registry refuses throws
 * inside an effect, where all anyone sees is a ring that never goes live.
 */
export function progressRegistration(
  ask: (threadIds: string[]) => void,
): ComplicationProviderRegistration {
  return {
    id: FOLLOW_UP_PROGRESS,
    name: "Follow-up progress",
    description: "How much of a thread's follow-up list is closed.",
    subjects: ["thread"],
    sample: progressValue({ open: 1, done: 3 }) ?? undefined,
    onWanted: (subjects: readonly ComplicationSubject[]) =>
      ask(subjects.filter((subject) => subject.kind === "thread").map((subject) => subject.id)),
  };
}

/**
 * Counts to a gauge, or `null` for a thread that never recorded a follow-up —
 * which has nothing to say, and must not draw an empty ring as if it did.
 */
export function progressValue(counts: { open: number; done: number }): ComplicationValue | null {
  const total = counts.open + counts.done;
  if (total <= 0) return null;
  const complete = counts.open === 0;
  return {
    icon: "TextWrap",
    label: complete
      ? `All ${total} follow-up${total === 1 ? "" : "s"} done`
      : `${counts.done} of ${total} follow-ups done`,
    // Green only when the list is actually clear; otherwise quiet chrome.
    tone: complete ? "success" : "default",
    fraction: counts.done / total,
    // What is still open, for a surface with room to say it.
    ...(counts.open > 0 ? { text: String(counts.open) } : {}),
  };
}
