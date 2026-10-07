// Turning a swipe into a decision, and taking the last one back.
//
// The card leaves the deck at once and the server is told after; a failure
// puts it back. Undo walks a stack of this window's decisions, newest first,
// and the server refuses only an install that has already started.
import { toast } from "sonner";
import type { Direction } from "../lib/gesture";
import type { Decision, NewCard } from "../lib/new-deck";
import type { SourceSummary } from "../lib/source";
import { haptic } from "./haptics";
import { triageStore, type TriageRpc } from "./triage-store";

export interface Plan {
  summary: SourceSummary | null;
  confirmedSource: unknown;
  compatible: boolean;
  incompatibleReason: string | null;
}

const plans = new Map<string, Promise<Plan>>();

/**
 * The install plan for a card, fetched once. The card shows its source, and
 * an install sends that same source back so bb refuses one that moved.
 */
export function planFor(rpc: TriageRpc, card: NewCard): Promise<Plan> {
  let plan = plans.get(card.key);
  if (plan === undefined) {
    plan = rpc.call("entry_plan", { entryId: card.entryId, marketplace: card.marketplace }) as Promise<Plan>;
    plans.set(card.key, plan);
    // A failed lookup is retried next time rather than cached.
    plan.catch(() => plans.delete(card.key));
  }
  return plan;
}

/** The deck a card was decided from: the New deck, or the Saved one. */
export type DeckName = "new" | "saved";

const ACTIONS = { right: "install", left: "dismiss", up: "save" } as const;

type Sent = (typeof ACTIONS)[Direction];

interface Made {
  card: NewCard;
  /**
   * What the server was told; "later" is the Saved deck's ↑, which tells it
   * nothing: the card moves to the back of the deck and stays saved.
   */
  action: Sent | "later";
  deck: DeckName;
  /**
   * Resolves once the server has the decision, to what the card was before
   * (a save, or nothing), which undo restores; null if the decision failed.
   * An entry exists from the moment of the swipe, so an undo pressed before
   * the server answers takes back this decision, not the one before it.
   */
  settled: Promise<{ previous: Decision | null } | null>;
  /** Set while an undo of it is in flight, so a second Z takes the one before. */
  undoing?: boolean;
}

const made: Made[] = [];

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

async function send(rpc: TriageRpc, card: NewCard, action: Sent): Promise<{ previous: Decision | null }> {
  let confirmedSource: unknown;
  if (action === "install") {
    // Fail closed: an install goes only with the source the card showed, so
    // bb refuses it if the listing has moved since. If that can't be had,
    // this throws and the card goes back, rather than installing whatever
    // the listing points at now. Normally loaded while the card sat on top.
    const plan = await planFor(rpc, card);
    // Null only for a plugin bundled with bb, which has no listing to move.
    confirmedSource = plan.confirmedSource ?? undefined;
  }
  const { previous } = await rpc.call("decide", {
    key: card.key,
    entryId: card.entryId,
    marketplace: card.marketplace,
    pluginId: card.pluginId,
    displayName: card.displayName,
    action,
    ...(confirmedSource === undefined ? {} : { confirmedSource }),
  });
  return { previous };
}

/**
 * A decision on a card from either deck. On the Saved deck ← forgets the
 * plugin and ↑ sends it to the back, and a failed decision puts the card back
 * where it came from.
 */
export async function decide(rpc: TriageRpc, card: NewCard, direction: Direction, deck: DeckName = "new"): Promise<void> {
  if (deck === "saved" && direction === "up") {
    triageStore.laterSaved(card.key);
    made.push({ card, action: "later", deck, settled: Promise.resolve({ previous: null }) });
    return;
  }
  const action = ACTIONS[direction];
  triageStore.take(card.key);
  if (action === "save") triageStore.addSaved(card);
  const settled = send(rpc, card, action).catch((cause: unknown) => {
    made.splice(made.indexOf(entry), 1);
    triageStore.take(card.key);
    if (deck === "saved") triageStore.addSaved(card);
    else triageStore.putBack(card);
    haptic("error");
    toast.error(`Couldn't ${deck === "saved" && action === "dismiss" ? "forget" : action} ${card.displayName}: ${message(cause)}`);
    return null;
  });
  const entry: Made = { card, action, deck, settled };
  made.push(entry);
  await settled;
}

async function undoEntry(rpc: TriageRpc, entry: Made): Promise<void> {
  if (entry.undoing === true) return;
  entry.undoing = true;
  const sent = await entry.settled;
  if (sent === null || !made.includes(entry)) return;
  if (entry.action === "later") {
    // Only ever moved in this window: back to the front of Saved.
    made.splice(made.indexOf(entry), 1);
    haptic("impact-light");
    triageStore.addSaved(entry.card);
    return;
  }
  try {
    const result = await rpc.call("undo", { key: entry.card.key, restore: sent.previous });
    if (!result.undone) {
      entry.undoing = false;
      haptic("warning");
      toast(result.reason ?? "That can't be undone now.");
      return;
    }
    made.splice(made.indexOf(entry), 1);
    haptic("impact-light");
    triageStore.take(entry.card.key);
    if (sent.previous?.action === "save") triageStore.addSaved(entry.card);
    else triageStore.putBack(entry.card);
    // The server announced the undo, and the refresh that announcement
    // started was dropped by the put-back above, which guards against older
    // loads. Fetch again so the rest of the page catches up too.
    void triageStore.load(rpc);
  } catch (cause) {
    entry.undoing = false;
    toast.error(`Couldn't undo: ${message(cause)}`);
  }
}

/** Takes back this window's most recent decision. */
export async function undoLast(rpc: TriageRpc): Promise<void> {
  const last = made.findLast((entry) => entry.undoing !== true);
  if (last === undefined) {
    toast("Nothing to undo.");
    return;
  }
  await undoEntry(rpc, last);
}

export function canUndo(): boolean {
  return made.length > 0;
}

/** Tests only. */
export function resetDecisions(): void {
  made.length = 0;
  plans.clear();
}
