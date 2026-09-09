// Pure follow-up logic. No plugin API access, so every rule here is unit
// testable without a running bb. Keep all `bb.*` calls in server.ts.

export const REASONS = [
  "out-of-scope",
  "blocked",
  "deferred",
  "risk",
  "cleanup",
] as const;

export type Reason = (typeof REASONS)[number];

export type HandoffState = "running" | "finished" | "failed";

export interface FollowUp {
  id: string;
  text: string;
  /**
   * Why an agent is not doing this now. Null for a row a person wrote: the
   * five values answer a question only an agent is being asked, and inventing
   * a sixth for "because I said so" would be a category the agent must never
   * use. A row you wrote needs no justification.
   */
  reason: Reason | null;
  file: string | null;
  detail: string | null;
  createdAt: string;
  /**
   * Set when a prompt referencing this row was actually sent, via the mention
   * provider's resolve(). This means "in progress", not "done" — the agent may
   * have failed, or the work may have been abandoned. Rows stay visible; they
   * used to disappear here, which read as completion and was the reason
   * finishing something felt invisible.
   */
  sentAt?: string | null;
  /**
   * The thread a handoff sent this row to, when that thread is a child of this
   * one. Without it a finished child cannot be matched back to the row that
   * spawned it — which is why a returning child used to change nothing.
   *
   * Only children. An independent handoff records its destination in `doneNote`
   * and stops being this thread's business.
   */
  handoffThreadId?: string | null;
  /**
   * What that child is doing. `finished` deliberately does not mean done: a
   * child going idle is a report, and a report is not evidence. It means there
   * is something to check, which is the whole of what the plugin can honestly
   * claim to know.
   */
  handoffState?: HandoffState | null;
  /** Set when the work is actually finished. Moves the row to Done. */
  doneAt?: string | null;
  /**
   * Who closed it. Agents may close rows whose work they finished, so a done
   * row is no longer self-evidently a human's judgement — and an agent's report
   * is not evidence. Absent on rows closed before this field existed; those
   * were all human.
   */
  doneBy?: "agent" | "user" | null;
  /** What the closer says they did. Only agents are asked for one. */
  doneNote?: string | null;
  /**
   * Explicit position, ascending. Absent means never placed: those rows keep
   * insertion order, below every placed row. A thread nobody has ordered
   * therefore looks exactly as it did before ordering existed.
   */
  rank?: number | null;
  /**
   * Who last placed this row. The whole point of storing it: an agent may
   * reorder, but never above a row the user placed by hand.
   */
  rankBy?: RankBy | null;
  /**
   * Who wrote it. Absent on rows recorded before the user could write any, and
   * those were all agents. What it buys: an agent may not reword a row a
   * person wrote, and inferring authorship from a null reason would be a guess
   * dressed as a rule.
   */
  createdBy?: RankBy | null;
  /**
   * The helper thread that last described this row, kept after it finishes so
   * its reasoning can be read when the answer is unsatisfying.
   */
  expandedBy?: string | null;
  /**
   * How the last expansion ended. `unresolved` covers every way of not
   * answering — errored, stopped early, or judged the context insufficient —
   * because from the row's side they are the same thing: a helper looked and
   * the row is still thin. Null once something describes it.
   */
  expandOutcome?: "described" | "unresolved" | null;
  /**
   * Set while a helper thread is describing this row, cleared when it lands or
   * gives up.
   *
   * Stored rather than derived because the helper runs out of band: nothing in
   * the row itself changes while it works, so without this the user presses a
   * button and watches nothing happen — which is exactly what happened the
   * first time, when the helper died and the row stayed silently thin.
   */
  expandingSince?: string | null;
  /**
   * The child thread this row was recorded on, when it was carried up to its
   * parent on the child settling.
   *
   * A worker records what it noticed onto its own thread, and that thread is
   * one nobody opens again — so without this the plugin's founding promise
   * ("nothing an agent noticed gets lost") held only for work done inline. The
   * row is copied, not moved: a settled child may be steered again and should
   * not find its own notes gone.
   */
  inheritedFrom?: string | null;
  /**
   * Normalized keys this row used to have, kept when its text is amended.
   *
   * Dedupe and dismissal key on the text, so an amendment would otherwise free
   * the old wording to be recorded again as a second row for the same work.
   */
  aliases?: readonly string[];
}

export type RankBy = "user" | "agent";

/** kv values are capped at 256KB; this keeps one thread far below that and
 *  stops a looping agent from filling the store. */
export const MAX_PER_THREAD = 50;

/**
 * The highest the per-thread cap may be raised to.
 *
 * The default is a judgement about what a list stays readable at; this is the
 * budget underneath it. One thread's rows live in a single kv value capped at
 * 256KB, and a row with a full detail runs to roughly 1.3KB, so this leaves
 * the store about a third empty at the ceiling. Raising it is a storage
 * decision, not a taste one, which is why it is not a setting.
 */
export const CAP_CEILING = 200;

/**
 * Above this many rows a thread's banner starts folded to its summary line.
 *
 * Lives here rather than beside the store that reads it because the server
 * defines the setting that overrides it, and a default written down twice is a
 * default that will disagree with itself.
 */
export const AUTO_COLLAPSE_AT = 4;
export const TEXT_MAX = 240;
export const DETAIL_MAX = 1000;

export type AddOutcome = "added" | "duplicate" | "dismissed" | "full";

export interface AddResult {
  list: FollowUp[];
  outcome: AddOutcome;
}

/**
 * Identity used for dedupe and tombstones. Case- and punctuation-insensitive
 * so "Fix the flaky test." and "fix the flaky test" are the same follow-up —
 * agents rarely reproduce their own wording exactly.
 */
export function normalizeKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function isDismissed(text: string, tombstones: readonly string[]): boolean {
  return tombstones.includes(normalizeKey(text));
}

/** Rows predate the field; every one of them was written by an agent. */
export const authorOf = (row: FollowUp): RankBy => row.createdBy ?? "agent";

/** Every key this row answers to: its current text plus any it used to have. */
export function keysOf(row: FollowUp): string[] {
  return [normalizeKey(row.text), ...(row.aliases ?? [])];
}

/**
 * Insert unless the text duplicates a live row or a dismissed one. Dismissal
 * wins over recording: a row the human deleted must not come back because an
 * agent noticed the same thing again.
 */
export function addFollowUp(
  existing: readonly FollowUp[],
  incoming: FollowUp,
  tombstones: readonly string[],
  // Defaulted rather than required: every call site that has no opinion keeps
  // the cap that has always applied, and the setting is a narrowing of it
  // rather than a new obligation on the caller.
  cap: number = MAX_PER_THREAD,
): AddResult {
  const key = normalizeKey(incoming.text);
  if (key === "") return { list: [...existing], outcome: "duplicate" };
  if (tombstones.includes(key)) return { list: [...existing], outcome: "dismissed" };
  // Matches done rows too: while something sits in Done, an agent noticing it
  // again must not re-add it. Clearing Done is what releases the text.
  // Aliases included: a row whose wording was sharpened still answers to what
  // it used to say, so the original cannot come back as a second row.
  if (existing.some((row) => keysOf(row).includes(key))) {
    return { list: [...existing], outcome: "duplicate" };
  }
  if (existing.length >= cap) {
    return { list: [...existing], outcome: "full" };
  }
  return { list: [...existing, incoming], outcome: "added" };
}

const isDone = (row: FollowUp): boolean =>
  row.doneAt !== undefined && row.doneAt !== null;

const isInProgress = (row: FollowUp): boolean =>
  !isDone(row) && row.sentAt !== undefined && row.sentAt !== null;

/**
 * Rows still needing attention, in-progress ones last.
 *
 * In progress means a prompt referencing the row was sent. Those stay listed
 * rather than vanishing, so work in flight is visible, but they sort below
 * untouched rows because they are not what to pick up next.
 */
export function openFollowUps(
  list: readonly FollowUp[],
  tombstones: readonly string[],
): FollowUp[] {
  return orderFollowUps(
    applyTombstones(list, tombstones).filter((row) => !isDone(row)),
  );
}

const hasRank = (row: FollowUp): boolean =>
  row.rank !== undefined && row.rank !== null;

/**
 * The order every surface shows: placed rows first in the order they were
 * placed, then unplaced ones in insertion order with in-progress last.
 *
 * In-progress only sinks among unplaced rows. Once you have said where a row
 * goes, sending it to an agent must not move it — that would silently undo the
 * arrangement you just made.
 */
export function orderFollowUps(list: readonly FollowUp[]): FollowUp[] {
  const placed = list
    .filter(hasRank)
    .sort(
      (a, b) =>
        (a.rank as number) - (b.rank as number) ||
        a.createdAt.localeCompare(b.createdAt),
    );
  const rest = list.filter((row) => !hasRank(row));
  return [
    ...placed,
    ...rest.filter((row) => !isInProgress(row)),
    ...rest.filter(isInProgress),
  ];
}

/**
 * Re-rank `orderedIds` into exactly that order, attributing only `moved`.
 *
 * Attribution is per row, not per drag: moving one row by hand marks that row
 * as yours and leaves the rest as they were. Marking the whole list would let
 * a single drag freeze it against agents forever, which is a bigger decision
 * than the gesture makes.
 *
 * Ranks are renumbered from zero on every call rather than nudged between
 * neighbours. A thread holds at most MAX_PER_THREAD rows in one kv value, so
 * rewriting them all is cheap and leaves no fractional drift to reason about.
 */
export function applyOrder(
  list: readonly FollowUp[],
  orderedIds: readonly string[],
  by: RankBy,
  moved: readonly string[] = orderedIds,
): FollowUp[] {
  const position = new Map(orderedIds.map((id, index) => [id, index]));
  const movedSet = new Set(moved);
  // Placed rows that were not part of this order — done rows, typically —
  // keep their relative order behind the ones that were.
  const trailing = list
    .filter((row) => hasRank(row) && !position.has(row.id))
    .sort((a, b) => (a.rank as number) - (b.rank as number));
  trailing.forEach((row, index) => position.set(row.id, orderedIds.length + index));

  return list.map((row) => {
    const rank = position.get(row.id);
    if (rank === undefined) return row;
    return {
      ...row,
      rank,
      rankBy: movedSet.has(row.id) ? by : (row.rankBy ?? null),
    };
  });
}


export interface Amendment {
  text?: string;
  reason?: Reason | null;
  file?: string | null;
  detail?: string | null;
}

export type AmendOutcome =
  | "amended"
  | "unchanged"
  | "not-found"
  | "duplicate"
  | "dismissed"
  | "forbidden";

export interface AmendResult {
  list: FollowUp[];
  outcome: AmendOutcome;
  row: FollowUp | null;
}

/**
 * Change a row in place, keeping its identity — created time, in-progress
 * mark, position — which dismiss-plus-re-record threw away.
 *
 * An agent may not reword or re-categorise a row a person wrote: that is the
 * same boundary as dismissal, editing someone's words rather than reporting a
 * fact. It may still attach what it learned, so file and detail stay open.
 */
export function amendFollowUp(
  list: readonly FollowUp[],
  id: string,
  patch: Amendment,
  by: RankBy,
  tombstones: readonly string[] = [],
): AmendResult {
  const target = list.find((row) => row.id === id);
  if (target === undefined) return { list: [...list], outcome: "not-found", row: null };

  const rewording =
    (patch.text !== undefined && patch.text !== target.text) ||
    (patch.reason !== undefined && patch.reason !== target.reason);
  if (by === "agent" && authorOf(target) === "user" && rewording) {
    return { list: [...list], outcome: "forbidden", row: target };
  }

  let aliases = target.aliases;
  if (patch.text !== undefined) {
    const key = normalizeKey(patch.text);
    if (key === "") return { list: [...list], outcome: "unchanged", row: target };
    const previous = normalizeKey(target.text);
    if (key !== previous) {
      if (tombstones.includes(key)) {
        return { list: [...list], outcome: "dismissed", row: target };
      }
      if (list.some((row) => row.id !== id && keysOf(row).includes(key))) {
        return { list: [...list], outcome: "duplicate", row: target };
      }
      aliases = [...keysOf(target)];
    }
  }

  const amended: FollowUp = {
    ...target,
    ...(patch.text === undefined ? {} : { text: patch.text }),
    ...(patch.reason === undefined ? {} : { reason: patch.reason }),
    ...(patch.file === undefined ? {} : { file: patch.file }),
    ...(patch.detail === undefined ? {} : { detail: patch.detail }),
    ...(aliases === undefined ? {} : { aliases }),
  };
  const changed =
    amended.text !== target.text ||
    amended.reason !== target.reason ||
    amended.file !== target.file ||
    amended.detail !== target.detail;
  if (!changed) return { list: [...list], outcome: "unchanged", row: target };

  return {
    list: list.map((row) => (row.id === id ? amended : row)),
    outcome: "amended",
    row: amended,
  };
}

export type MovePosition = "top" | "bottom";

/**
 * Move one row to the top or bottom of the list it is in.
 *
 * An agent's "top" is the top of what it is allowed to touch: rows the user
 * placed by hand stay above it. That is the whole reconciliation rule — the
 * user does not have to win an argument, because the agent cannot start one.
 */
export function moveFollowUp(
  list: readonly FollowUp[],
  id: string,
  position: MovePosition,
  by: RankBy,
): { list: FollowUp[]; blockedBy: number } {
  const ordered = orderFollowUps(list.filter((row) => !isDone(row)));
  if (!ordered.some((row) => row.id === id)) {
    return { list: [...list], blockedBy: 0 };
  }
  const without = ordered.filter((row) => row.id !== id);
  // The leading run of user-placed rows, not every user-placed row: dragging
  // something to the bottom says where that row goes, not that the top of the
  // list is now closed. Only "top" is clamped — pushing a row down never
  // overrides anyone's arrangement.
  let userPlaced = 0;
  if (by === "agent" && position === "top") {
    while (without[userPlaced]?.rankBy === "user") userPlaced += 1;
  }
  const index = position === "top" ? userPlaced : without.length;
  const orderedIds = [
    ...without.slice(0, index).map((row) => row.id),
    id,
    ...without.slice(index).map((row) => row.id),
  ];
  return { list: applyOrder(list, orderedIds, by, [id]), blockedBy: userPlaced };
}

/** Finished rows, newest first — the Done section. */
export function doneFollowUps(
  list: readonly FollowUp[],
  tombstones: readonly string[],
): FollowUp[] {
  return applyTombstones(list, tombstones)
    .filter(isDone)
    .sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? ""));
}

export { isDone, isInProgress };

/** Drop rows whose text was dismissed while they sat in the list. */
export function applyTombstones(
  list: readonly FollowUp[],
  tombstones: readonly string[],
): FollowUp[] {
  if (tombstones.length === 0) return [...list];
  return list.filter((row) => !tombstones.includes(normalizeKey(row.text)));
}


export interface CapturedSelection {
  text: string;
  detail?: string;
}

/**
 * Are these two row lists the same in every respect the UI can render?
 *
 * Compared whole, not field by field. The banner's store drops an update whose
 * rows compare equal, so a comparison that names its fields silently drops
 * every change to a field nobody remembered to add — which is what happened:
 * the list checked `id`, `sentAt` and `doneAt`, so a row being described, a
 * returning handoff, and any amend to text or detail all reached the panel and
 * never reached the banner.
 *
 * The asymmetry is the whole argument for doing it this way. Comparing too
 * loosely costs a re-render nobody notices; comparing too tightly costs a
 * state the user is waiting to see. Serialising both is cheap at
 * MAX_PER_THREAD rows and cannot go stale as fields are added.
 */
export function rowsEqual(
  a: readonly FollowUp[],
  b: readonly FollowUp[],
): boolean {
  if (a.length !== b.length) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Did a helper look at this row and leave it no better? */
export function expansionGaveUp(row: FollowUp): boolean {
  return !isDone(row) && !isExpanding(row) && row.expandOutcome === "unresolved";
}

/** Is a helper thread currently describing this row? */
export function isExpanding(row: FollowUp): boolean {
  return (
    !isDone(row) &&
    row.expandingSince !== undefined &&
    row.expandingSince !== null
  );
}

/** How many recent turns an expansion is told to read. */
export const EXPANSION_TURNS = 12;

/**
 * How long an expansion's write-up may run.
 *
 * A row in a list, not a document: past this nobody reads it and the row is
 * worse off than when it was one honest sentence.
 */
export const EXPANSION_WORD_CAP = 240;

/**
 * The user's own guidance, framed so an agent can tell whose voice it is.
 *
 * Two things are being sent at once — this plugin's harness and the user's
 * taste — and running them together makes the second read as more of the
 * first. The framing sentence is what keeps them apart, and it says exactly
 * how far the override reaches: over the advice, never over the commands. A
 * house style that could delete `bb follow-up amend` from the prompt would be
 * a settings field that silently turns the feature off.
 *
 * Returns null when there is nothing to add, so an empty setting costs the
 * prompt nothing at all.
 */
export function houseStyleBlock(
  houseStyle: string | null | undefined,
): string[] | null {
  const trimmed = (houseStyle ?? "").trim();
  if (trimmed === "") return null;
  return [
    "",
    "The user's own guidance for this, which overrides the advice above where",
    "the two disagree — but never the commands you were told to run:",
    trimmed,
  ];
}

/** What a caller may vary about an expansion. Every field falls back. */
export interface ExpansionOptions {
  /** Turns of parent context to read. */
  turns?: number;
  /** Word ceiling on the write-up. */
  wordCap?: number;
  /** The user's own guidance, appended where writing advice belongs. */
  houseStyle?: string | null;
}

/**
 * The prompt an expansion runs.
 *
 * A fresh thread that reads a bounded slice of the parent, not a fork of it.
 * The fork was tried first and was wrong for the reason that matters most: a
 * fork inherits the entire conversation, so it fails on exactly the long threads
 * where a jotted note most needs context. The first real one died on "Prompt is
 * too long" after two minutes. Reading `--limit` turns cannot do that.
 *
 * The note itself is passed in rather than read: it was typed into the composer
 * and recorded, so it never became a message and is in no transcript.
 *
 * Three prohibitions, each earning its line. Do not do the work — an agent
 * handed "expand this note about X" will otherwise go and do X. Do not touch the
 * text — the standing boundary, restated where it is under pressure. Say only
 * what the conversation supports — an expansion that speculates is worse than
 * the thin note it replaced, because it reads as established.
 */
export function expansionPrompt(
  row: FollowUp,
  parentThreadId: string,
  options: ExpansionOptions = {},
): string {
  const turns = options.turns ?? EXPANSION_TURNS;
  const wordCap = options.wordCap ?? EXPANSION_WORD_CAP;
  // Placed here rather than at the end: this is writing advice, and it belongs
  // beside the rest of the writing advice — after the word cap it may argue
  // with, and before the command it must not touch.
  const house = houseStyleBlock(options.houseStyle) ?? [];
  return [
    "You are a short-lived helper with one job: describe one follow-up more fully.",
    "",
    `The user jotted this note while working: "${row.text}"`,
    "",
    `Read the recent context first: bb thread log ${parentThreadId} --limit ${turns}`,
    "Read only that. Do not page further back — a bounded read is the point.",
    "",
    "Then write up what the note refers to and what a reader coming back in a",
    `month would need in order to act on it. Under ${wordCap} words — this is a note on`,
    "a row in a list, not a document; past that length nobody reads it and the",
    "row is worse off than when it was one honest sentence.",
    ...house,
    "",
    "Record it with one command:",
    `  bb follow-up amend ${row.id} --thread ${parentThreadId} --detail "<what you wrote>"`,
    "Add --file <path> when that context names the file or path it is about.",
    "",
    "Do not do the work the note describes. Do not change its text or its reason —",
    "the wording is the user's and is how they recognise the row. Say only what the",
    "context supports: a guess presented as detail is worse than the short note it",
    "replaced, because it reads as established fact. If the context does not tell",
    "you, amend nothing and stop.",
    "",
    "When you are done, run `bb thread archive --self` and stop.",
  ].join("\n");
}

/**
 * What to ask an agent to attach to a row the user wrote in a hurry.
 *
 * Only for rows the user wrote: an agent's own rows were recorded through a
 * tool that asks for a file and a detail, so a field missing there was a
 * decision rather than an omission. A note typed into the composer has no such
 * prompt behind it — the user is jotting, which is the point of jotting.
 *
 * Names only what is actually absent, because an agent told to "add context"
 * to a row that already has some will pad it.
 *
 * Returns null when there is nothing to ask, which is most rows.
 */
export function backfillRequest(row: FollowUp): string | null {
  if (authorOf(row) !== "user") return null;
  const wants: string[] = [];
  if (row.file === null || row.file === "") wants.push("the file or path it is about");
  if (row.detail === null || row.detail === "") wants.push("what a future reader would need to act on it");
  if (wants.length === 0) return null;
  return (
    `The user wrote this one as a quick note and it is missing ${wants.join(" and ")}. ` +
    "If your work here tells you, attach it with amend_follow_up — file and detail only. " +
    "Their wording stays theirs: it is how they recognise the row in the list, and " +
    "rewording it would bury whatever they meant that you have not understood yet."
  );
}

/** One @-mention as the host reports it in the structured draft. */
export interface DraftMention {
  provider: string;
  id: string;
  label: string;
}

/**
 * bb's own file mentions arrive under this provider, with the path as the id.
 *
 * Read out of the host's own mapping rather than guessed: a native mention's
 * `provider` is its kind, and for `path` the id is the path itself. Plugin
 * mentions use the plugin's id as the provider, so this cannot collide with
 * one — including this plugin's own follow-up pills.
 */
export const FILE_MENTION_PROVIDER = "path";

/**
 * The anchor a typed note carries, if it mentioned a file.
 *
 * First mention wins. A note naming two files has no single anchor and
 * guessing between them would be worse than the one the writer put first —
 * they are not ranked, and the row keeps both in its text either way.
 */
export function fileMentionOf(
  mentions: readonly DraftMention[],
): string | null {
  for (const mention of mentions) {
    if (mention.provider !== FILE_MENTION_PROVIDER) continue;
    const path = mention.id.trim();
    if (path !== "") return path;
  }
  return null;
}

/** How much of the surrounding message a captured selection keeps. */
export const CONTEXT_WINDOW = 600;

/**
 * The prose around a highlighted sentence, for a row that has no detail of its
 * own.
 *
 * A selection short enough to fit `TEXT_MAX` produces a row with nothing but a
 * sentence — which is the normal case, and the reason captured rows read as
 * thin. The message it came from is already in hand at that moment, so the
 * context costs nothing: no agent, no model, no second step, and it cannot be
 * wrong, because it is literally what was on screen.
 *
 * Bounded, not the whole message. An assistant message can run to thousands of
 * words of which one sentence mattered, and a detail that long is not context,
 * it is a second haystack.
 *
 * Returns null when there is nothing to add — the selection is the message, or
 * cannot be found in it (the visible text differs from what was highlighted).
 * Null rather than a guess: a row with no detail is honest.
 */
export function contextAround(
  messageText: string,
  selection: string,
): string | null {
  const message = messageText.trim();
  const needle = selection.trim();
  if (message === "" || needle === "") return null;
  const at = message.indexOf(needle);
  if (at === -1) return null;
  // Nothing surrounds it: the row already says everything the message did.
  if (needle.length >= message.length) return null;

  const half = Math.floor(CONTEXT_WINDOW / 2);
  const from = Math.max(0, at - half);
  const to = Math.min(message.length, at + needle.length + half);
  const window = message.slice(from, to).replace(/\s+/g, " ").trim();
  if (window === "" || window === needle) return null;
  const excerpt = `${from > 0 ? "…" : ""}${window}${to < message.length ? "…" : ""}`;
  return excerpt.slice(0, DETAIL_MAX);
}

/**
 * Turn highlighted prose into a follow-up.
 *
 * A selection is a paragraph, not a title: it carries newlines and usually
 * overruns TEXT_MAX. The one-line form becomes the row, and anything that did
 * not fit is kept as detail rather than thrown away — the selection is the
 * whole point of capturing this way.
 */
export function selectionToFollowUp(selection: string): CapturedSelection | null {
  const full = selection.trim();
  if (full === "") return null;
  const collapsed = full.replace(/\s+/g, " ");
  if (collapsed.length <= TEXT_MAX) return { text: collapsed };

  // Cut at a word boundary so the row does not end mid-word; fall back to a
  // hard cut for text with no spaces in the last quarter, such as a long path.
  const cut = collapsed.slice(0, TEXT_MAX - 1);
  const lastSpace = cut.lastIndexOf(" ");
  const head = lastSpace > TEXT_MAX * 0.75 ? cut.slice(0, lastSpace) : cut;
  return {
    text: `${head.trimEnd()}\u2026`,
    detail: full.slice(0, DETAIL_MAX),
  };
}

export type MatchResult =
  | { kind: "found"; row: FollowUp }
  | { kind: "ambiguous"; rows: FollowUp[] }
  | { kind: "none" };

/**
 * Find the row an agent means when it names a follow-up in words.
 *
 * Agents know what they fixed; they do not know eight-hex ids. Matching runs
 * on the same normalized key used for dedupe, so an agent that re-words its own
 * follow-up still lands on it. Exactness is tried first and ambiguity is never
 * guessed through: closing the wrong row would record a completion that never
 * happened, which is worse than making the caller ask again.
 */
export function matchFollowUp(
  list: readonly FollowUp[],
  needle: string,
): MatchResult {
  const key = normalizeKey(needle);
  if (key === "") return { kind: "none" };
  const byId = list.filter((row) => row.id === needle.trim());
  if (byId.length === 1) return { kind: "found", row: byId[0] as FollowUp };
  const exact = list.filter((row) => normalizeKey(row.text) === key);
  if (exact.length === 1) return { kind: "found", row: exact[0] as FollowUp };
  if (exact.length > 1) return { kind: "ambiguous", rows: exact };
  const partial = list.filter((row) => normalizeKey(row.text).includes(key));
  if (partial.length === 1) return { kind: "found", row: partial[0] as FollowUp };
  if (partial.length > 1) return { kind: "ambiguous", rows: partial };
  return { kind: "none" };
}

/** One row as an agent sees it: id first, because the id is what it acts on. */
export function formatForAgent(row: FollowUp): string {
  const reason = row.reason === null ? "" : `[${row.reason}] `;
  const parts = [`- ${row.id} ${reason}${row.text}`];
  if (row.file !== null && row.file !== "") parts.push(` (${row.file})`);
  if (isDone(row)) parts.push(" — done");
  else if (isInProgress(row)) parts.push(" — in progress, sent to you");
  return parts.join("");
}

/**
 * The list an agent reads. Plain lines rather than JSON: this is read by a
 * model, and every row it can act on needs its id visible.
 */
export function formatListForAgent(list: readonly FollowUp[]): string {
  if (list.length === 0) return "No follow-ups on this thread.";
  return list.map(formatForAgent).join("\n");
}

export function formatFollowUp(
  row: FollowUp,
  index: number,
  verbose = false,
): string {
  const where = row.file === null ? "" : `  (${row.file})`;
  // "[done by agent]" is not decoration: an agent-closed row is a claim to
  // check, and the CLI is where you check it.
  const state = row.doneAt
    ? `  [done${row.doneBy === "agent" ? " by agent" : ""}]`
    : row.sentAt
      ? "  [in progress]"
      : "";
  const reason = row.reason === null ? "" : `[${row.reason}] `;
  const head = `${String(index + 1).padStart(2)}. ${reason}${row.text}${where}${state}`;
  if (!verbose) return head;
  const body = [`      id: ${row.id}`];
  if (row.detail !== null && row.detail !== "") {
    body.push(...wrapDetail(row.detail));
  }
  if (row.doneNote !== null && row.doneNote !== undefined && row.doneNote !== "") {
    body.push(...wrapDetail(`closed: ${row.doneNote}`));
  }
  return [head, ...body].join("\n");
}

/** Wrap detail to a readable width so terminal output stays scannable. */
function wrapDetail(detail: string, width = 76): string[] {
  const words = detail.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line === "") {
      line = word;
    } else if (`${line} ${word}`.length <= width) {
      line = `${line} ${word}`;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line !== "") lines.push(line);
  return lines.map((entry) => `      ${entry}`);
}

export function formatList(list: readonly FollowUp[], verbose = false): string {
  if (list.length === 0) return "No follow-ups recorded for this thread.";
  return list
    .map((row, index) => formatFollowUp(row, index, verbose))
    .join(verbose ? "\n\n" : "\n");
}

export interface ReasonCount {
  reason: Reason;
  count: number;
}

/**
 * Reasons the rollup stays quiet about.
 *
 * Measured 2026-09-07 across every open row this plugin held: 6 of 11 were
 * user-written and carry no reason at all, and all 5 that had one were
 * `deferred`. Nothing had ever been out-of-scope, blocked, risk or cleanup. So
 * "5 deferred" was not a summary — it was the count again, minus the user's own
 * rows.
 *
 * `deferred` is the default answer, and it is tautological: a follow-up already
 * means "later". The other four each change what you would do next — blocked
 * and risk sharply, out-of-scope and cleanup by saying the work is real but not
 * urgent. A rollup earns its line by naming the exception, never the mode.
 */
export const ROLLUP_HIDDEN_REASONS: readonly Reason[] = ["deferred"];

/**
 * Counts per reason for the collapsed summary. Ordered by count descending so
 * the dominant category leads, with the declared REASONS order as a stable
 * tie-break — otherwise equal counts would reshuffle on every render.
 */
export function rollupByReason(list: readonly FollowUp[]): ReasonCount[] {
  const counts = new Map<Reason, number>();
  for (const row of list) {
    // Rows without a reason are simply absent from the rollup rather than
    // counted as a category — "3 unspecified" is not a summary of anything.
    if (row.reason === null) continue;
    if (ROLLUP_HIDDEN_REASONS.includes(row.reason)) continue;
    counts.set(row.reason, (counts.get(row.reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort(
      (a, b) =>
        b.count - a.count || REASONS.indexOf(a.reason) - REASONS.indexOf(b.reason),
    );
}

/** "2 risk, 1 blocked" — the collapsed banner's one-line summary, or "". */
export function formatRollup(list: readonly FollowUp[]): string {
  return rollupByReason(list)
    .map((entry) => `${entry.count} ${entry.reason}`)
    .join(", ");
}

/**
 * The prompt a handoff carries: the row's own record, optionally invoking a
 * skill on it.
 *
 * Plain text, not a mention pill. A pill resolves to agent context at send
 * time, which is right for "read this" but wrong here — the leading `/` has to
 * survive into the message for the skill to be recognised at all.
 *
 * A null skill is not a degraded handoff, it is the common one: most rows are
 * work for a fresh thread rather than an errand for `/file-issue`. The prompt
 * is then simply the follow-up, which is what a new thread needs anyway.
 */
export function handoffPrompt(skill: string | null, row: FollowUp): string {
  const anchor = row.file === null || row.file === "" ? "" : `\n\n${row.file}`;
  const detail =
    row.detail === null || row.detail === "" ? "" : `\n\n${row.detail}`;
  const invocation = skill === null ? "" : `/${skill} `;
  return `${invocation}${row.text}${anchor}${detail}`;
}

/**
 * A handoff that has come back and not yet been looked at.
 *
 * Deliberately not "done": the child reported, and this plugin has no way to
 * know whether the report is true. Both icon-change handoffs on this thread
 * make the point — one report was accurate and still worth checking, and the
 * other named a glyph whose name is a prefix of two other real ones, so a
 * near-miss would have read as success.
 */
/**
 * The row a parent gets when a child settles.
 *
 * Everything belonging to the child's own life is dropped rather than copied.
 * `sentAt` and the handoff fields describe what that child did with the row,
 * and `rank` is a position in a list this row has just left — carrying any of
 * them would make the parent's copy claim a history it does not have. Done rows
 * are not carried at all, which is the caller's job.
 */
export function carriedFromChild(
  row: FollowUp,
  childThreadId: string,
  id: string,
  at: string,
): FollowUp {
  return {
    id,
    text: row.text,
    reason: row.reason,
    file: row.file,
    detail: row.detail,
    createdAt: at,
    // Still an agent's observation, whichever thread it was made on.
    createdBy: "agent",
    inheritedFrom: childThreadId,
  };
}

export function needsReview(row: FollowUp): boolean {
  return (
    !isDone(row) &&
    (row.handoffState === "finished" || row.handoffState === "failed")
  );
}

/**
 * Is this thread cleared — worth offering something new, or archiving?
 *
 * Two terms, and the second is the one doing work. "No open rows" alone is also
 * true of every thread in bb that has never touched this plugin, and a card
 * above the composer of all of them is not an empty state, it is a nag. A
 * thread that never recorded a follow-up has genuinely nothing for this plugin
 * to say about what is left.
 *
 * `everRecorded` is the caller's to supply because it outlives the rows: see
 * `readEverRecorded` in server.ts, which keeps saying yes after Clear Done has
 * dropped the evidence.
 */
export function isCleared(
  rows: readonly FollowUp[],
  everRecorded: boolean,
): boolean {
  return everRecorded && rows.length === 0;
}

/**
 * Is a thread this one handed work to still running?
 *
 * Asked before archiving, because archiving takes child threads down with the
 * parent. Normally a running handoff keeps its row open and so cannot coexist
 * with an empty state at all — but a row marked done by hand takes its still-
 * running child with it, and that is exactly the case where losing the child
 * silently would cost the most.
 */
export function hasRunningHandoff(rows: readonly FollowUp[]): boolean {
  return rows.some((row) => row.handoffState === "running");
}

/**
 * Record what a handed-off child is doing, on whichever row sent it there.
 *
 * Returns `changed` so the caller can skip a write and a realtime publish for
 * an event that told it nothing — a child going idle several times over a
 * conversation is normal.
 */
export function markHandoffState(
  list: readonly FollowUp[],
  handoffThreadId: string,
  state: HandoffState,
): { list: FollowUp[]; changed: boolean } {
  let changed = false;
  const next = list.map((row) => {
    // A done row's disposition is settled; a late event from its child must not
    // reopen the question.
    if (row.handoffThreadId !== handoffThreadId || isDone(row)) return row;
    if (row.handoffState === state) return row;
    changed = true;
    return { ...row, handoffState: state };
  });
  return { list: changed ? next : [...list], changed };
}
