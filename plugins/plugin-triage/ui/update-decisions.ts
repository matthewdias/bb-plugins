// Turning a swipe on the Updates deck into a decision, and taking it back.
//
// → queues the update for the batch, ← skips this version, ↑ snoozes it for
// a week. Nothing runs until the batch starts, so undo takes back any of
// them until then; the server refuses only an update already under way.
import { toast } from "sonner";
import type { Direction } from "../lib/gesture";
import type { UpdateCard, UpdateDecision } from "../lib/updates-deck";
import { haptic } from "./haptics";
import { triageStore, type TriageRpc } from "./triage-store";

const ACTIONS = { right: "queue", left: "skip", up: "snooze" } as const;

interface Made {
  card: UpdateCard;
  /** Resolves to what the plugin's decision was before, or null if this one failed. */
  settled: Promise<{ previous: UpdateDecision | null } | null>;
  undoing?: boolean;
}

const made: Made[] = [];

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export async function decideUpdate(rpc: TriageRpc, card: UpdateCard, direction: Direction): Promise<void> {
  const action = ACTIONS[direction];
  triageStore.takeUpdate(card.key);
  const settled = rpc
    .call("update_decide", {
      pluginId: card.pluginId,
      displayName: card.displayName,
      action,
      from: { version: card.from.version, display: card.from.display },
      to: { version: card.to.version, display: card.to.display },
    })
    .then(({ previous }) => ({ previous }))
    .catch((cause: unknown) => {
      made.splice(made.indexOf(entry), 1);
      triageStore.putBackUpdate(card);
      haptic("error");
      toast.error(`Couldn't ${action === "queue" ? "queue" : action} ${card.displayName}: ${message(cause)}`);
      return null;
    });
  const entry: Made = { card, settled };
  made.push(entry);
  await settled;
}

async function undoEntry(rpc: TriageRpc, entry: Made): Promise<void> {
  if (entry.undoing === true) return;
  entry.undoing = true;
  const sent = await entry.settled;
  if (sent === null || !made.includes(entry)) return;
  try {
    const result = await rpc.call("update_undo", { pluginId: entry.card.pluginId, restore: sent.previous });
    if (!result.undone) {
      entry.undoing = false;
      haptic("warning");
      toast(result.reason ?? "That can't be undone now.");
      return;
    }
    made.splice(made.indexOf(entry), 1);
    haptic("impact-light");
    triageStore.putBackUpdate(entry.card);
    // The server announced the undo, and the refresh that announcement
    // started was dropped by the put-back above, which guards against older
    // loads. Fetch again so the rest of the page catches up too.
    void triageStore.load(rpc);
  } catch (cause) {
    entry.undoing = false;
    toast.error(`Couldn't undo: ${message(cause)}`);
  }
}

/** Takes back this window's most recent Updates decision. */
export async function undoLastUpdate(rpc: TriageRpc): Promise<void> {
  const last = made.findLast((entry) => entry.undoing !== true);
  if (last === undefined) {
    toast("Nothing to undo.");
    return;
  }
  await undoEntry(rpc, last);
}

/** Tests only. */
export function resetUpdateDecisions(): void {
  made.length = 0;
}
