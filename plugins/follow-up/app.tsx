// bb-plugin-follow-up — frontend entry.
//
// Three surfaces: a count pill in the composer action row, the expanded card
// above the composer, and a thread panel tab for reading detail properly.
// `chrome: "card"` means BB draws the host card and this file owns only the
// contents, so it matches native chrome for free.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { contextAround, selectionToFollowUp } from "./lib/followups.ts";
import { FollowUpBanner } from "./src/banner";
import { FollowUpPanel } from "./src/panel";
import { HandoffPanel } from "./src/handoff-panel.tsx";
import { HANDOFF_PANEL_ACTION } from "./src/handoff.tsx";
import { RecordDraftAction } from "./src/record-draft.tsx";
import { ExpansionModelSettings } from "./src/settings-section.tsx";
import { threadIdFromScope } from "./src/scope.ts";
import { rememberDraftMentions } from "./src/draft-mentions.ts";
import { peekFollowUpState, setCollapsed } from "./src/store.ts";
import { getRpc } from "./src/rpc.ts";

export default definePluginApp((app) => {
  app.composer.customize({
    id: "follow-up",
    // The pill is always mounted and owns fetching; the banner is the expanded
    // state and unmounts when collapsed. They share module scope, not kv.
    // The action row is for the send: its verbs, and the settings that decide
    // what the send does — which is why the host puts the model picker and
    // permission mode there. "Record the draft" is such a verb. A follow-up
    // count is neither, so it is not here; it is the banner's collapsed state.
    // See src/record-draft.tsx and the decision in PLAN.md.
    // One verb, not two. "Record and describe" was a second button here doing
    // almost the same thing, and describing is not a property of *capturing* —
    // it applies to any thin row, whoever wrote it and however it arrived. It
    // moved to the rows, where it can be used on a selection capture or an old
    // row too, and where it shares a slot with the stop that cancels it.
    actions: [{ id: "record-draft", component: RecordDraftAction }],
    // One surface, two sizes: a summary line when collapsed, the full list when
    // not. It never unmounts while the thread has rows, which is what lets it
    // own fetching — there is no second component to keep in step.
    banners: [{ id: "followups", chrome: "card", component: FollowUpBanner }],
    // Observed, never painted. The only route to a typed note's @-mentions:
    // `ComposerView.draft` is text alone, so a file mentioned while writing the
    // note would otherwise be visible on screen and invisible to the row it
    // becomes. `effects` is deliberately absent — this paints nothing.
    richText: {
      onDraftChange(draft, view) {
        rememberDraftMentions(threadIdFromScope(view.scope), draft.mentions);
      },
    },
    // The + menu attaches, and our attach verb is "put a follow-up in the
    // composer" — which every banner row already offers. So this hands you the
    // list rather than duplicating it: a `plusMenu` run gets no panel handle,
    // so a real picker would have to go through `bb.ui.requestInput` and a
    // pending interaction, and a modal over rows you can already see and click
    // is strictly worse. See the decision in PLAN.md.
    plusMenu: [
      {
        id: "show-followups",
        label: "Follow-ups",
        icon: "TextWrap",
        description: "Show this thread's follow-ups above the composer.",
        // Greyed rather than a no-op: nothing to show, or already showing.
        disabled: (view) => {
          const threadId = threadIdFromScope(view.scope);
          if (threadId === null) return true;
          const { rows, collapsed } = peekFollowUpState(threadId);
          return rows.length === 0 || !collapsed;
        },
        run({ view }) {
          const threadId = threadIdFromScope(view.scope);
          if (threadId !== null) setCollapsed(threadId, false);
        },
      },
    ],
  });

  // Capture in place: highlight a sentence in a message and record it without
  // retyping it. This is the only path by which a follow-up gets written by the
  // user rather than an agent, which is why rows can now have no reason.
  app.slots.messageAction({
    id: "record-follow-up",
    title: "Record as follow-up",
    icon: "TextWrap",
    async run(ctx) {
      const captured =
        ctx.selectedText === undefined ? null : selectionToFollowUp(ctx.selectedText);
      const rpc = getRpc();
      // Two ways to arrive here without a selection: the per-message action
      // bar, which the SDK gives no way to opt out of, and a selection of pure
      // whitespace. Opening the list beats a button that does nothing.
      if (captured === null || rpc === null) {
        ctx.openPanel({ actionId: "followups" });
        return;
      }
      // A short selection produces no detail of its own — the common case, and
      // why captured rows read thin. The message it came from is already in
      // hand, so the prose around the highlight costs nothing to keep: no
      // agent, no model, no extra step, and it cannot be wrong because it is
      // what was on screen. Only as a fallback: a selection long enough to
      // carry its own detail has already said more than its surroundings would.
      const detail =
        captured.detail ?? contextAround(ctx.message.text, ctx.selectedText ?? "");
      const result = await rpc.call("followups_add", {
        threadId: ctx.threadId,
        text: captured.text,
        ...(detail === null || detail === undefined ? {} : { detail }),
      });
      // A successful capture announces itself: the banner's count goes up.
      // A refusal does not, and opening the panel is a poor stand-in — a
      // duplicate or dismissed row is precisely the one not in the list, so the
      // panel opens saying nothing about why. This action has no surface of its
      // own to carry the reason: the selection bar is gone by the time the
      // answer arrives. The fix is a param on this openPanel, not a toast —
      // bb's own toaster is not reachable from a plugin. See PLAN.md.
      if (result.outcome !== "added") ctx.openPanel({ actionId: "followups" });
    },
  });

  // The one setting that cannot be declarative: a live provider and model
  // catalog. Everything else this plugin exposes is a `settings.define` field
  // and renders itself above this section. See src/settings-section.tsx.
  app.slots.settingsSection({
    id: "expansion-model",
    title: "Model for describing a follow-up",
    description:
      "The hidden helper that fills in a thin note's detail, and what it runs on.",
    component: ExpansionModelSettings,
  });

  // Where a row becomes a thread. Its own tab rather than a mode inside the
  // follow-ups panel: it is a composer with its own draft, and burying it in the
  // list would mean the list could not be read while one was being written.
  app.slots.threadPanelAction({
    id: HANDOFF_PANEL_ACTION,
    title: "Hand off",
    icon: "TextWrap",
    layout: "flush",
    component: ({ threadId, params }) => (
      <HandoffPanel threadId={threadId} params={params} />
    ),
  });

  // The read-properly surface, and the only path to detail on mobile: hover
  // cannot work on touch, so the banner shows no detail on a compact viewport.
  app.slots.threadPanelAction({
    id: "followups",
    title: "Follow-ups",
    icon: "TextWrap",
    component: ({ threadId, params }) => (
      <FollowUpPanel threadId={threadId} params={params} />
    ),
  });
});
