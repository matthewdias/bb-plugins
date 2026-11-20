import { useCallback, useRef, useState } from "react";
import { armed, leaning, progress, release, type Direction } from "../lib/gesture";
import type { DeckActions } from "./card-actions";
import { haptic } from "./haptics";

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

/** Share the same thresholds and scroll handling between decks and previews. */
export function useCardSwipe(actions: Partial<DeckActions>, enabled: boolean, decide: (direction: Direction) => void) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const arming = useRef<Direction | null>(null);
  const reset = useCallback(() => {
    setDrag(null);
    arming.current = null;
  }, []);

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !enabled) return;
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
      if (now !== null && actions[now] !== undefined) haptic("selection");
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
    reset();
    if (decided !== null && actions[decided] !== undefined) decide(decided);
  }

  return {
    moving: drag?.moving === true,
    transform: drag?.moving ? `translate(${drag.dx}px, ${drag.dy}px) rotate(${drag.dx / 18}deg)` : "",
    direction: drag?.moving ? leaning(drag.dx, drag.dy) : null,
    amount: drag?.moving ? progress(drag.dx, drag.dy) : 0,
    reset,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: reset },
  };
}
