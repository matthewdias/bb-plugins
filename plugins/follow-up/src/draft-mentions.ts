// The composer's @-mentions, kept where the record button can reach them.
//
// `ComposerView.draft` carries only text, so the one route to a note's mentions
// is `richText.onDraftChange` — a push, not a pull, and debounced. Hence a
// cache: the observation arrives while you type, the read happens when you
// click, and those are different moments.
//
// Module scope rather than React state for the same reason `rpc.ts` is: the
// observer is registered on the composer customization, not inside a mounted
// component, so there is no shared tree to hold it.
import type { DraftMention } from "../lib/followups.ts";

/** Latest structured draft per thread. One entry per composer in play. */
const latest = new Map<string, readonly DraftMention[]>();

export function rememberDraftMentions(
  threadId: string | null,
  mentions: readonly DraftMention[],
): void {
  if (threadId === null) return;
  // Dropped rather than stored empty: the map is only consulted for a draft
  // that has mentions, and keeping empties would grow it for every thread ever
  // typed in.
  if (mentions.length === 0) {
    latest.delete(threadId);
    return;
  }
  latest.set(threadId, mentions);
}

/**
 * What the composer last reported for this thread.
 *
 * Debounced upstream, so a mention added in the last few hundred milliseconds
 * before the click may be missing. That is the failure this design accepts: it
 * loses an anchor it could have had, which leaves the row exactly as it is
 * today. It never invents one.
 */
export function peekDraftMentions(threadId: string | null): readonly DraftMention[] {
  if (threadId === null) return [];
  return latest.get(threadId) ?? [];
}

/** The draft is gone, so its mentions are too. */
export function forgetDraftMentions(threadId: string | null): void {
  if (threadId !== null) latest.delete(threadId);
}
