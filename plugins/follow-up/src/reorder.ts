// Putting a row in the composer, and the reorder that goes with it.
//
// Shared by the banner and the + menu's picker, so both insert a row the same
// way: a pill at the cursor, and the row moved to the top of the list.
import type { PluginComposerApi } from "@get-bb/plugin-sdk/app";
import { followUpMentionId, MENTION_PROVIDER, type FollowUp } from "../lib/followups.ts";
import { insertPill, pillLabel } from "./insert-pill.ts";
import type { FollowUpRpc } from "./rpc.ts";
import { peekFollowUpState, setRows } from "./store.ts";

/**
 * Store a new order for a thread's open rows. Optimistic first: the rows are
 * already where the user put them, so waiting for the server would drag them
 * back for a frame. The server's answer then replaces the guess, and a failed
 * call refetches rather than leaving the guess standing as the truth.
 */
export function commitOrder(
  rpc: FollowUpRpc,
  threadId: string,
  orderedIds: string[],
  movedId: string,
): void {
  const { rows, done } = peekFollowUpState(threadId);
  const byId = new Map(rows.map((entry) => [entry.id, entry]));
  setRows(
    threadId,
    orderedIds
      .map((id) => byId.get(id))
      .filter((entry): entry is FollowUp => entry !== undefined),
    done,
  );
  void (async () => {
    try {
      const result = await rpc.call("followups_reorder", { threadId, orderedIds, movedId });
      setRows(threadId, result.followUps, result.done);
    } catch {
      try {
        const result = await rpc.call("followups_list", { threadId });
        setRows(threadId, result.followUps, result.done);
      } catch {
        // Keep the last good snapshot; the next change signal refetches.
      }
    }
  })();
}

/**
 * Put a row's pill in the composer and move the row to the top.
 *
 * A mention pill, not plain text: it survives editing, never clobbers a draft
 * the way replacing its text would, and resolves the whole record — including
 * `detail` — into agent context at send time. Sending is also what marks the
 * row sent, so inserting and then deleting the pill costs nothing.
 *
 * Inserting is a statement that this is the one being worked on next, which is
 * what the top of the list means — so it is a real reorder, through the same
 * path a drag takes, not a display-only sort. A sort would have diverged from
 * the stored rank, and the next drag would have committed that divergence as
 * permanent rank without anyone asking for it.
 */
export function insertRow(
  composer: Pick<PluginComposerApi, "insert" | "focus">,
  rpc: FollowUpRpc,
  threadId: string,
  row: FollowUp,
): void {
  insertPill(composer, {
    provider: MENTION_PROVIDER,
    id: followUpMentionId(threadId, row.id),
    label: pillLabel(row.text),
  });
  composer.focus();
  const { rows } = peekFollowUpState(threadId);
  if (rows.length > 1 && rows[0]?.id !== row.id) {
    commitOrder(
      rpc,
      threadId,
      [row.id, ...rows.filter((entry) => entry.id !== row.id).map((entry) => entry.id)],
      row.id,
    );
  }
}
