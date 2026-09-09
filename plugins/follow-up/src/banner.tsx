import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  useBbNavigate,
  useComposer,
  useComposerView,
  useRpc,
  useSettings,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import {
  formatRollup,
  isCleared,
  isInProgress,
  needsReview,
  isExpanding,
  expansionGaveUp,
  type FollowUp,
  type Reason,
} from "../lib/followups.ts";
import {
  setAutoCollapseAt,
  setCollapsed,
  setRows,
  toggleCollapsed,
  toggleShowDone,
} from "./store.ts";
import { dismissKeyboard } from "./keyboard.ts";
import { FollowUpSortable, useSortableRow } from "./sortable.tsx";
import { threadIdFromScope } from "./scope.ts";
import { useFollowUps } from "./use-follow-ups.ts";
import { HandoffAction } from "./handoff.tsx";
import { EmptyState } from "./empty-state.tsx";
import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";
import { usePortalScopeProps } from "@/lib/portal-scope";
import { cn } from "@/lib/utils";

/**
 * One glyph per reason, so the row's leading column costs ~1rem instead of the
 * 5.5rem a text chip needed. The word itself moves into the tooltip — it is
 * secondary to the follow-up text, and was repeating down the whole list.
 */
const REASON_ICON: Record<Reason, IconName> = {
  "out-of-scope": "Limitation",
  blocked: "Pause",
  deferred: "Clock",
  risk: "AlertTriangle",
  cleanup: "Clean",
};

/**
 * Pill text. Follow-up text runs to 240 characters, which would render as an
 * unusable pill, so the label is truncated — and the same string is what the
 * inserted check looks for in the draft.
 */
const PILL_LABEL_MAX = 48;
export function pillLabel(text: string): string {
  return text.length <= PILL_LABEL_MAX
    ? text
    : `${text.slice(0, PILL_LABEL_MAX - 1).trimEnd()}\u2026`;
}

/**
 * The detail tooltip, in its own component so the entry flag resets each time
 * it opens rather than once for the life of the banner.
 *
 * Entry only. Closing stays instant on purpose — `schedulePeek(null)` sets the
 * state synchronously so that passing over rows on the way somewhere else can
 * never leave a tooltip trailing behind the pointer. Fading the exit would put
 * that back, which is why this breaks the usual enter-and-leave-the-same-way
 * rule.
 */
function PeekCard({
  peek,
  portalProps,
}: {
  peek: { row: FollowUp; rect: DOMRect };
  portalProps: Record<string, unknown>;
}) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setShown(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return createPortal(
    <div
      {...portalProps}
      role="tooltip"
      style={{
        position: "fixed",
        left: peek.rect.left,
        width: peek.rect.width,
        bottom: window.innerHeight - peek.rect.top + 6,
      }}
      className={cn(
        "pointer-events-none z-[60] max-h-48 overflow-hidden rounded-md border border-border bg-popover px-3 py-2 text-xs leading-relaxed text-popover-foreground shadow-lg",
        // Short, because this has already made the reader wait 700ms for it.
        "transition-[opacity,transform] duration-[125ms] ease-out",
        shown ? "translate-y-0 opacity-100" : "translate-y-0.5 opacity-0",
        "motion-reduce:translate-y-0",
      )}
    >
      {peek.row.detail}
    </div>,
    document.body,
  );
}

function FollowUpRow({
  row,
  threadId,
  onInsert,
  onDismiss,
  onDone,
  busy,
  inserted,
  flash,
  showDetail,
  hoverActions,
  active,
  onEnter,
  onPeek,
  onEdit,
  onCancelExpand,
  onExpand,
}: {
  row: FollowUp;
  threadId: string;
  onCancelExpand: () => void;
  onExpand: () => void;
  onInsert: () => void;
  onDismiss: () => void;
  onDone: () => void;
  busy: boolean;
  inserted: boolean;
  /** True for one beat after this row becomes in progress. */
  flash: boolean;
  showDetail: boolean;
  hoverActions: boolean;
  active: boolean;
  onEnter: (id: string | null) => void;
  onPeek: (row: FollowUp | null) => void;
  onEdit: () => void;
}) {
  const { setNodeRef, style, handleProps, isDragging, anyDragging } = useSortableRow(
    row.id,
  );
  // Null unless this row was recorded on a child thread and carried up.
  const inheritedFrom = row.inheritedFrom ?? null;
  const expanding = isExpanding(row);
  const gaveUp = expansionGaveUp(row);
  // Read per row rather than threaded down from the banner: `useSettings` is a
  // subscription to a value the host already holds, and one more prop on a
  // component that takes seventeen of them is the more expensive of the two.
  // `!== false` so the button survives the first render, before the values
  // arrive — the alternative flickers it in for everyone.
  const offerDescribe = useSettings().values?.offerDescribe !== false;
  // No detail tooltip mid-drag: the rows are moving, so it would describe
  // whichever row happened to slide under the cursor.
  const hasDetail =
    showDetail && !anyDragging && row.detail !== null && row.detail !== "";

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "group flex min-w-0 items-start gap-1.5 px-1 py-1.5",
        // Opaque only while lifted: a transparent row would show the rows
        // sliding underneath it.
        isDragging && "rounded bg-card shadow-sm ring-1 ring-border",
      )}
      onMouseEnter={() => {
        if (anyDragging) return;
        onEnter(row.id);
        if (hasDetail) onPeek(row);
      }}
      onMouseLeave={() => {
        onEnter(null);
        onPeek(null);
      }}
      // React's onFocus bubbles, so focusing the text inside still reaches here.
      onFocus={() => hasDetail && onPeek(row)}
      onBlur={() => onPeek(null)}
    >
      {/* The handle keeps its width whether or not it is showing, so revealing
          it on hover does not shove the row sideways. Dragging is handle-only:
          a drag starting anywhere on the row would fight the list's own scroll
          on touch. */}
      <button
        type="button"
        {...handleProps}
        className={cn(
          "-ml-0.5 mt-0.5 flex size-4 shrink-0 touch-none items-center justify-center rounded text-muted-foreground",
          "focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          isDragging ? "cursor-grabbing opacity-100" : "cursor-grab",
          hoverActions && !active && !isDragging ? "opacity-0" : "opacity-60",
        )}
        aria-label={`Reorder "${row.text}"`}
      >
        <Icon name="DragDropVertical" className="size-3.5" aria-hidden />
      </button>
      {/* No fixed width: the glyphs sit flush left and the text follows
          immediately. A fixed column kept the text edge straight but left a
          hole on single-glyph rows, and with 14px icons the raggedness it was
          protecting against is ~16px — not the ~70px it was with word chips. */}
      {/* Rendered only when there is a glyph to show. A row you wrote yourself
          has no reason, and an empty span would still take the row's gap and
          leave the text sitting further right than its neighbours. */}
      {(row.reason !== null ||
        isInProgress(row) ||
        inserted ||
        expanding ||
        gaveUp ||
        inheritedFrom !== null) && (
        <span
          title={[
            row.reason,
            row.handoffState === "failed"
              ? "the thread this was handed to failed"
              : row.handoffState === "finished"
                ? "handed-off thread finished — check it before closing this"
                : isInProgress(row)
                  ? "in progress — a prompt referencing this was sent"
                  : null,
            inserted ? "in the composer" : null,
            expanding ? "being described by a helper thread" : null,
            gaveUp
              ? `a helper looked at this and left it as it was${row.expandedBy === null || row.expandedBy === undefined ? "" : ` — read ${row.expandedBy}`}`
              : null,
            inheritedFrom === null
              ? null
              : `carried up from child thread ${inheritedFrom}`,
          ]
            .filter((part) => part !== null)
            .join(" · ")}
          className="mt-0.5 flex shrink-0 items-center gap-1 text-muted-foreground"
        >
          <span className="sr-only">
            {row.reason ?? ""}
            {row.handoffState === "failed"
              ? ", handoff failed"
              : row.handoffState === "finished"
                ? ", handoff finished, needs checking"
                : isInProgress(row)
                  ? ", in progress"
                  : ""}
            {inserted ? ", in the composer" : ""}
            {expanding ? ", being described" : ""}
            {gaveUp ? ", a helper could not describe it" : ""}
            {inheritedFrom === null ? "" : ", carried up from a child thread"}
          </span>
          {/* The reason stays muted; the two state glyphs do not. A reason is
              a property of the row, but "out with an agent" and "in the
              composer" are things happening right now, and at 12px inside a
              muted cluster they were indistinguishable from the label beside
              them. Contrast, not motion — see the note on `flash` below. */}
          {row.reason !== null && (
            <Icon name={REASON_ICON[row.reason]} className="size-3.5" aria-hidden />
          )}
          {/* Three states, not two. A child that has come back is neither
              "out with an agent" nor finished — it is waiting to be checked,
              and the plugin cannot tell you more than that: a child going idle
              is its own report of itself. */}
          {isInProgress(row) && (
            <Icon
              name={
                row.handoffState === "failed"
                  ? "AlertCircle"
                  : row.handoffState === "finished"
                    ? "BellDot"
                    : "Sent"
              }
              className={cn(
                "size-3 transition-transform duration-150 ease-out",
                row.handoffState === "failed"
                  ? "text-destructive"
                  : "text-foreground",
                // One shot, when the row becomes in progress. It is a state
                // change you did not necessarily watch happen — the banner may
                // have been collapsed when the prompt went — so the glyph
                // announces itself once and then holds still.
                flash ? "scale-150" : "scale-100",
                // `scale-100`, not `transform-none`: Tailwind v4 compiles
                // `scale-*` to the standalone `scale` property, which
                // `transform: none` does not reset, so this pulse ran under
                // reduced motion for as long as the guard has been here.
                "motion-reduce:scale-100",
              )}
              aria-hidden
            />
          )}
          {/* Deliberately not animated: this toggles as you edit the draft, so
              it would fire while you type — the same reason the record-draft
              action does not animate in. */}
          {inserted && (
            <Icon name="EditFile" className="size-3 text-foreground" aria-hidden />
          )}
          {/* The one glyph here that is genuinely live, so it is the one that
              gets the host's running treatment. Without it, pressing expand
              looked identical to pressing record — which is how a helper that
              died went unnoticed for an hour. */}
          {/* State, not a control. It was briefly both — the spinner itself was
              the cancel button — and nothing about a spinner says "click me",
              so the way out was invisible. This cluster reports what is true of
              the row; the verbs live on the right with every other verb. */}
          {expanding && (
            <Icon name="Spinner" className="size-3 text-foreground" aria-hidden />
          )}
          {/* Muted, and deliberately not `AlertCircle`: nothing is wrong with
              the row, a helper simply had nothing to add. Loud would be worse
              than silent here — it would read as an error the user must fix. */}
          {gaveUp && <Icon name="Brain" className="size-3" aria-hidden />}
          {/* Muted like the reason, not lit like the state glyphs: where a row
              was recorded is a property of it, not something happening now. */}
          {inheritedFrom !== null && (
            <Icon name="ArrowTurnBackward" className="size-3.5" aria-hidden />
          )}
        </span>
      )}
      <span
        className={cn(
          "min-w-0 flex-1 break-words text-sm leading-[1.4]",
          inserted && "text-muted-foreground",
          hasDetail && "cursor-help",
        )}
        tabIndex={hasDetail ? 0 : undefined}
      >
        {row.text}
        {row.file !== null && (
          <span className="ml-1.5 break-words text-xs text-muted-foreground">
            {row.file}
          </span>
        )}
      </span>
      {/* Driven by a single hovered-row state rather than CSS `group-hover`.
          With group-hover several rows kept their actions up at once and then
          cleared together on the next render — the browser was holding stale
          :hover on rows the pointer had left. One state value cannot describe
          two rows, so that cannot happen. `focus-within` still covers keyboard,
          and touch keeps them permanently visible. */}
      <span
        className={cn(
          "flex shrink-0 items-center gap-0.5 focus-within:opacity-100",
          hoverActions ? (active ? "opacity-100" : "opacity-0") : "opacity-60",
        )}
      >
        {/* Button deliberately omits `title`, so the native tooltip lives on a
            wrapper. The glyph says what happens — the row joins the message
            being written — rather than which way it travels to get there. */}
        {/* One slot, two states: describe this, or stop describing it. Offered
            only on a row with no detail — that is what an expansion is for, and
            a sixth permanent action on every row would cost more than it
            returns. A row a helper gave up on has no detail by definition, so
            it keeps the button and can be asked again. */}
        {offerDescribe && !expanding && (row.detail === null || row.detail === "") && (
          <span title="Describe this in more detail" className="inline-flex">
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground"
              disabled={busy}
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                event.stopPropagation();
                onExpand();
              }}
              aria-label={`Describe "${row.text}" in more detail`}
            >
              <Icon name="Brain" className="size-3.5" />
            </Button>
          </span>
        )}
        {expanding && (
          <span title="Stop describing this" className="inline-flex">
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground hover:text-destructive"
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                event.stopPropagation();
                onCancelExpand();
              }}
              aria-label={`Stop describing "${row.text}"`}
            >
              <Icon name="Square" className="size-3.5" />
            </Button>
          </span>
        )}
        <span
          title={
            inserted
              ? "Already in the composer — send to hand it to the agent"
              : "Put this in the composer"
          }
          className="inline-flex"
        >
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            disabled={busy || inserted}
            onMouseDown={(event) => event.preventDefault()}
            onClick={onInsert}
            aria-label={
              inserted
                ? `"${row.text}" is already in the composer`
                : `Put "${row.text}" in the composer`
            }
          >
            <Icon name="MessageSquarePlus" className="size-3.5" />
          </Button>
        </span>
        <HandoffAction row={row} />
        {/* Editing happens in the panel: a 240-character text and its detail
            do not fit a row this size, and the panel already renders both. */}
        <span title="Edit in the panel" className="inline-flex">
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            disabled={busy}
            onMouseDown={(event) => event.preventDefault()}
            onClick={onEdit}
            aria-label={`Edit "${row.text}" in the panel`}
          >
            <Icon name="Edit" className="size-3.5" />
          </Button>
        </span>
        <span title="Mark done" className="inline-flex">
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            disabled={busy}
            onMouseDown={(event) => event.preventDefault()}
            onClick={onDone}
            aria-label={`Mark "${row.text}" done`}
          >
            <Icon name="Check" className="size-3.5" />
          </Button>
        </span>
        <span
          title="Dismiss — it will not be recorded again on this thread"
          className="inline-flex"
        >
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground"
            disabled={busy}
            onMouseDown={(event) => event.preventDefault()}
            onClick={onDismiss}
            aria-label={`Dismiss "${row.text}" — it will not be recorded again on this thread`}
          >
            <Icon name="X" className="size-3.5" />
          </Button>
        </span>
      </span>
    </li>
  );
}

/**
 * The record of what was finished, in its own component so both of the card's
 * two states can carry it.
 *
 * It belongs under the empty state as much as under the list: "nothing
 * outstanding" is a claim, and the done rows are the evidence for it. Extracted
 * rather than duplicated because a second copy of this markup would be a second
 * place for the reopen and dismiss affordances to drift apart.
 */
function DoneSection({
  done,
  showDone,
  busy,
  onToggleShowDone,
  onClearDone,
  onReopen,
  onDismiss,
}: {
  done: FollowUp[];
  showDone: boolean;
  busy: boolean;
  onToggleShowDone: () => void;
  onClearDone: () => void;
  onReopen: (row: FollowUp) => void;
  onDismiss: (row: FollowUp) => void;
}) {
  return (
    <div className="flex flex-col gap-1 px-1 pt-1">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onToggleShowDone()}
          className="flex shrink-0 items-center gap-1 text-left"
          aria-expanded={showDone}
          aria-label={`${showDone ? "Hide" : "Show"} the ${done.length} done follow-ups`}
        >
          {/* Down to open, up to close: unlike the banner's own collapse,
              this content really does appear directly below. */}
          <Icon
            name={showDone ? "ChevronUp" : "ChevronDown"}
            className="size-3 text-muted-foreground"
          />
          <span className="text-xs text-muted-foreground">{done.length} done</span>
        </button>
        {/* A rule on the same line as the count, so the expanded section
            reads as its own region rather than more rows. */}
        <span
          aria-hidden
          className={cn("h-px flex-1", showDone ? "bg-border" : "bg-transparent")}
        />
        <span title="Clear Done" className="inline-flex shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs text-muted-foreground"
            disabled={busy}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void onClearDone()}
            aria-label="Clear the done follow-ups"
          >
            Clear
          </Button>
        </span>
      </div>
      {showDone && (
        <ul className="flex max-h-32 min-w-0 flex-col overflow-y-auto overscroll-contain">
          {done.map((row) => (
            <li key={row.id} className="flex items-start gap-2 py-1 pl-4">
              <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-1">
                <span className="min-w-0 break-words text-xs text-muted-foreground line-through">
                  {row.text}
                </span>
                {/* Who closed it, because an agent's "done" is a claim and
                    the user's is a decision. The note it gave is the thing
                    to check, so it is the tooltip. */}
                {row.doneBy === "agent" && (
                  <span
                    title={row.doneNote ?? "Closed by the agent"}
                    className="shrink-0 cursor-help text-[10px] uppercase tracking-wide text-muted-foreground/70"
                  >
                    agent
                  </span>
                )}
              </span>
              {/* Icons, matching the open rows above: a text button was
                  the widest thing in the section and pulled the eye to the
                  one part of the card that is a record rather than a list
                  of things to do. */}
              <span title="Reopen" className="inline-flex shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-5 text-muted-foreground"
                  disabled={busy}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => void onReopen(row)}
                  aria-label={`Reopen "${row.text}"`}
                >
                  <Icon name="ArrowTurnBackward" className="size-3" />
                </Button>
              </span>
              {/* Per-row dismissal, because Clear was all-or-nothing: one
                  row you never want to see again meant either keeping it
                  or discarding the whole record with it. Same tombstone as
                  dismissing an open row, so the text cannot come back. */}
              <span title="Dismiss" className="inline-flex shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-5 text-muted-foreground"
                  disabled={busy}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => void onDismiss(row)}
                  aria-label={`Dismiss "${row.text}"`}
                >
                  <Icon name="X" className="size-3" />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function FollowUpBanner() {
  const view = useComposerView();
  const composer = useComposer();
  const rpc = useRpc<typeof rpcContract>();
  const threadId = threadIdFromScope(view.scope);
  // This banner is the plugin's only composer surface, so it owns fetching. It
  // shrinks to a summary line rather than unmounting, which is what makes that
  // possible — see use-follow-ups.ts.
  const { rows, done, collapsed, showDone, everRecorded, reload } =
    useFollowUps(threadId);
  // Reactive: a pill removed from the draft clears the row's inserted state.
  // This is a text match against the pill label rather than a structural read —
  // the SDK exposes the draft as plain text, so there is no mention list to
  // consult. Editing the pill's text breaks the match, which is the known
  // sharp edge of doing it this way.
  const draftText = view.draft.text;
  const isCompact = useIsCompactViewport();
  const navigate = useBbNavigate();
  // The collapse threshold is a setting, but the store that applies it is
  // module scope with no hooks to read one — `derive` runs inside a
  // `useSyncExternalStore` selector and `toggleCollapsed` is an event handler.
  // So the banner, which is mounted for the life of the composer whether or not
  // it renders anything, pushes the value in.
  const settings = useSettings();
  useEffect(() => {
    const configured = settings.values?.autoCollapseAt;
    if (typeof configured === "number") setAutoCollapseAt(configured);
  }, [settings.values]);
  const [busy, setBusy] = useState(false);
  const [peeked, setPeeked] = useState<{ row: FollowUp; rect: DOMRect } | null>(
    null,
  );
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const portalProps = usePortalScopeProps();
  const peekTimer = useRef<number | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  // Entry is driven by a flag rather than `@starting-style`, because the card
  // is not mounting — the slot stays mounted for the life of the composer and
  // returns null until this thread has something to show. So the moment to
  // animate is content arriving, not mount, and a frame has to pass with the
  // card at its start values before the transition has anything to run from.
  const rollup = formatRollup(rows);
  const returned = rows.filter(needsReview).length;
  // In progress means still out; a returned handoff has its own count, because
  // one is waiting on an agent and the other is waiting on you.
  const inProgress = rows.filter(
    (row) => isInProgress(row) && !needsReview(row),
  ).length;
  // Counted for the header because the banner collapses itself past four rows,
  // which is exactly when a spinner on a row nobody can see is no signal at all
  // — the state was invisible here while the panel showed it.
  const expandingCount = rows.filter(isExpanding).length;
  const hasContent = rows.length > 0 || done.length > 0;
  // The empty state, and the two things that keep it from being a nag.
  //
  // `isCleared` carries the first: a thread that never recorded a follow-up has
  // nothing for this plugin to say about what is left, so it stays silent
  // rather than putting a card above the composer of every thread in bb. The
  // second is here because it is about the composer rather than the rows —
  // "nothing outstanding, archive this?" is wrong advice while the agent is
  // still working, and it would arrive mid-turn as often as not.
  const running = view.run.isRunning;
  const cleared = isCleared(rows, everRecorded) && !running;
  // What the card's own entrance keys off. `hasContent` alone stopped being the
  // answer the moment the card could also be showing nothing: a fully cleared
  // thread has neither list, and the card would have sat at opacity zero.
  const visible = hasContent || cleared;

  // Which rows became in progress since the last render, so the glyph can
  // announce itself once. Seeded on the first pass rather than compared against
  // an empty set — otherwise every already-sent row would flash on mount, which
  // is the opposite of marking a change.
  const seenInProgress = useRef<Set<string> | null>(null);
  const [flashing, setFlashing] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const now = new Set(rows.filter(isInProgress).map((entry) => entry.id));
    const previous = seenInProgress.current;
    seenInProgress.current = now;
    if (previous === null) return;
    const fresh = [...now].filter((id) => !previous.has(id));
    if (fresh.length === 0) return;
    setFlashing(new Set(fresh));
    // Up for 150ms, then back down for 150ms as the class comes off — the
    // press-feedback band, and it happens once rather than repeating.
    const timer = window.setTimeout(() => setFlashing(new Set()), 150);
    return () => window.clearTimeout(timer);
  }, [rows]);
  // Did the last open row just leave? Seeded on the first pass rather than
  // compared against zero, so arriving at a thread that was already empty shows
  // the card settled instead of playing an arrival that did not happen. Same
  // shape as the in-progress seeding above, and the reason the empty state's
  // longer beat can honestly be called rare: without this it would replay at
  // every turn end for as long as the list stayed empty.
  const hadOpenRows = useRef<boolean | null>(null);
  const [justCleared, setJustCleared] = useState(false);
  useEffect(() => {
    const has = rows.length > 0;
    const previous = hadOpenRows.current;
    hadOpenRows.current = has;
    if (has) {
      setJustCleared(false);
      return;
    }
    if (previous === true) setJustCleared(true);
  }, [rows]);
  // Spent once, and a turn starting is what spends it. The card hides while the
  // agent works and comes back when it stops — but a turn ending on a thread
  // that was already empty is not a clearing, and without this the flag would
  // survive to greet every one of them with the entrance that belongs to the
  // moment the list actually emptied.
  useEffect(() => {
    if (running) setJustCleared(false);
  }, [running]);

  const [shown, setShown] = useState(visible);
  useEffect(() => {
    if (!visible) {
      setShown(false);
      return;
    }
    const frame = window.requestAnimationFrame(() => setShown(true));
    return () => window.cancelAnimationFrame(frame);
  }, [visible]);

  const schedulePeek = useCallback((row: FollowUp | null) => {
    if (peekTimer.current !== null) {
      window.clearTimeout(peekTimer.current);
      peekTimer.current = null;
    }
    // Closing is immediate; only opening waits, so passing over rows on the
    // way somewhere else never flashes a tooltip. The wait is long — reading
    // a row's text takes a moment, and the pointer rests there while you do
    // it, so a short delay fired at people who were not asking for detail.
    if (row === null) {
      setPeeked(null);
      return;
    }
    peekTimer.current = window.setTimeout(() => {
      // Measured at open time, not hover time, and against the card rather
      // than the row: the popup sits above the whole banner, so it overlaps
      // the timeline behind it instead of the rows being read. It also stops
      // jumping from row to row — only its text changes now.
      const rect = cardRef.current?.getBoundingClientRect();
      if (rect === undefined) return;
      setPeeked({ row, rect });
    }, 700);
  }, []);

  useEffect(
    () => () => {
      if (peekTimer.current !== null) window.clearTimeout(peekTimer.current);
    },
    [],
  );

  const threadIdRef = useRef(threadId);
  const rpcRef = useRef(rpc);
  const rowsRef = useRef(rows);
  const doneRef = useRef(done);
  threadIdRef.current = threadId;
  rpcRef.current = rpc;
  rowsRef.current = rows;
  doneRef.current = done;

  // Optimistic first: the rows are already where the user dropped them, so
  // waiting for the server would drag them back for a frame.
  const commitOrder = useCallback((orderedIds: string[], movedId: string) => {
    const target = threadIdRef.current;
    if (target === null) return;
    const byId = new Map(rowsRef.current.map((entry) => [entry.id, entry]));
    const reordered = orderedIds
      .map((id) => byId.get(id))
      .filter((entry): entry is FollowUp => entry !== undefined);
    setRows(target, reordered, doneRef.current);
    void (async () => {
      try {
        const result = await rpcRef.current.call("followups_reorder", {
          threadId: target,
          orderedIds,
          movedId,
        });
        if (threadIdRef.current === target) {
          setRows(target, result.followUps, result.done);
        }
      } catch {
        // Nothing else fetches now that the pill is gone, so ask again
        // rather than leaving an optimistic edit standing as the truth.
        reload();
      }
    })();
  }, [reload]);

  const ids = rows.map((entry) => entry.id);

  // A mention pill, not plain text: it survives editing, never clobbers a draft
  // the way setText did, and resolves the whole record — including `detail` —
  // into agent context at send time. Sending is also what marks the row sent,
  // so inserting and then deleting the pill costs nothing.
  const insert = useCallback(
    (row: FollowUp) => {
      composer.insertMention({
        provider: "follow-up",
        id: `${threadIdRef.current}.${row.id}`,
        label: pillLabel(row.text),
      });
      composer.focus();
      // Inserting is a statement that this is the one being worked on next,
      // which is what the top of the list means — so it is a real reorder,
      // through the same path a drag takes, not a display-only sort. A sort
      // would have diverged from the stored rank, and the next drag would
      // have committed that divergence as permanent rank without anyone
      // asking for it.
      const current = rowsRef.current;
      if (current.length > 1 && current[0]?.id !== row.id) {
        commitOrder(
          [row.id, ...current.filter((entry) => entry.id !== row.id).map((entry) => entry.id)],
          row.id,
        );
      }
      // The row is at the top now, which is off-screen if the list was
      // scrolled down — so the feedback for having inserted it would be
      // invisible exactly when the list is long enough to need it.
      listRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    },
    [composer, commitOrder],
  );

  const dismiss = useCallback(
    async (row: FollowUp) => {
      const target = threadIdRef.current;
      if (target === null) return;
      setBusy(true);
      // Optimistic: the row leaves immediately, and the server response is the
      // authority if they disagree. Both lists, because a done row can be
      // dismissed too — filtering only the open list left it on screen until
      // the round trip came back.
      setRows(
        target,
        rows.filter((entry) => entry.id !== row.id),
        done.filter((entry) => entry.id !== row.id),
      );
      try {
        const result = await rpcRef.current.call("followups_dismiss", {
          threadId: target,
          id: row.id,
        });
        if (threadIdRef.current === target) setRows(target, result.followUps, result.done);
      } catch {
        // Nothing else fetches now that the pill is gone, so ask again
        // rather than leaving an optimistic edit standing as the truth.
        reload();
      } finally {
        setBusy(false);
      }
    },
    [rows, done, reload],
  );

  const expandRow = useCallback(
    async (row: FollowUp) => {
      const target = threadIdRef.current;
      if (target === null) return;
      try {
        await rpcRef.current.call("followups_expand", { threadId: target, id: row.id });
      } finally {
        // Either way the row's state changed on the server — it is now marked
        // as being described, or marked as having failed to start.
        reload();
      }
    },
    [reload],
  );

  const cancelExpand = useCallback(
    async (row: FollowUp) => {
      const target = threadIdRef.current;
      if (target === null) return;
      try {
        const result = await rpcRef.current.call("followups_expand_cancel", {
          threadId: target,
          id: row.id,
        });
        if (threadIdRef.current === target) setRows(target, result.followUps, result.done);
      } catch {
        reload();
      }
    },
    [reload],
  );

  const markDone = useCallback(
    async (row: FollowUp, next: boolean) => {
      const target = threadIdRef.current;
      if (target === null) return;
      setBusy(true);
      try {
        const result = await rpcRef.current.call("followups_done", {
          threadId: target,
          id: row.id,
          done: next,
        });
        if (threadIdRef.current === target) setRows(target, result.followUps, result.done);
      } catch {
        // Nothing else fetches now that the pill is gone, so ask again
        // rather than leaving an optimistic edit standing as the truth.
        reload();
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  const clearDone = useCallback(async () => {
    const target = threadIdRef.current;
    if (target === null) return;
    setBusy(true);
    try {
      await rpcRef.current.call("followups_clear_done", { threadId: target });
      const result = await rpcRef.current.call("followups_list", { threadId: target });
      if (threadIdRef.current === target) setRows(target, result.followUps, result.done);
    } catch {
      // Nothing else fetches now that the pill is gone, so ask again
      // rather than leaving an optimistic edit standing as the truth.
      reload();
    } finally {
      setBusy(false);
    }
  }, [reload]);

  if (threadId === null || !visible) return null;

  return (
    <div
      ref={cardRef}
      className={cn(
        "flex w-full min-w-0 max-w-full flex-col overflow-hidden px-2.5",
        // Collapsed the card holds one line, so it should not carry the
        // padding a list needs. Cleared it is not collapsed — there is no list
        // behind it to open — so it takes the roomier pair.
        collapsed && !cleared ? "gap-0 py-1" : "gap-1.5 py-2",
        // The card is the one surface here that materialises beside the
        // cursor: an agent records something mid-turn, realtime fires, and a
        // block of UI arrives above the composer you are typing in. 150ms is
        // the house duration from components/ui/motion.js.
        "transition-[opacity,transform,padding] duration-150 ease-out",
        shown ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0",
        // Gentler, not off: the fade stays, the movement goes.
        "motion-reduce:translate-y-0",
      )}
    >
      {cleared ? (
        <>
          {/* No collapse wrapper and no header. There is no list behind this to
              open, and a "0 follow-ups" line above a card that already says
              nothing is outstanding would state the same fact twice — once in
              the negative. */}
          <EmptyState
            threadId={threadId}
            done={done}
            animate={justCleared}
          />
          {done.length > 0 && (
            <DoneSection
              done={done}
              showDone={showDone}
              busy={busy}
              onToggleShowDone={() => toggleShowDone(threadId)}
              onClearDone={() => void clearDone()}
              onReopen={(row) => void markDone(row, false)}
              onDismiss={(row) => void dismiss(row)}
            />
          )}
        </>
      ) : (
        <>
        {/* Portaled to the body and positioned `fixed`, so it takes no layout
            space and is not clipped by the scrolling list. An in-flow strip grew
            the banner, which shifted rows under the cursor and re-triggered hover
            on a different row. `pointer-events-none` keeps it from stealing the
            hover that is keeping it open — and, now that it sits above the whole
            card, from swallowing clicks meant for the timeline behind it. */}
        {peeked !== null && <PeekCard peek={peeked} portalProps={portalProps} />}
        {/* Siblings, not nested: a Button inside the header button would be
            invalid HTML. The summary text stays clickable, and the chevron is the
            explicit affordance. */}
        <div className="flex w-full min-w-0 shrink-0 items-center gap-1.5 px-1">
          {/* Leading, before the plugin's own glyph: this is a disclosure
              triangle, and a disclosure triangle sits at the start of the row it
              opens. Trailing, among the action buttons, it read as one more
              action rather than the row's own state. Right when closed, down
              when open — the same pair the done section below already uses, and
              the reason it is no longer up/down is that there is nothing above
              to point at. */}
          <span title={collapsed ? "Show" : "Collapse"} className="inline-flex shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="size-5"
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                event.stopPropagation();
                // Expanding needs the screen the keyboard is occupying.
                if (isCompact && collapsed) dismissKeyboard();
                toggleCollapsed(threadId);
              }}
              aria-expanded={!collapsed}
              aria-label={`${collapsed ? "Show" : "Hide"} the follow-up list`}
            >
              <Icon
                name={collapsed ? "ChevronRight" : "ChevronDown"}
                className="size-3.5 text-muted-foreground"
              />
            </Button>
          </span>
          <Icon name="TextWrap" className="size-3 shrink-0 text-muted-foreground" />
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.stopPropagation();
              if (isCompact && collapsed) dismissKeyboard();
              toggleCollapsed(threadId);
            }}
            className="flex min-w-0 flex-1 items-baseline gap-1.5 text-left"
            aria-label={`${collapsed ? "Show" : "Hide"} the follow-up list`}
          >
            <span className="shrink-0 text-xs font-medium text-muted-foreground">
              {rows.length} follow-up{rows.length === 1 ? "" : "s"}
            </span>
            {/* The rollup was a `title` on the old composer pill: invisible until
                hover, and unreachable on touch. A full-width summary line has the
                room to just say it — when there is anything to say. It is empty
                whenever every row is user-written or deferred, which is the
                common case, and a bare "·" is worse than no rollup. */}
            {rollup !== "" && (
              <span className="truncate text-xs text-muted-foreground/70">
                · {rollup}
              </span>
            )}
          </button>
          {/* In progress belongs here in both states, unlike done: there is no
              in-progress section to carry it when expanded, and once the list
              scrolls the glyphs on the rows are not visible either. Collapsed it
              is the only trace that work is out with an agent. */}
          {expandingCount > 0 && (
            <span
              title={`${expandingCount} being described by a helper thread`}
              className="flex shrink-0 items-center gap-0.5 text-foreground"
            >
              <Icon name="Spinner" className="size-3" aria-hidden />
              <span className="text-xs tabular-nums">{expandingCount}</span>
              <span className="sr-only">being described</span>
            </span>
          )}
          {returned > 0 && (
            <span
              title={`${returned} handed-off thread${returned === 1 ? " has" : "s have"} finished — check before closing`}
              className="flex shrink-0 items-center gap-0.5 text-foreground"
            >
              <Icon name="BellDot" className="size-3" aria-hidden />
              <span className="text-xs tabular-nums">{returned}</span>
              <span className="sr-only">handed off and back, needs checking</span>
            </span>
          )}
          {inProgress > 0 && (
            <span
              title={`${inProgress} in progress — a prompt referencing ${inProgress === 1 ? "it" : "them"} was sent`}
              className="flex shrink-0 items-center gap-0.5 text-foreground"
            >
              <Icon name="Sent" className="size-3" aria-hidden />
              <span className="text-xs tabular-nums">{inProgress}</span>
              <span className="sr-only">in progress</span>
            </span>
          )}
          {/* Collapsed, the done count has nowhere else to appear — expanded, the
              section below carries it, and repeating it here is noise. */}
          {collapsed && done.length > 0 && (
            <span
              title={`${done.length} done`}
              className="flex shrink-0 items-center gap-0.5 text-muted-foreground"
            >
              <Icon name="Check" className="size-3" aria-hidden />
              <span className="text-xs tabular-nums">{done.length}</span>
            </span>
          )}
          {/* The panel is otherwise only reachable through the panel's own
              new-tab launcher, so you had to know it existed. On mobile it is
              also the only path to detail, since hover cannot work on touch. */}
          <span title="Open the follow-ups panel" className="inline-flex shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                event.stopPropagation();
                // The panel takes the screen; the keyboard should not fight it.
                dismissKeyboard();
                // The panel is the same list with more room, so leaving the
                // banner expanded behind it just says everything twice and takes
                // space from the composer you are about to type in.
                setCollapsed(threadId, true);
                navigate.openThreadPanel({ actionId: "followups" });
              }}
              aria-label="Open the follow-ups panel"
            >
              <Icon name="ArrowUpRight" className="size-3.5 text-muted-foreground" />
            </Button>
          </span>
        </div>
        {/* Collapse animates as a grid row going 1fr → 0fr, not as height going
            to auto: `height: auto` is not interpolable without `interpolate-size`,
            and this has to work in a browser tab as well as the desktop app. The
            cost is that the list stays mounted while collapsed — at zero height
            inside `overflow-hidden`, so it has no hit area — where before it
            unmounted. That is what makes the transition possible at all: there
            is nothing to animate from if the content is not there.
            Sized in rem, not vh: the cap should track how many ROWS are visible,
            not how tall the window happens to be. ~13rem is about five rows given
            the mix of one- and two-line text. */}
        <div
          className={cn(
            "grid overflow-hidden transition-[grid-template-rows] duration-200 ease-out",
            collapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]",
            // The one animation here that moves layout rather than paint, so it
            // is the one worth switching off outright when motion is unwelcome.
            "motion-reduce:transition-none",
          )}
          // `inert`, not `aria-hidden`. The list is no longer unmounted when
          // collapsed, just squeezed to zero height — so every button in it is
          // still in the tab order, reachable and invisible. `aria-hidden` alone
          // would hide it from a screen reader while leaving it focusable, which
          // is worse than either. `inert` does both.
          inert={collapsed}
        >
          {/* `min-h-0` so the row can actually shrink to 0fr, and the gap the
              card used to provide between the list and the done section now that
              they share one grid child. */}
          <div className="flex min-h-0 flex-col gap-1.5">
        <FollowUpSortable
          ids={ids}
          onCommit={commitOrder}
          // `anyDragging` only stops a new peek from being scheduled. One that
          // is already open, or one whose 700ms timer is still running, would
          // otherwise sit over the list for the whole drag — describing a row
          // that has since moved.
          onDragStart={() => schedulePeek(null)}
        >
          <ul
            ref={listRef}
            className="flex max-h-52 min-w-0 flex-col divide-y divide-border/50 overflow-y-auto overscroll-contain"
          >
            {rows.map((row) => (
            <FollowUpRow
              key={row.id}
              row={row}
              busy={busy}
              inserted={draftText.includes(pillLabel(row.text))}
              flash={flashing.has(row.id)}
              showDetail={!isCompact}
              hoverActions={!isCompact}
              threadId={threadId}
              onInsert={() => insert(row)}
              onDismiss={() => void dismiss(row)}
              onDone={() => void markDone(row, true)}
              active={hoveredId === row.id}
              onEnter={setHoveredId}
              onPeek={schedulePeek}
              onCancelExpand={() => void cancelExpand(row)}
              onExpand={() => void expandRow(row)}
              onEdit={() => {
                dismissKeyboard();
                // Same reasoning as the header's panel button: every route from
                // this banner into the panel hands the list over to it.
                setCollapsed(threadId, true);
                navigate.openThreadPanel({
                  actionId: "followups",
                  params: { edit: row.id },
                });
              }}
            />
            ))}
          </ul>
        </FollowUpSortable>
        {done.length > 0 && (
          <DoneSection
            done={done}
            showDone={showDone}
            busy={busy}
            onToggleShowDone={() => toggleShowDone(threadId)}
            onClearDone={() => void clearDone()}
            onReopen={(row) => void markDone(row, false)}
            onDismiss={(row) => void dismiss(row)}
          />
        )}
          </div>
        </div>
        </>
      )}
    </div>
  );
}
