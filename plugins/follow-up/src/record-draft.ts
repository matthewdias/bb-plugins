// "File what you have typed": record the draft as a follow-up, then clear it.
//
// Two ways in, one flow: the "Record as follow-up" row in the menu beside the
// send button, and the "Follow-ups: record the draft" composer command. The
// send menu is bb's place for alternatives to sending right away, which is what
// this is, and unlike the action-row button it replaced, it is there on phones
// (long-press Send). bb hides it while the composer cannot submit — while a
// question or plan approval waits on you, say — and the command still works
// then, because it runs in whichever composer holds the caret.
//
// History worth keeping:
// - This is not a + menu row. The + menu is for attaching: it brings something
//   into the draft. This does the opposite — it reads the draft, files it, and
//   clears it.
// - It used to be an action-row button that locked the composer across the
//   call, so nothing typed during it could be cleared with it. Neither a menu
//   row nor a command has a slot for a lock to belong to, so there is no lock:
//   on success the draft is cleared, including anything typed while the call
//   was out. That was a decision, not an oversight.
// - A refusal (a duplicate, a wording dismissed earlier, a full list) used to
//   be written into the button. Without one it is a toast, from bb's own
//   toaster: the plugin build maps `sonner` onto the host's.
import { toast } from "sonner";
import type {
  ComposerSendMenuItem,
  ExperimentalComposerCommandRegistration,
  PluginAppComposer,
  PluginComposerApi,
} from "@get-bb/plugin-sdk/app";
import { fileMentionOf, selectionToFollowUp } from "../lib/followups.ts";
import { getRpc, type FollowUpRpc } from "./rpc.ts";
import { threadIdFromScope } from "./scope.ts";

/** What recording the draft came to. The first four are the server's answer. */
export type RecordOutcome =
  | "added"
  | "duplicate"
  | "dismissed"
  | "filed"
  | "full"
  | "empty"
  | "failed"
  | "no-thread";

/** Why a recording was refused, for the toast that says so. */
export const REFUSAL_DETAIL: Record<Exclude<RecordOutcome, "added">, string> = {
  duplicate: "Another follow-up on this thread already says that.",
  dismissed: "You dismissed that wording earlier, so it cannot come back.",
  filed: "That was filed elsewhere from this thread, so it is tracked there already.",
  full: "This thread has hit the follow-up cap. Clear some first.",
  empty: "Nothing to record: the draft has no text.",
  failed: "The follow-up was not recorded. Try again.",
  "no-thread": "Follow-ups belong to a thread. Open one to record the draft.",
};

/**
 * Record the composer's draft as a follow-up on its thread, and clear the draft
 * if it was recorded. A refused draft is left as it was, so it can be edited.
 *
 * The draft is read once, at the start: the row is what was there when you
 * asked, and a file you @-mentioned in it becomes the row's anchor.
 */
export async function recordDraft(
  composer: Pick<PluginComposerApi, "scope" | "draft" | "replace">,
  rpc: FollowUpRpc | null,
): Promise<RecordOutcome> {
  const threadId = threadIdFromScope(composer.scope);
  if (threadId === null) return "no-thread";
  const draft = composer.draft;
  const captured = selectionToFollowUp(draft.text);
  if (captured === null) return "empty";
  if (rpc === null) return "failed";
  const anchor = fileMentionOf(draft.mentions);
  let outcome: RecordOutcome;
  try {
    const result = await rpc.call("followups_add", {
      threadId,
      text: captured.text,
      ...(captured.detail === undefined ? {} : { detail: captured.detail }),
      ...(anchor === null ? {} : { file: anchor }),
    });
    outcome = result.outcome;
  } catch {
    outcome = "failed";
  }
  // Omitting `attachments` keeps them: they were never part of the row.
  if (outcome === "added") composer.replace({ text: "", mentions: [] });
  return outcome;
}

/** Say how it went: a success toast, or the reason it was refused. */
export function reportRecorded(outcome: RecordOutcome): void {
  if (outcome === "added") {
    toast.success("Recorded as a follow-up");
    return;
  }
  toast.error(REFUSAL_DETAIL[outcome]);
}

/** Both entry points: record, then report. */
export async function recordDraftAndReport(
  composer: Pick<PluginComposerApi, "scope" | "draft" | "replace">,
  rpc: FollowUpRpc | null,
): Promise<RecordOutcome> {
  const outcome = await recordDraft(composer, rpc);
  reportRecorded(outcome);
  return outcome;
}

/** The row in the menu beside the send button. */
export const recordSendMenuItem: ComposerSendMenuItem = {
  id: "record-as-follow-up",
  label: "Record as follow-up",
  icon: "TextWrap",
  description: "Record the draft as a follow-up on this thread, and clear the composer",
  // A new-thread composer has no thread to record onto.
  disabled: (composer) => threadIdFromScope(composer.scope) === null,
  run: async ({ composer }) => {
    await recordDraftAndReport(composer, getRpc());
  },
};

/** The same, from the keyboard: bound under Settings → Keyboard, never by default. */
export const recordCommand: ExperimentalComposerCommandRegistration = {
  id: "record-draft",
  title: "Follow-ups: record the draft",
  run: async ({ composer }) => {
    await recordDraftAndReport(composer, getRpc());
  },
};

/**
 * Register the command if this bb has composer commands. The API is
 * experimental: calling a method a later bb removed would throw out of the
 * app's setup and take every surface of this plugin down with it, so a missing
 * one costs only the command, and the send-menu row still records.
 */
export function registerRecordCommand(
  composer: Partial<Pick<PluginAppComposer, "experimental_registerCommand">>,
): boolean {
  if (typeof composer.experimental_registerCommand !== "function") return false;
  composer.experimental_registerCommand(recordCommand);
  return true;
}
