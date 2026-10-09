// Which providers the card draws, in what order, and which the header shows.
//
// The card draws every provider with something to say: this plugin's Git and
// pull request first, then everyone else in the order the registry lists
// them, which is the order they registered. The header picks the worst few of
// those for its chips, and the worst tone of all for its dot.
import type { ComplicationValue } from "./complications";
import { severityOf } from "./tone";

export const GIT_ID = "thread-summary/git";
export const PULL_REQUEST_ID = "thread-summary/pull-request";

/** How many chips the header draws beside its button. */
export const MAX_CHIPS = 3;

const FIRST: readonly string[] = [GIT_ID, PULL_REQUEST_ID];

/** Ids in drawing order, without the ones hidden in settings. */
export function orderedIds(registered: readonly string[], hidden: ReadonlySet<string>): string[] {
  const visible = registered.filter((id) => !hidden.has(id));
  const first = FIRST.filter((id) => visible.includes(id));
  return [...first, ...visible.filter((id) => !FIRST.includes(id))];
}

export interface Entry<P = { id: string }> {
  provider: P;
  value: ComplicationValue;
}

/** Only the entries with something to say: unanswered and `null` draw nothing. */
export function present<P>(
  providers: readonly P[],
  values: readonly (ComplicationValue | null | undefined)[],
): Entry<P>[] {
  const entries: Entry<P>[] = [];
  providers.forEach((provider, index) => {
    const value = values[index];
    if (value != null) entries.push({ provider, value });
  });
  return entries;
}

/** The worst few, worst first; ties keep the card's order. */
export function chips<P>(entries: readonly Entry<P>[], max: number = MAX_CHIPS): Entry<P>[] {
  return entries
    .map((entry, index) => ({ entry, index, rank: severityOf(entry.value.tone) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, max)
    .map(({ entry }) => entry);
}

/**
 * The tone of the dot that stands in for chips, or `null` for no dot. Quiet
 * is every value in `default`: a dot that is always there says nothing.
 */
export function worstTone<P>(entries: readonly Entry<P>[]): string | null {
  const [worst] = chips(entries, 1);
  if (worst === undefined || severityOf(worst.value.tone) === severityOf("default")) return null;
  return worst.value.tone ?? null;
}

/**
 * Text this short is a count, a number or a short state — `↑141 ↓26`,
 * `merged`, `:5173` — and cutting it would change what it says: "↑1…" reads
 * as "ahead by 1". Its chip never shrinks, so it shows whole or not at all.
 * Longer text is a phrase, whose chip may give way when the row is crowded.
 */
export const SHORT_TEXT = 8;

/** Decided from the text alone, in characters, the same for every provider. */
export function isShortText(text: string | undefined): boolean {
  return text === undefined || [...text].length <= SHORT_TEXT;
}
