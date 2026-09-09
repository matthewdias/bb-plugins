// What the plugin says when there is nothing left to say about.
//
// One component for both surfaces, because the copy, the archive confirm and
// the routes onward are the actual content here — a second copy of them in the
// panel would be two things to keep in step and one of them would drift.
//
// Both surfaces render it identically. Every action here is either a server
// call or a navigation, so unlike the row-level insert action there is no
// composer to resolve and nothing for a thread panel to be missing.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  experimental_useSidebarThreadActions,
  useBbNavigate,
  useRpc,
  useSettings,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import { hasRunningHandoff, type FollowUp } from "../lib/followups.ts";
import { HANDOFF_PANEL_ACTION } from "./handoff.tsx";
import { dismissKeyboard } from "./keyboard.ts";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

/**
 * The entrance is `duration-[260ms]`, written literally at each class site
 * below because Tailwind cannot read a constant.
 *
 * Longer than the house 150ms in components/ui/motion.ts, and deliberately.
 * This is the plugin's only surface at the rare tier: it appears when a list
 * finishes, which happens once per list rather than once per turn, and it is
 * the one card meant to be stopped at and read rather than glanced past. It
 * also arrives into space the list it replaces has just vacated, so there is
 * nothing else moving for it to compete with. Everywhere else in this plugin is
 * occasional-or-worse and got 125-200ms.
 */

/**
 * The line lands, then the buttons. The card is a statement followed by
 * options, and offsetting the second says so — 70ms is enough to read as
 * sequence and short enough that the whole thing settles inside 330ms.
 */
const STAGGER_MS = 70;

/** An armed Archive disarms itself rather than sitting cocked. */
const DISARM_MS = 4000;

/**
 * Read at module scope so the condition in `useArchive` is constant for the
 * life of the app and the hook call below cannot appear and disappear between
 * renders. The guard is worth having: `experimental_` means a bb without this
 * API is allowed to exist, and an exception thrown from a composer banner takes
 * the whole card down rather than the one button that cannot work.
 */
const SIDEBAR_ACTIONS_AVAILABLE =
  typeof experimental_useSidebarThreadActions === "function";

function useArchive(): ((threadId: string) => void) | null {
  if (!SIDEBAR_ACTIONS_AVAILABLE) return null;
  const actions = experimental_useSidebarThreadActions();
  return typeof actions?.archive === "function"
    ? (threadId: string) => actions.archive(threadId)
    : null;
}

/**
 * "Suggest what's next" — ask this thread's own agent.
 *
 * This is the button the empty state exists for. The two it sits beside offer
 * somewhere to type; only this one answers the question the card raises, which
 * is what a suggestion has to mean if the word is going to be used at all.
 *
 * It sends rather than filling the draft, and it sends from the server: the
 * composer SDK has no "submit now" arm by design, so the client could only have
 * queued this on a countdown. The turn runs on the thread's own model, is
 * visible in the timeline, and can be stopped like any other — which is what
 * keeps "no background model call" true. The call is the user's.
 */
function SuggestNext({ threadId }: { threadId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const settings = useSettings();
  const [state, setState] = useState<"idle" | "busy" | "queued" | "failed">(
    "idle",
  );

  const ask = useCallback(async () => {
    setState("busy");
    try {
      const result = await rpc.call("followups_suggest_next", { threadId });
      // "sent" needs no acknowledgement: the thread starts running, which drops
      // this card from the banner and puts the answer in the timeline. Only the
      // two states that leave nothing on screen have to say anything.
      // "disabled" reads as idle rather than as an error: the only way to get
      // here is the setting being turned off between this card rendering and
      // the click, and nothing went wrong — the feature is simply off now.
      setState(
        result.outcome === "sent" || result.outcome === "disabled"
          ? "idle"
          : result.outcome,
      );
    } catch {
      setState("failed");
    }
  }, [rpc, threadId]);

  // Hidden, not disabled. A greyed button asks "why can I not press this?" of
  // a feature the user themselves switched off, and the empty state has a
  // second button to offer either way, so nothing is left looking broken.
  // `undefined` while the settings load means the button appears a beat late
  // rather than flickering off for anyone who turned it off.
  if (settings.values !== undefined && settings.values.offerSuggest === false) {
    return null;
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <Button
        variant="secondary"
        size="sm"
        className="h-7 gap-1.5 px-2 text-xs"
        disabled={state === "busy"}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => void ask()}
      >
        <Icon name="Brain" className="size-3.5" aria-hidden />
        Suggest what&rsquo;s next
      </Button>
      {state === "queued" && (
        <span className="text-[11px] text-muted-foreground">
          Queued behind the current turn.
        </span>
      )}
      {state === "failed" && (
        <span className="text-[11px] text-destructive">Could not ask.</span>
      )}
    </span>
  );
}

export function EmptyState({
  threadId,
  done,
  animate,
}: {
  threadId: string;
  /** The Done rows, read only to warn before archiving takes a child with it. */
  done: readonly FollowUp[];
  /**
   * True only for the clearing itself — the moment the last open row left.
   * False when the card is merely being rendered again: arriving at a thread
   * that was already empty, or coming back after a turn. Marking those the same
   * way would spend the rare tier on something that happens every turn.
   */
  animate: boolean;
}) {
  const navigate = useBbNavigate();
  const archive = useArchive();
  const [armed, setArmed] = useState(false);
  const disarmTimer = useRef<number | null>(null);

  // Entry is driven by flags rather than `@starting-style`, for the same reason
  // the banner's own card is: the slot stays mounted and returns null, so the
  // moment to animate is content arriving, not mount, and a frame has to pass
  // with the card at its start values before a transition has anything to run
  // from.
  const [shown, setShown] = useState(!animate);
  const [optionsShown, setOptionsShown] = useState(!animate);
  // Layout, not effect, and this is the whole reason it exists: `animate`
  // arrives true a beat *after* this mounted. The banner cannot know the list
  // emptied until the render that emptied it has committed, so the card is
  // already on screen at its final values by the time it is told it should have
  // animated. Pushing it back to the start values after paint would blink it
  // off for a frame; doing it before paint means the first thing drawn is the
  // start of the animation.
  useLayoutEffect(() => {
    if (!animate) return;
    setShown(false);
    setOptionsShown(false);
  }, [animate]);
  useEffect(() => {
    if (!animate) return;
    const frame = window.requestAnimationFrame(() => setShown(true));
    const timer = window.setTimeout(() => setOptionsShown(true), STAGGER_MS);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [animate]);

  const disarm = useCallback(() => {
    if (disarmTimer.current !== null) {
      window.clearTimeout(disarmTimer.current);
      disarmTimer.current = null;
    }
    setArmed(false);
  }, []);

  useEffect(() => () => disarm(), [disarm]);

  // Two steps, not a dialog. Archiving closes the pane you clicked from and
  // takes this thread's children with it, so it wants a beat — but a plugin
  // cannot reach bb's own confirm, and a hand-rolled modal over a card this
  // small would be heavier than the action.
  const onArchive = useCallback(() => {
    if (archive === null) return;
    if (!armed) {
      setArmed(true);
      disarmTimer.current = window.setTimeout(() => setArmed(false), DISARM_MS);
      return;
    }
    disarm();
    archive(threadId);
  }, [archive, armed, disarm, threadId]);

  const childRunning = hasRunningHandoff(done);

  return (
    <div className="flex min-w-0 flex-col gap-2 px-1 py-1">
      <p
        className={cn(
          "flex items-center gap-1.5 text-xs text-muted-foreground",
          "transition-[opacity,transform] ease-out duration-[260ms]",
          shown ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0",
          // Gentler, not off: the fade stays, the movement goes. Same trade the
          // banner's card makes.
          "motion-reduce:translate-y-0",
        )}
      >
        {/* The overshoot lives here and nowhere else. A card that bounces above
            a composer you may be typing into reads as a toy; a 14px tick that
            pops once reads as a tick landing. Same call the in-progress glyph
            makes in banner.tsx — one shot on the glyph, the row holds still. */}
        <Icon
          name="CircleCheck"
          className={cn(
            "size-3.5 shrink-0 text-foreground",
            "transition-transform ease-[cubic-bezier(0.34,1.56,0.64,1)] duration-[260ms]",
            shown ? "scale-100" : "scale-75",
            // `scale-100`, not `transform-none`. Tailwind v4 compiles `scale-*`
            // to the standalone `scale` property, which `transform: none` does
            // not reset — so the usual guard silently lets the overshoot run.
            "motion-reduce:scale-100",
          )}
          aria-hidden
        />
        {/* Word for word what the panel said before this card existed, so the
            two surfaces cannot come to describe the same state differently. */}
        Nothing outstanding on this thread.
      </p>
      <div
        className={cn(
          "flex flex-wrap items-center gap-1",
          "transition-[opacity,transform] ease-out duration-[260ms]",
          optionsShown ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0",
          "motion-reduce:translate-y-0",
        )}
      >
        <SuggestNext threadId={threadId} />
        {/* The handoff tab with no row attached: same composer, same project and
            checkout, no follow-up to mark. See handoff-panel.tsx. */}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            // The panel takes the screen; the keyboard should not fight it.
            dismissKeyboard();
            navigate.openThreadPanel({ actionId: HANDOFF_PANEL_ACTION });
          }}
        >
          <Icon name="Plus" className="size-3.5" aria-hidden />
          New thread
        </Button>
        {archive !== null && (
          <>
            <Button
              variant={armed ? "secondary" : "ghost"}
              size="sm"
              className={cn(
                "h-7 gap-1.5 px-2 text-xs",
                armed && "text-destructive",
              )}
              onMouseDown={(event) => event.preventDefault()}
              onClick={onArchive}
              aria-label={
                armed
                  ? childRunning
                    ? "Confirm archiving this thread — a handed-off thread is still running and will be archived too"
                    : "Confirm archiving this thread and its children"
                  : "Archive this thread"
              }
            >
              <Icon name="Archive" className="size-3.5" aria-hidden />
              {armed
                ? childRunning
                  ? "Archive — a handoff is still running?"
                  : "Archive this thread?"
                : "Archive"}
            </Button>
            {armed && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground"
                onMouseDown={(event) => event.preventDefault()}
                onClick={disarm}
              >
                Cancel
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
