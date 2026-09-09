// "File what you have typed" — a composer inline action, not a + menu row.
//
// The + menu is for attaching: a host-rendered row that opens a picker and
// brings something in, the way agent-checklists attaches a checklist. This
// verb does the opposite — it reads the draft, files it, and clears it — and
// two things follow from that which a menu row cannot do.
//
// One: it must lock the composer while it runs. `setInputLock` releases when
// the calling slot unmounts, and a menu row is not a slot — it has no lifetime
// to hang a lock on. Without the lock there is a real race: you click, keep
// typing, and `clear()` takes the new keystrokes with it.
//
// Two: it can be refused — as a duplicate, as a wording dismissed earlier, or
// by the cap — and a menu row has no pixels to say so in. As a + item this
// failure was silent: the draft simply stayed put and nothing explained why.
import { useCallback, useEffect, useState } from "react";
import { useComposer, useComposerView, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import { fileMentionOf, selectionToFollowUp } from "../lib/followups.ts";
import { threadIdFromScope } from "./scope.ts";
import { forgetDraftMentions, peekDraftMentions } from "./draft-mentions.ts";
import { rememberRpc } from "./rpc.ts";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

/** Short enough for the action row; the tooltip carries the long form. */
const REFUSAL: Record<string, string> = {
  duplicate: "Already recorded",
  dismissed: "Dismissed earlier",
  full: "List is full",
  empty: "Nothing to record",
  failed: "Could not record",
};

const REFUSAL_DETAIL: Record<string, string> = {
  duplicate: "Another follow-up on this thread already says that.",
  dismissed: "You dismissed that wording earlier, so it cannot come back.",
  full: "This thread has hit the follow-up cap. Clear some first.",
  empty: "The draft is only whitespace, so there is no follow-up to record.",
  failed: "The follow-up was not recorded. Try again.",
};

/**
 * Two buttons, one behaviour, one difference: whether a fork is asked to
 * describe the note more fully once it is filed.
 *
 * Expansion is a click, never a default. Everything this plugin refused to
 * build was inference nobody asked for; an action you press is neither
 * automatic nor a model you did not choose, and you can read the result and
 * delete it. That is the whole distinction.
 */
export function RecordDraftAction() {
  const view = useComposerView();
  const composer = useComposer();
  const rpc = useRpc<typeof rpcContract>();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const threadId = threadIdFromScope(view.scope);
  const draft = view.draft.text;

  useEffect(() => {
    rememberRpc(rpc);
  }, [rpc]);

  // A refusal is about a particular wording, so it stops applying the moment
  // that wording changes. Editing the text is the way out of the refusal.
  useEffect(() => {
    setProblem(null);
  }, [draft]);

  const record = useCallback(async () => {
    if (threadId === null) return;
    const captured = selectionToFollowUp(draft);
    if (captured === null) {
      setProblem("empty");
      return;
    }
    setBusy(true);
    // A file you @-mentioned while writing the note is the anchor the note is
    // about — visible on screen, and until now invisible to the row it became.
    // Read here rather than watched in state: the observation is debounced, so
    // the freshest reading is the one taken at the click.
    const anchor = fileMentionOf(peekDraftMentions(threadId));
    // Held across the whole call: the draft is about to be cleared, and
    // anything typed in between would be cleared with it.
    composer.setInputLock(true);
    let outcome: string;
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
    } finally {
      composer.setInputLock(false);
      setBusy(false);
    }
    // Clear after the lock is released, so `clear` is never asked to write to
    // an input this plugin has locked. Nothing can have been typed into the
    // gap: it closes in the same tick.
    if (outcome === "added") {
      composer.clear();
      // The draft these belonged to no longer exists. Left behind, they would
      // anchor the *next* note typed in this thread to a file it never named.
      forgetDraftMentions(threadId);
      return;
    }
    setProblem(outcome);
  }, [composer, draft, rpc, threadId]);

  // Nothing to file, so no button — an affordance that appears when it applies
  // beats a permanently visible row greyed out by `disabled`, which is all the
  // + menu could offer.
  if (threadId === null || view.draft.isEmpty) return null;

  const refusal = problem === null ? null : (REFUSAL[problem] ?? REFUSAL.failed);
  const detail = problem === null ? null : (REFUSAL_DETAIL[problem] ?? REFUSAL_DETAIL.failed);

  return (
    <span
      // The action row is shared with the host's controls, so the tooltip has
      // to name what it makes, not just what it does to the draft — "file what
      // you have typed" never says the word follow-up anywhere.
      title={detail ?? "Record the draft as a follow-up, and clear the composer"}
      className="inline-flex"
    >
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 px-2"
        disabled={busy}
        // Same reason as the pill: taking focus off the composer retracts the
        // keyboard on mobile and minimises the composer.
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          event.stopPropagation();
          void record();
        }}
        aria-label={
          refusal === null
            ? "Record the draft as a follow-up, and clear the composer"
            : `Not recorded. ${detail ?? ""}`
        }
      >
        {/* `Brain` for the expanding one: it is the only action here that
            starts an agent, and that is the difference worth depicting. The
            plain one keeps the plugin's own glyph. */}
        {/* The plugin's own glyph, the same one on the banner's summary line,
            the message action and the panel tab. Whose button this is matters
            more here than depicting the motion: the action row is shared with
            the host's controls and other plugins, so an icon nobody can trace
            back to a plugin is just an unexplained button. */}
        <Icon
          name={busy ? "Spinner" : "TextWrap"}
          className={
            refusal === null
              ? "size-3.5 text-muted-foreground"
              : "size-3.5 text-destructive"
          }
        />
        {refusal !== null && (
          <span className="text-xs text-destructive">{refusal}</span>
        )}
      </Button>
    </span>
  );
}
