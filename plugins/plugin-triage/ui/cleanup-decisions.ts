// Turning a swipe on the Cleanup deck into a decision, and taking it back.
//
// What each direction does depends on the card: an enabled plugin can be
// kept, tried without, or uninstalled; a disabled one kept off, turned back
// on, or uninstalled; one put aside to try without, turned back on, given two
// more weeks, or uninstalled. Uninstalling waits in the queue for Run all;
// turning a plugin off or on happens at once, and undo turns it back.
import { toast } from "sonner";
import type { DeckActions } from "./CardStack";
import type { Direction } from "../lib/gesture";
import type { CleanupCard, CleanupDecision } from "../lib/cleanup-deck";
import { haptic } from "./haptics";
import { triageStore, type TriageRpc } from "./triage-store";

export type CleanupAction = "keep" | "trial" | "enable" | "remove";

const REMOVE = { label: "Uninstall", name: "Uninstall", icon: "Trash2", hint: "uninstall" };

/** What → ← ↑ do for this card. */
export function cleanupActions(card: CleanupCard): { actions: Record<Direction, CleanupAction>; labels: DeckActions } {
  if (card.reason.kind === "trial") {
    return {
      actions: { right: "enable", left: "remove", up: "trial" },
      labels: {
        right: { label: "Turn on", name: "Turn it back on", icon: "Check", hint: "turn on" },
        left: REMOVE,
        up: { label: "Not yet", name: "Two more weeks without it", icon: "Clock", hint: "two more weeks" },
      },
    };
  }
  if (!card.enabled) {
    return {
      actions: { right: "keep", left: "remove", up: "enable" },
      labels: {
        right: { label: "Keep off", name: "Keep it off", icon: "Check", hint: "keep off" },
        left: REMOVE,
        up: { label: "Turn on", name: "Turn it back on", icon: "RotateCcw", hint: "turn on" },
      },
    };
  }
  return {
    actions: { right: "keep", left: "remove", up: "trial" },
    labels: {
      right: { label: "Keep", name: "Keep it", icon: "Check", hint: "keep" },
      left: REMOVE,
      up: { label: "Try without", name: "Try without it for two weeks", icon: "Clock", hint: "try without" },
    },
  };
}

interface Made {
  card: CleanupCard;
  action: CleanupAction;
  settled: Promise<{ previous: CleanupDecision | null } | null>;
  undoing?: boolean;
}

const made: Made[] = [];

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export async function decideCleanup(rpc: TriageRpc, card: CleanupCard, direction: Direction): Promise<void> {
  const action = cleanupActions(card).actions[direction];
  triageStore.takeCleanup(card.key);
  const settled = rpc
    .call("cleanup_decide", { pluginId: card.pluginId, displayName: card.displayName, action })
    .then(({ previous }) => ({ previous }))
    .catch((cause: unknown) => {
      made.splice(made.indexOf(entry), 1);
      triageStore.putBackCleanup(card);
      haptic("error");
      toast.error(`Couldn't change ${card.displayName}: ${message(cause)}`);
      return null;
    });
  const entry: Made = { card, action, settled };
  made.push(entry);
  await settled;
}

async function undoEntry(rpc: TriageRpc, entry: Made): Promise<void> {
  if (entry.undoing === true) return;
  entry.undoing = true;
  const sent = await entry.settled;
  if (sent === null || !made.includes(entry)) return;
  try {
    const result = await rpc.call("cleanup_undo", { pluginId: entry.card.pluginId, action: entry.action, restore: sent.previous });
    if (!result.undone) {
      entry.undoing = false;
      haptic("warning");
      toast(result.reason ?? "That can't be undone now.");
      return;
    }
    made.splice(made.indexOf(entry), 1);
    haptic("impact-light");
    triageStore.putBackCleanup(entry.card);
    void triageStore.load(rpc);
  } catch (cause) {
    entry.undoing = false;
    toast.error(`Couldn't undo: ${message(cause)}`);
  }
}

/** Takes back this window's most recent Cleanup decision. */
export async function undoLastCleanup(rpc: TriageRpc): Promise<void> {
  const last = made.findLast((entry) => entry.undoing !== true);
  if (last === undefined) {
    toast("Nothing to undo.");
    return;
  }
  await undoEntry(rpc, last);
}

/** Tests only. */
export function resetCleanupDecisions(): void {
  made.length = 0;
}
