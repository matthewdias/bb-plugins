// Put a follow-up pill in a composer, wherever the composer can take it.
//
// SDK 0.6's `insert` defaults to the cursor and throws when the composer is not
// on screen — the side panel can be open while it is hidden. That throw would
// land in a click handler, where no error boundary sees it, and the click
// would do nothing. The end of the draft is always reachable, so it is the
// fallback; a composer that is gone altogether still throws from there.
import type { PluginComposerApi, PluginComposerMention } from "@get-bb/plugin-sdk/app";

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
