// Palette commands, for reaching the follow-ups from the keyboard.
//
// No default shortcuts: bb leaves a default that conflicts with one of its own
// unbound, silently, so every command here is bound by the user under
// Settings → Keyboard. `register` has no disposer and needs none — bb replaces
// a plugin's registrations wholesale whenever it re-runs the app's setup.
import type { PluginCommandRegistration } from "@get-bb/plugin-sdk/app";
import { FOLLOWUPS_PANEL_ACTION, HANDOFF_PANEL_ACTION } from "./panel-ids.ts";
import { getRpc } from "./rpc.ts";
import { hasFollowUps, toggleCollapsed } from "./store.ts";
import { peekOffer, takeStep } from "./use-next-steps.ts";

/**
 * "Take the first next step", and the second and third: the keyboard's way to
 * press a chip. By position, not by label — a label changes every turn, and a
 * key bound to one would mean something different each time.
 */
const takeCommands: PluginCommandRegistration[] = ["first", "second", "third"].map(
  (ordinal, index) => ({
    id: `take-next-step-${index + 1}`,
    title: `Follow-ups: take the ${ordinal} next step`,
    // The offer is cleared the moment a turn starts, so "there is a step at
    // this position" also means "the thread is between turns".
    isAvailable: ({ threadId }) => (peekOffer(threadId)?.steps.length ?? 0) > index,
    run: ({ threadId }) => {
      const offer = peekOffer(threadId);
      const rpc = getRpc();
      if (threadId === null || offer === null || rpc === null) return;
      void takeStep(rpc, threadId, offer, index);
    },
  }),
);

export const commands: readonly PluginCommandRegistration[] = [
  {
    id: "toggle-followups",
    title: "Follow-ups: show or hide the list",
    // The banner's own fetch fills the store, and it is mounted under the
    // thread in view, so the rows this reads are that thread's.
    isAvailable: ({ threadId }) => hasFollowUps(threadId),
    run: ({ threadId }) => {
      if (threadId !== null) toggleCollapsed(threadId);
    },
  },
  {
    id: "open-followups-panel",
    title: "Follow-ups: open panel",
    // The panel answers an empty thread too, so it needs only a thread.
    isAvailable: ({ threadId }) => threadId !== null,
    run: ({ openPanel }) => {
      openPanel({ actionId: FOLLOWUPS_PANEL_ACTION });
    },
  },
  {
    id: "open-handoff-panel",
    title: "Follow-ups: hand off…",
    // No row: a command has none in focus, and guessing one would hand off
    // something nobody picked. Opened bare, the panel composes a new thread in
    // this checkout, as the empty state's "new thread" does; a row's own button
    // still opens it with that row.
    isAvailable: ({ threadId }) => threadId !== null,
    run: ({ openPanel }) => {
      openPanel({ actionId: HANDOFF_PANEL_ACTION });
    },
  },
  ...takeCommands,
];
