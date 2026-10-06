// Reading bb's timeline DOM: which message a click landed on, which row the
// divider belongs above, and how to bring that row into the page.
//
// Every selector here is bb's private markup, verified against bb 0.45.0.
// bb renders only the rows near the viewport, so "not in the DOM" means
// "not on screen", never "not in the thread".
import {
  type MessageRole,
  type ModifierSetting,
  type ModifierState,
  parseRowId,
  type ReadPoint,
  turnRowPrefix,
} from "./read-point";

export const ROW = "[data-timeline-row-id]";
export const ROW_ID_ATTR = "data-timeline-row-id";
export const VIEWPORT = "[data-page-scroll-viewport]";
export const NATIVE_DIVIDER = '[data-testid="thread-unread-divider"]';

/** What a click on these belongs to, never to the message around it. */
const INTERACTIVE =
  'a, button, input, textarea, select, summary, label, [contenteditable=""], [contenteditable="true"], [role="button"], [role="link"], [role="menuitem"], [role="checkbox"], [role="tab"]';

export interface ClickedMessage {
  threadId: string;
  messageId: string;
  role: MessageRole;
  sourceSeqEnd: number | null;
}

export interface ClickLike extends ModifierState {
  button: number;
  target: EventTarget | null;
}

function rowId(row: Element): string {
  return row.getAttribute(ROW_ID_ATTR) ?? "";
}

function isTopLevel(row: Element): boolean {
  return row.parentElement?.closest(ROW) == null;
}

/**
 * The message a modifier-click marks, or null when the click is not one: wrong
 * modifier, not the main button, on a control inside the message, inside a
 * text selection, or on a row that is not a message (a command, a "Worked
 * for…" summary). Rows nest while a turn runs, so the nearest row that is a
 * message wins.
 */
export function resolveClick(
  event: ClickLike,
  modifier: ModifierSetting,
  matches: (setting: ModifierSetting, state: ModifierState) => boolean,
  selection: Selection | null,
): ClickedMessage | null {
  if (event.button !== 0 || !matches(modifier, event)) return null;
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return null;
  for (let row = target.closest(ROW); row; row = row.parentElement?.closest(ROW) ?? null) {
    const parsed = parseRowId(rowId(row));
    if (!parsed || parsed.kind === "other") continue;
    const control = target.closest(INTERACTIVE);
    if (control && row.contains(control)) return null;
    if (selection && !selection.isCollapsed && selection.anchorNode && row.contains(selection.anchorNode)) {
      return null;
    }
    return {
      threadId: parsed.threadId,
      messageId: rowId(row),
      role: parsed.kind,
      sourceSeqEnd: parsed.seq,
    };
  }
  return null;
}

function rowsOf(root: ParentNode, threadId: string): Element[] {
  return Array.from(root.querySelectorAll(ROW)).filter((row) => rowId(row).startsWith(`${threadId}:`));
}

function indexOf(row: Element): number {
  const value = Number(row.getAttribute("data-index"));
  return Number.isFinite(value) ? value : -1;
}

/**
 * The marked message's row, or null when it is not rendered. A message from
 * a turn that has since finished is folded into that turn's summary row, so
 * that row stands in for it.
 */
export function findMessageRow(root: ParentNode, point: ReadPoint): Element | null {
  const rows = rowsOf(root, point.threadId);
  const row = rows.find((candidate) => rowId(candidate) === point.messageId);
  if (row || point.role !== "assistant") return row ?? null;
  const turnId = parseRowId(point.messageId)?.turnId;
  if (!turnId) return null;
  const prefix = turnRowPrefix(point.threadId, turnId);
  return rows.find((candidate) => isTopLevel(candidate) && rowId(candidate).startsWith(prefix)) ?? null;
}

/**
 * The row the divider goes above, or null when it is not rendered: the
 * message's row, except that a message you sent is never unread to you, bb's
 * own rule, so the divider goes above whatever answered it.
 */
export function findTargetRow(root: ParentNode, point: ReadPoint): Element | null {
  const row = findMessageRow(root, point);
  if (!row || point.role !== "user") return row;
  const rows = rowsOf(root, point.threadId);
  const after = indexOf(row);
  if (after < 0) return null;
  return (
    rows
      .filter((candidate) => isTopLevel(candidate) && indexOf(candidate) > after)
      .sort((a, b) => indexOf(a) - indexOf(b))
      .find((candidate) => parseRowId(rowId(candidate))?.kind !== "user") ?? null
  );
}

/** The scroll container showing this thread's timeline, once it has rendered a row. */
export function findViewport(root: ParentNode, threadId: string): HTMLElement | null {
  for (const row of rowsOf(root, threadId)) {
    const viewport = row.closest<HTMLElement>(VIEWPORT);
    if (viewport) return viewport;
  }
  return null;
}

export type Direction = "up" | "down" | "both";

/**
 * Which way the marked message lies from what is on screen. Only the messages
 * you sent carry a sequence number in their ids, so with none of them on
 * screen, or no number on the point, it could be either way.
 */
export function searchDirection(root: ParentNode, point: ReadPoint): Direction {
  if (point.sourceSeqEnd === null) return "both";
  const seqs = rowsOf(root, point.threadId)
    .map((row) => parseRowId(rowId(row))?.seq)
    .filter((seq): seq is number => typeof seq === "number");
  if (seqs.length === 0) return "both";
  if (seqs.every((seq) => seq > point.sourceSeqEnd!)) return "up";
  if (seqs.every((seq) => seq < point.sourceSeqEnd!)) return "down";
  return "both";
}

export interface RevealOptions {
  find: () => Element | null;
  direction: Direction;
  signal: AbortSignal;
  /** Injected so tests need not wait out real frames. */
  wait?: (ms: number) => Promise<void>;
  maxSteps?: number;
}

const STEP_WAIT_MS = 120;
/** About 30s in all: a long thread pages in a few segments at a time. */
const MAX_STEPS = 250;
/**
 * How long nothing may move before a direction counts as exhausted. At the
 * top of a long thread bb is loading older rows, which can take a while over
 * a remote connection; the height grows when they land.
 */
const STALL_MS = 2500;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Scroll the viewport until `find` returns a row, then bring it to the top, as
 * bb does with its own divider: the composer can cover the lower half.
 *
 * bb holds a timeline pinned to its bottom and snaps a plain `scrollTop`
 * change back. A wheel event is what releases the pin, so each step sends one
 * before scrolling. The plugin cannot make a trusted one, but bb's listener
 * does not ask. Reaching the top of what is loaded is what makes bb load
 * older rows, so a pause there is waited out, not taken as the end.
 */
export async function revealRow(viewport: HTMLElement, options: RevealOptions): Promise<Element | null> {
  const wait = options.wait ?? sleep;
  const maxSteps = options.maxSteps ?? MAX_STEPS;
  const directions: Array<1 | -1> =
    options.direction === "up" ? [-1] : options.direction === "down" ? [1] : [-1, 1];
  let steps = 0;
  for (const sign of directions) {
    let stalledMs = 0;
    while (steps < maxSteps && stalledMs < STALL_MS) {
      if (options.signal.aborted) return null;
      const found = options.find();
      if (found) return bringToTop(viewport, found);
      const before = { top: viewport.scrollTop, height: viewport.scrollHeight };
      const delta = sign * Math.max(200, viewport.clientHeight * 0.8);
      viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: delta, bubbles: true, cancelable: true }));
      viewport.scrollBy({ top: delta });
      steps += 1;
      await wait(STEP_WAIT_MS);
      const moved = viewport.scrollTop !== before.top || viewport.scrollHeight !== before.height;
      stalledMs = moved ? 0 : stalledMs + STEP_WAIT_MS;
    }
  }
  if (options.signal.aborted) return null;
  const found = options.find();
  return found ? bringToTop(viewport, found) : null;
}

function bringToTop(viewport: HTMLElement, row: Element): Element {
  viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: -1, bubbles: true, cancelable: true }));
  row.scrollIntoView({ block: "start" });
  return row;
}
