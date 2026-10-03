// Put a follow-up pill in a composer, wherever the composer can take it, and
// take one back out.
//
// SDK 0.6's `insert` defaults to the cursor and throws when the composer is not
// on screen — the side panel can be open while it is hidden. That throw would
// land in a click handler, where no error boundary sees it, and the click
// would do nothing. The end of the draft is always reachable, so it is the
// fallback; a composer that is gone altogether still throws from there.
import type { PluginComposerApi, PluginComposerMention } from "@get-bb/plugin-sdk/app";
import { isFollowUpPill, withoutMentions } from "../lib/followups.ts";

/**
 * Pill text. Follow-up text runs to 240 characters, which would render as an
 * unusable pill, so the label is truncated. Display only: whether a row is in
 * the composer is read from the pill's id, not from this text.
 */
const PILL_LABEL_MAX = 48;
export function pillLabel(text: string): string {
  return text.length <= PILL_LABEL_MAX
    ? text
    : `${text.slice(0, PILL_LABEL_MAX - 1).trimEnd()}\u2026`;
}

export function insertPill(
  composer: Pick<PluginComposerApi, "insert">,
  pill: PluginComposerMention,
): void {
  try {
    composer.insert(pill);
  } catch {
    composer.insert(pill, { at: "end" });
  }
}

/**
 * Take a row's pill out of the draft, after you marked the row done or
 * dismissed it. Sending it then would hand the agent "This follow-up no longer
 * exists." Only ever called for your own action: an agent finishing a row, or
 * the CLI, never edits a draft you are writing.
 *
 * Swallows a throw: it runs after the change already succeeded, and a draft
 * that has gone away has no pill left to remove.
 */
export function stripPill(
  composer: Pick<PluginComposerApi, "replace">,
  threadId: string,
  rowId: string,
): void {
  try {
    composer.replace((current) =>
      withoutMentions(current, (mention) => isFollowUpPill(mention, threadId, rowId)),
    );
  } catch {
    // Nothing to undo; see above.
  }
}
