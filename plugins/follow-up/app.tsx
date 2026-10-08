// bb-plugin-follow-up — frontend entry.
//
// The card above the composer, a row in the menu beside the send button, and
// thread panel tabs for reading detail properly and for handing a row off.
// `chrome: "card"` means BB draws the host card and this file owns only the
// contents, so it matches native chrome for free.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { contextAround, selectionToFollowUp } from "./lib/followups.ts";
import { FollowUpBanner } from "./src/banner";
import { FollowUpPanel } from "./src/panel";
import { HandoffPanel } from "./src/handoff-panel.tsx";
import { HANDOFF_PANEL_ACTION } from "./src/handoff.tsx";
import { FollowUpPicker, PICKER_POPUP_ID, registerInsertCommand } from "./src/picker.tsx";
import {
  recordSendMenuItem,
  REFUSAL_DETAIL,
  registerRecordCommand,
} from "./src/record-draft.ts";
import { ExpansionModelSettings } from "./src/settings-section.tsx";
import { DestinationsSettings } from "./src/destinations-settings.tsx";
import { ConfirmFiling } from "./src/confirm-filing.tsx";
import { CONFIRM_FILING_RENDERER } from "./lib/destinations.ts";
import { threadIdFromScope } from "./src/scope.ts";
import { hasFollowUps, setCollapsed } from "./src/store.ts";
import { commands } from "./src/commands.ts";
import { FOLLOWUPS_PANEL_ACTION } from "./src/panel-ids.ts";
import { getRpc } from "./src/rpc.ts";
import { toast } from "sonner";
import { ComplicationPublisher } from "./src/complication-publisher.tsx";
import { registerWrapUpCommand, WRAP_UP_POPUP_ID, WrapUpPopup } from "./src/wrap-up.tsx";

export default definePluginApp((app) => {
  // Publishes each thread's follow-up progress for any surface drawing it —
  // Thread Badges' ring today. An overlay because it must outlive any one
  // thread view: it is the only listener for every thread's changes.
  app.slots.experimental_appOverlay({
    id: "complications",
    component: ComplicationPublisher,
  });

  app.composer.customize({
    id: "follow-up",
    // "Record the draft" is an alternative to sending it, so it is a row in
    // the send-button menu, beside bb's own Save draft and Send later; see
    // src/record-draft.ts. One verb, not two: describing a row is not part of
    // capturing it, so "describe" lives on the rows, where it applies to any
    // thin row however it arrived.
    sendMenu: [recordSendMenuItem],
    // One surface, two sizes: a summary line when collapsed, the full list when
    // not. It never unmounts while the thread has rows, which is what lets it
    // own fetching — there is no second component to keep in step.
    banners: [{ id: "followups", chrome: "card", component: FollowUpBanner }],
    // The + menu brings things into the draft, and ours is a follow-up: the
    // row opens a picker over the composer (src/picker.tsx), registered in its
    // own customization below. Where bb has no popups, or the picker is out of
    // scope (the sent-message editor), the row falls back to what it did
    // before popups existed: it expands the banner, whose rows can be inserted.
    plusMenu: [
      {
        id: "show-followups",
        label: "Follow-ups",
        icon: "TextWrap",
        description: "Pick one of this thread's follow-ups to put in the composer.",
        // Greyed only when there is nothing to pick. The picker is worth
        // opening whether or not the banner is expanded.
        disabled: (composer) => !hasFollowUps(threadIdFromScope(composer.scope)),
        run({ composer }) {
          if (composer.experimental_openPopup?.(PICKER_POPUP_ID)) return;
          const threadId = threadIdFromScope(composer.scope);
          if (threadId !== null) setCollapsed(threadId, false);
        },
      },
    ],
  });

  // The picker the + row opens. Its own registration, not part of the one
  // above: popups are experimental, and bb rejects a customization it cannot
  // validate as a whole, so a host that refused them would take the banner and
  // the send-menu row down too.
  app.composer.customize({
    id: "follow-up-picker",
    scopes: ["thread"],
    experimental_popups: [
      { id: PICKER_POPUP_ID, label: "Follow-ups", component: FollowUpPicker },
      // Taking the thread to done: see src/wrap-up.tsx.
      { id: WRAP_UP_POPUP_ID, label: "Wrap up", component: WrapUpPopup },
    ],
  });

  // Capture in place: highlight a sentence in a message and record it without
  // retyping it. Like recording the draft, it writes a row the user wrote
  // rather than an agent, which is why rows can have no reason.
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
      // A refusal does not, and the selection bar is gone by the time the
      // answer arrives, so the reason goes in a toast from bb's own toaster.
      // This used to open the panel, which said nothing about why: a duplicate
      // or dismissed row is precisely the one not in the list.
      if (result.outcome !== "added") toast.error(REFUSAL_DETAIL[result.outcome]);
    },
  });

  // Show or hide the banner, open the panel, start a handoff: see
  // src/commands.ts for why none of them has a default shortcut.
  for (const command of commands) app.commands.register(command);
  // Record the draft, or open the picker, from the keyboard, in whichever
  // composer holds the caret.
  registerRecordCommand(app.composer);
  registerInsertCommand(app.composer);
  registerWrapUpCommand(app.composer);

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

  // Where follow-ups can be filed: a list, not a field, so it is a section of
  // its own, like the model picker above. See src/destinations-settings.tsx.
  app.slots.settingsSection({
    id: "destinations",
    title: "Where follow-ups can be filed",
    description:
      "Commands or agent recipes that move a follow-up to your tracker or backlog.",
    component: DestinationsSettings,
  });

  // The one tap an agent's file_follow_ups waits on before writing to the
  // user's tracker. See src/confirm-filing.tsx.
  app.slots.pendingInteraction({ id: CONFIRM_FILING_RENDERER, component: ConfirmFiling });

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
    id: FOLLOWUPS_PANEL_ACTION,
    title: "Follow-ups",
    icon: "TextWrap",
    component: ({ threadId, params }) => (
      <FollowUpPanel threadId={threadId} params={params} />
    ),
  });
});
