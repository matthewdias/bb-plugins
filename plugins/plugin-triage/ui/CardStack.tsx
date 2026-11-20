// The stack: the top card follows the pointer, and a release past the
// threshold sends it off in that direction before the decision is made. The
// arrow keys and the buttons below fly it the same way, so every route looks
// alike. Under it, the next card waits slightly smaller.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { keyCommand, type Direction } from "../lib/gesture";
import { CardActionButton, CardActionHint, DIRECTIONS, NEW_ACTIONS, SwipeStamp, type DeckActions } from "./card-actions";
import { haptic } from "./haptics";
import { useCardSwipe } from "./use-card-swipe";

/** How long a decided card takes to leave. */
const FLY_MS = 220;

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/** Ignore keys meant for a field, a menu, or anything that is not the page. */
export function typingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export interface CardStackProps<T extends { key: string }> {
  cards: readonly T[];
  render: (card: T, top: boolean) => ReactNode;
  onDecide: (card: T, direction: Direction) => void;
  onUndo: () => void;
  onDetails: () => void;
  /** False while another surface owns the keyboard. */
  keyboard?: boolean;
  /**
   * The top card's body scrolls (its details are open). Vertical touch then
   * pans it, and only a sideways press drags the card.
   */
  scrollable?: boolean;
  actions?: DeckActions;
  /** Whether the cards open details (Space) and close them (Escape). */
  details?: boolean;
}

export function CardStack<T extends { key: string }>({
  cards,
  render,
  onDecide,
  onUndo,
  onDetails,
  keyboard = true,
  scrollable = false,
  actions = NEW_ACTIONS,
  details = true,
}: CardStackProps<T>) {
  const top = cards[0] ?? null;
  const next = cards[1] ?? null;
  const [flying, setFlying] = useState<{ key: string; direction: Direction } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);

  const fly = useCallback(
    (direction: Direction) => {
      if (top === null || flying !== null) return;
      // A firmer thud for the install, the decision that changes something.
      haptic(direction === "right" ? "impact-medium" : "impact-light");
      if (reducedMotion()) {
        onDecide(top, direction);
        return;
      }
      setFlying({ key: top.key, direction });
      timer.current = setTimeout(() => {
        timer.current = null;
        setFlying(null);
        onDecide(top, direction);
      }, FLY_MS);
    },
    [flying, onDecide, top],
  );

  useEffect(() => {
    if (!keyboard) return;
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || typingTarget(event.target)) return;
      const command = keyCommand(event);
      if (command === null) return;
      if (command === "close") return;
      if (command === "details" && !details) return;
      // Space and Enter on a focused button are that button's.
      if (command === "details" && event.target instanceof HTMLButtonElement) return;
      event.preventDefault();
      if (command === "undo") onUndo();
      else if (command === "details") onDetails();
      else fly(command);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [details, fly, keyboard, onDetails, onUndo]);

  // Escape leaves the open details. bb also binds Escape on the Plugins
  // screen, to go back to the app, and does not check whether a key was
  // already handled; so while the details are open the deck takes Escape at
  // the window's capture phase, ahead of everything, and stops it there.
  // With the details closed Escape stays bb's. A gallery open over the
  // details closes first: its dialog needs the key.
  useEffect(() => {
    if (!keyboard || !scrollable) return;
    function onEscape(event: KeyboardEvent) {
      if (keyCommand(event) !== "close" || typingTarget(event.target)) return;
      if (document.querySelector("[data-triage-gallery]") !== null) return;
      event.preventDefault();
      event.stopPropagation();
      onDetails();
    }
    window.addEventListener("keydown", onEscape, { capture: true });
    return () => window.removeEventListener("keydown", onEscape, { capture: true });
  }, [keyboard, onDetails, scrollable]);

  const swipe = useCardSwipe(actions, top !== null && flying === null, fly);
  let transform = swipe.transform;
  let transition = swipe.moving ? "none" : "transform 180ms ease-out";
  const lean = flying?.direction ?? swipe.direction;
  const amount = flying === null ? swipe.amount : 1;
  if (flying !== null) {
    const off = { right: "translate(140%, 0) rotate(18deg)", left: "translate(-140%, 0) rotate(-18deg)", up: "translate(0, -140%)" };
    transform = off[flying.direction];
    transition = `transform ${FLY_MS}ms ease-in, opacity ${FLY_MS}ms ease-in`;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center gap-4">
      {/* On a phone bb opens its sidebar on a rightward swipe, and its side
          panel on a leftward one, from anywhere on the page. Both skip a
          touch that starts inside these markers, so the card keeps its drags. */}
      <div
        className="relative min-h-[360px] w-full max-w-md flex-1 sm:max-h-[620px]"
        data-no-sidebar-swipe=""
        data-no-secondary-panel-swipe=""
      >
        {next !== null && (
          <div
            key={next.key}
            className="absolute inset-0 origin-bottom transition-transform duration-200"
            // Peeks out under the top card, so the stack reads as a deck.
            style={{ transform: swipe.moving || flying !== null ? "translateY(4px) scale(0.98)" : "translateY(12px) scale(0.94)" }}
            aria-hidden
          >
            {render(next, false)}
          </div>
        )}
        {top !== null && (
          <div
            key={top.key}
            className={cn(
              "absolute inset-0 select-none",
              // touch-none holds every touch for the drag, which also stops the
              // browser scrolling the open details; pan-y gives it vertical back.
              scrollable ? "touch-pan-y" : "touch-none",
              swipe.moving ? "cursor-grabbing" : "cursor-grab",
            )}
            style={{ transform, transition, opacity: flying !== null ? 0 : 1 }}
            {...swipe.handlers}
            data-testid="top-card"
          >
            {render(top, true)}
            {lean !== null && <SwipeStamp direction={lean} amount={amount} label={actions[lean].label} />}
          </div>
        )}
      </div>

      <div className="flex w-full max-w-md shrink-0 flex-wrap items-center justify-center gap-1.5 pt-2" role="toolbar" aria-label="Decide">
        {DIRECTIONS.map((direction) => (
          <CardActionButton
            key={direction}
            direction={direction}
            action={actions[direction]}
            shortcut
            disabled={top === null || flying !== null}
            onClick={() => {
              swipe.reset();
              fly(direction);
            }}
          />
        ))}
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground"
          onClick={onUndo}
          aria-label="Undo (Z)"
          title="Undo (Z)"
        >
          <Icon name="RotateCcw" aria-hidden />
        </Button>
      </div>
      <CardActionHint actions={actions}>
        <span className="hidden [@media(hover:hover)_and_(pointer:fine)]:inline">
          {details && " · space details · esc close"} · Z undo
        </span>
      </CardActionHint>
    </div>
  );
}
