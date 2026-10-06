// The stack: the top card follows the pointer, and a release past the
// threshold sends it off in that direction before the decision is made. The
// arrow keys and the buttons below fly it the same way, so every route looks
// alike. Under it, the next card waits slightly smaller.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { armed, keyCommand, leaning, progress, release, type Direction } from "../lib/gesture";
import { haptic } from "./haptics";

/** How long a decided card takes to leave. */
const FLY_MS = 220;

const LABELS: Record<Direction, { text: string; className: string }> = {
  right: { text: "Install", className: "left-4 top-4 -rotate-12 border-emerald-500 text-emerald-500" },
  left: { text: "Dismiss", className: "right-4 top-4 rotate-12 border-red-500 text-red-500" },
  up: { text: "Save", className: "bottom-24 left-1/2 -translate-x-1/2 border-sky-500 text-sky-500" },
};

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/** Ignore keys meant for a field, a menu, or anything that is not the page. */
function typingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

interface Drag {
  pointerId: number;
  startX: number;
  startY: number;
  dx: number;
  dy: number;
  lastX: number;
  lastT: number;
  velocity: number;
  /** Past the slop: the card follows the pointer and the press is no tap. */
  moving: boolean;
  /** Began on a scrolling body, where up means scroll, not save. */
  fromScroll: boolean;
}

/** How far a press travels before it is a drag rather than a tap. */
const SLOP = 6;

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
}

export function CardStack<T extends { key: string }>({
  cards,
  render,
  onDecide,
  onUndo,
  onDetails,
  keyboard = true,
  scrollable = false,
}: CardStackProps<T>) {
  const top = cards[0] ?? null;
  const next = cards[1] ?? null;
  const [drag, setDrag] = useState<Drag | null>(null);
  const [flying, setFlying] = useState<{ key: string; direction: Direction } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The direction the current drag would decide, for the tick on arming. */
  const arming = useRef<Direction | null>(null);

  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);

  const fly = useCallback(
    (direction: Direction) => {
      if (top === null || flying !== null) return;
      setDrag(null);
      arming.current = null;
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
      // Space and Enter on a focused button are that button's.
      if (command === "details" && event.target instanceof HTMLButtonElement) return;
      event.preventDefault();
      if (command === "undo") onUndo();
      else if (command === "details") onDetails();
      else fly(command);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fly, keyboard, onDetails, onUndo]);

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

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || flying !== null) return;
    const target = event.target as HTMLElement;
    // Controls keep their clicks. A [data-tap] control (the screenshot) is a
    // tap until the press moves, and a drag after that.
    if (target.closest("a, input, textarea, select") || (target.closest("button") && !target.closest("[data-tap]"))) return;
    arming.current = null;
    setDrag({
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      dx: 0,
      dy: 0,
      lastX: event.clientX,
      lastT: event.timeStamp,
      velocity: 0,
      moving: false,
      fromScroll: target.closest("[data-scroll]") !== null,
    });
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (drag === null || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    let moving = drag.moving;
    if (!moving) {
      if (Math.hypot(dx, dy) < SLOP) return;
      // A press that sets off up or down the details is a scroll. Let it go:
      // the browser pans (touch-action allows it) and cancels the pointer.
      if (drag.fromScroll && Math.abs(dy) > Math.abs(dx)) {
        setDrag(null);
        return;
      }
      // Capturing only now leaves a plain tap to reach the control under it.
      event.currentTarget.setPointerCapture(event.pointerId);
      moving = true;
    }
    const dt = Math.max(1, event.timeStamp - drag.lastT);
    const effectiveDy = drag.fromScroll ? 0 : dy;
    // A tick as the card crosses into deciding, and again if it swings over
    // to another decision; letting it fall back is silent.
    const now = armed(dx, effectiveDy);
    if (now !== arming.current) {
      if (now !== null) haptic("selection");
      arming.current = now;
    }
    setDrag({
      ...drag,
      dx,
      dy: effectiveDy,
      lastX: event.clientX,
      lastT: event.timeStamp,
      velocity: Math.abs(event.clientX - drag.lastX) / dt,
      moving,
    });
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (drag === null || event.pointerId !== drag.pointerId) return;
    const decided = release(drag.dx, drag.dy, drag.velocity);
    if (decided === null) setDrag(null);
    else fly(decided);
  }

  let transform = "";
  let transition = "transform 180ms ease-out";
  let lean: Direction | null = null;
  let amount = 0;
  if (flying !== null) {
    const off = { right: "translate(140%, 0) rotate(18deg)", left: "translate(-140%, 0) rotate(-18deg)", up: "translate(0, -140%)" };
    transform = off[flying.direction];
    transition = `transform ${FLY_MS}ms ease-in, opacity ${FLY_MS}ms ease-in`;
    lean = flying.direction;
    amount = 1;
  } else if (drag !== null && drag.moving) {
    transform = `translate(${drag.dx}px, ${drag.dy}px) rotate(${drag.dx / 18}deg)`;
    transition = "none";
    lean = leaning(drag.dx, drag.dy);
    amount = progress(drag.dx, drag.dy);
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
            style={{ transform: (drag !== null && drag.moving) || flying !== null ? "translateY(4px) scale(0.98)" : "translateY(12px) scale(0.94)" }}
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
              drag?.moving ? "cursor-grabbing" : "cursor-grab",
            )}
            style={{ transform, transition, opacity: flying !== null ? 0 : 1 }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => setDrag(null)}
            data-testid="top-card"
          >
            {render(top, true)}
            {lean !== null && (
              <span
                className={cn(
                  "pointer-events-none absolute rounded-md border-2 bg-card/80 px-3 py-1 text-lg font-bold uppercase tracking-wide",
                  LABELS[lean].className,
                )}
                style={{ opacity: amount }}
              >
                {LABELS[lean].text}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Three columns, so dismiss, save and install sit dead centre under
          the card and undo, smaller, hangs off to their left. */}
      <div
        className="grid w-full max-w-md shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-4 pt-2"
        role="toolbar"
        aria-label="Decide"
      >
        <Button
          variant="outline"
          size="round"
          className="size-10 justify-self-end text-muted-foreground"
          onClick={onUndo}
          aria-label="Undo (Z)"
        >
          <Icon name="RotateCcw" aria-hidden />
        </Button>
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            size="round"
            className="size-14 text-red-500"
            onClick={() => fly("left")}
            disabled={top === null}
            aria-label="Dismiss (←)"
          >
            <Icon name="X" className="size-6" aria-hidden />
          </Button>
          <Button
            variant="outline"
            size="round"
            className="text-sky-500"
            onClick={() => fly("up")}
            disabled={top === null}
            aria-label="Save for later (↑)"
          >
            <Icon name="Clock" aria-hidden />
          </Button>
          <Button
            variant="outline"
            size="round"
            className="size-14 text-emerald-500"
            onClick={() => fly("right")}
            disabled={top === null}
            aria-label="Install (→)"
          >
            <Icon name="Download" className="size-6" aria-hidden />
          </Button>
        </div>
      </div>
      {/* Keys mean nothing on a touchscreen. */}
      <p className="hidden shrink-0 text-xs text-muted-foreground [@media(hover:hover)_and_(pointer:fine)]:block">
        ← dismiss · ↑ save · → install · space details · esc close · Z undo
      </p>
    </div>
  );
}
