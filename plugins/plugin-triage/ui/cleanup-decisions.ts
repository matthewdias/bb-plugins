// Managing an installed plugin, and taking it back.
import { toast } from "sonner";
import type { Direction } from "../lib/gesture";
import type { CleanupAction, CleanupCard, CleanupDecision } from "../lib/cleanup-deck";
import type { DeckAction } from "./card-actions";
import { haptic } from "./haptics";
import { triageStore, type TriageRpc } from "./triage-store";

export function canManage(card: CleanupCard): boolean {
  return !card.protected && !card.removalPending;
}

export function cleanupActions(card: CleanupCard): Partial<Record<Direction, DeckAction & { action: CleanupAction }>> {
  if (!canManage(card)) return {};
  return {
    left: { action: "remove", label: "Queue uninstall", icon: "Trash2" },
    up: card.reason.kind === "trial"
      ? { action: "extend", label: "2 more weeks", icon: "Clock" }
      : card.suggested
        ? { action: "keep", label: "Review later", icon: "Clock", detail: "Review again in 90 days." }
        : undefined,
    right: card.enabled ? undefined : { action: "enable", label: "Turn on", icon: "Power", fallback: "Check" },
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

export async function decideCleanup(rpc: TriageRpc, card: CleanupCard, action: CleanupAction): Promise<void> {
  const settled = rpc
    .call("cleanup_decide", { pluginId: card.pluginId, displayName: card.displayName, action })
    .then(({ previous }) => {
      void triageStore.load(rpc);
      return { previous };
    })
    .catch((cause: unknown) => {
      made.splice(made.indexOf(entry), 1);
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
    if (entry.action === "remove") triageStore.removeQueuedJob(entry.card.key);
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
