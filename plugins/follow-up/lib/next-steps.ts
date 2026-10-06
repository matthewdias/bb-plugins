// Next steps: what the agent offered to do next, as buttons under its reply.
//
// Pure, like followups.ts: no plugin API, so every rule here is testable
// without a running bb. Keep `bb.*` calls in server.ts.
//
// Replies end with "Want me to open a PR?" and the answer is "yes", typed by
// hand. An offer turns that question into something to press. It is the other
// half of a follow-up: a follow-up is work the agent is *not* doing here, a
// next step is work it would do here the moment you said so.
//
// An offer belongs to one turn. `offer_next_steps` writes it while the agent is
// still working, and the next turn starting clears it, whoever starts that turn.
// A button on screen is therefore always an answer to the reply right above it.
// A button under a reply five turns up would be the "yes" you would have typed
// back then, and sending it now is almost always a mistake — which is why
// there is no per-message variant of this.
//
// What a button shows is exactly what it sends. A press puts words in the
// conversation under the user's name, and the agent wrote them, so there is no
// separate "prompt" behind a short label: an agent steered by something it read
// could otherwise label a button "Open a PR" and have it send anything, with
// the user's authority, on a phone where nothing would show the difference.
import { isInProgress, mainActionFor, normalizeKey, type FollowUp } from "./followups.ts";

/**
 * At most this many. A chip row has to fit beside nothing on a phone, and an
 * agent offering five things has not decided what comes next.
 */
export const NEXT_STEPS_MAX = 3;
/**
 * One step's text: the button, and the message pressing it sends. Short enough
 * to be shown whole — a chip never truncates it, because a cut-off button would
 * send words the user did not see.
 */
export const NEXT_STEP_MAX = 80;

/**
 * Characters that draw nothing, or change how what is around them draws:
 * controls, format characters (zero-width spaces and joiners, bidi overrides,
 * Unicode tag characters), private-use and unassigned code points, line and
 * paragraph separators, and every default-ignorable code point (variation
 * selectors among them). A model reads all of them. Tag characters in
 * particular spell ASCII a model will follow and a screen will not show, so a
 * button whose text held any of these would send words the user never saw.
 *
 * The cost is a step with a ZWJ emoji sequence or a VS16 heart cannot be
 * offered. A button label can live without either.
 */
const HIDDEN = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/u;
const HIDDEN_ALL = new RegExp(HIDDEN.source, "gu");

/**
 * A step as it will be shown and sent: each run of whitespace one space,
 * which is how the chip draws it anyway, and trimmed.
 */
export function normalizeStep(step: string): string {
  return step.replace(/\s+/g, " ").trim();
}

/** Would every character of this normalized step show on screen? */
export function isShowable(step: string): boolean {
  return !HIDDEN.test(step);
}

/**
 * Text with everything that would not show removed, for quoting agent-written
 * text inside a message sent under the user's name.
 */
export function visibleText(text: string): string {
  // Whitespace first: a newline is a control character too, and stripping it
  // before it became a space would fuse the words either side of it.
  return normalizeStep(normalizeStep(text).replace(HIDDEN_ALL, ""));
}

export interface NextOffer {
  /** Each the user's instruction, as they would have typed it to say yes. */
  steps: string[];
  /**
   * The agent's judgement that what this thread set out to do is done. A
   * report, not a verdict: it changes what the card leads with and nothing
   * else. Closing the thread stays a person's call.
   */
  goalMet: boolean;
  /**
   * When it was offered, and the offer's identity. A press names the offer it
   * was looking at, so a click that lands after the agent replaced its offer
   * cannot send a step from the new one by index.
   */
  offeredAt: string;
}

/**
 * The offer as stored, or null when there is nothing to show.
 *
 * Normalizes whitespace, then drops empty steps, steps with anything that
 * would not show (see `HIDDEN`), steps too long to show whole, and steps that
 * repeat (by the same case- and punctuation-blind key follow-ups dedupe on),
 * and keeps the first `NEXT_STEPS_MAX`. Dropped, not cleaned: a step that
 * arrived carrying hidden characters is not one to offer at all. An offer with
 * no steps survives only if it says the goal is met — that alone is something
 * to show.
 */
export function makeOffer(
  steps: readonly string[],
  goalMet: boolean,
  offeredAt: string,
): NextOffer | null {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const raw of steps) {
    const step = normalizeStep(raw);
    if (step === "" || step.length > NEXT_STEP_MAX || !isShowable(step)) continue;
    const key = normalizeKey(step);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(step);
    if (kept.length === NEXT_STEPS_MAX) break;
  }
  if (kept.length === 0 && !goalMet) return null;
  return { steps: kept, goalMet, offeredAt };
}

/**
 * A stored offer, re-validated on read.
 *
 * kv values survive upgrades, so a shape that stops parsing reads as "no
 * offer" rather than throwing inside a render or an RPC. Steps are re-run
 * through `makeOffer`'s rules for the same reason: what is stored is trusted
 * only as far as it still parses.
 */
export function parseOffer(value: unknown): NextOffer | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.offeredAt !== "string") return null;
  if (typeof candidate.goalMet !== "boolean") return null;
  if (!Array.isArray(candidate.steps)) return null;
  if (!candidate.steps.every((step) => typeof step === "string")) return null;
  return makeOffer(candidate.steps as string[], candidate.goalMet, candidate.offeredAt);
}

/**
 * The step a press named, or null when the press is stale.
 *
 * Stale means the offer it was looking at is gone or has been replaced. A
 * matching index into a different offer would send something nobody pressed.
 */
export function stepAt(
  offer: NextOffer | null,
  offeredAt: string,
  index: number,
): string | null {
  if (offer === null || offer.offeredAt !== offeredAt) return null;
  return offer.steps[index] ?? null;
}

/**
 * The offer with one step taken out — kept as a follow-up rather than sent.
 * Same identity, so the remaining chips stay pressable.
 */
export function withoutStep(offer: NextOffer, index: number): NextOffer | null {
  const steps = offer.steps.filter((_, at) => at !== index);
  if (steps.length === 0 && !offer.goalMet) return null;
  return { ...offer, steps };
}

/**
 * The follow-up the card offers to do next, when the agent offered nothing.
 *
 * The top of the list, as long as it is something to do here: an out-of-scope
 * row leads with handing off, so it is not "next" in this thread, and a row
 * already in progress has been sent once. Only the top row is considered. The
 * list's order is the user's priority, and skipping past the top row to find
 * an eligible one would put the plugin's judgement above theirs.
 */
export function doCandidate(rows: readonly FollowUp[]): FollowUp | null {
  const top = rows[0];
  if (top === undefined) return null;
  if (mainActionFor(top.reason) !== "insert") return null;
  if (isInProgress(top)) return null;
  if (top.handoffState === "running") return null;
  return top;
}

/**
 * The visible half of pressing "Do": one line that reads as something the
 * user would have typed. The row's full record goes with it agent-only.
 *
 * The row's text is usually an agent's, and this line goes out under the
 * user's name, so only what would show on screen is quoted.
 */
export function doAsk(row: FollowUp): string {
  return `Pick up the follow-up "${visibleText(row.text)}".`;
}

/** How much of a follow-up the "Do" chip shows: what fits beside "Do:" on a phone. */
export const DO_LABEL_MAX = 36;

/**
 * A follow-up's text cut down to fit the "Do" chip.
 *
 * Derived from the row's own words, never written separately. The chip
 * stands for a row the user can read in full in the list right below it, and
 * the line a press sends quotes that row in full. A short title an agent
 * supplied could say something the row does not, and the button would then
 * show one thing and send another — the gap the rest of this file exists to
 * close. A prefix cannot do that: everything it shows is the start of what
 * goes.
 *
 * The cut prefers the row's headline, the part before the first ": ", "; ",
 * ". ", " (" or spaced dash, which is how most rows read ("Fix the restore:
 * reinstall through the store"). A one-word headline ("Docs: …") says too
 * little and is ignored. Anything still too long is cut at a word. Whenever
 * the label is shorter than the row, it ends in "…", so a chip never passes
 * a fragment off as the whole thing.
 */
export function shortLabel(text: string, max = DO_LABEL_MAX): string {
  const full = visibleText(text);
  const headline = full.split(/:\s|;\s|\.\s|\s[—–-]\s|\s\(/)[0]!.trim();
  let label = headline.split(" ").length >= 2 ? headline : full;
  if (label.length > max) {
    const cut = label.slice(0, max);
    const space = cut.lastIndexOf(" ");
    label = space > max / 2 ? cut.slice(0, space) : cut;
  }
  label = label.replace(/[\s,;:.—–-]+$/, "");
  return label.length < full.replace(/[\s.]+$/, "").length ? `${label}…` : label;
}
