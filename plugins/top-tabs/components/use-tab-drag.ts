// Dragging a tab up or down the rail to reorder it.
//
// Dragging it out of the sidebar into the page opens a split. That is bb's
// own drag: each tab also spreads bb's `splitProps` (TabRail), which engage
// once the pointer leaves the sidebar, and bb sends Escape as it does so "to
// cancel a sidebar reorder". This drag listens for exactly that and puts the
// order back.
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { getState, update } from "../lib/store.ts";
import { moveBefore } from "../lib/tabs-model.ts";

/** Pointer travel before a press on a tab becomes a drag. */
const DRAG_THRESHOLD_PX = 5;

export interface LiveRail {
  shown: readonly string[];
}

interface DragState {
  id: string;
  dy: number;
}

/**
 * Drag a tab up or down to reorder. The order changes live as the dragged
 * tab's middle crosses a neighbour's, and the tab itself follows the pointer
 * between slots, so it never jumps out from under it.
 */
export function useTabDrag(tabRefs: { current: Map<string, HTMLElement> }, live: { current: LiveRail }) {
  const [state, setState] = useState<DragState | null>(null);
  const press = useRef<{
    id: string;
    pointerId: number;
    startY: number;
    startTop: number;
    order: readonly string[];
    moved: boolean;
  } | null>(null);
  const swallowClick = useRef(false);
  const cleanup = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanup.current?.(), []);

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>, id: string) => {
    if (event.button !== 0 || event.pointerType === "touch") return;
    const tab = tabRefs.current.get(id);
    if (tab === undefined) return;
    press.current = {
      id,
      pointerId: event.pointerId,
      startY: event.clientY,
      startTop: tab.offsetTop,
      order: getState().open,
      moved: false,
    };

    const onMove = (move: PointerEvent) => {
      const current = press.current;
      if (current === null || move.pointerId !== current.pointerId) return;
      const delta = move.clientY - current.startY;
      if (!current.moved && Math.abs(delta) < DRAG_THRESHOLD_PX) return;
      current.moved = true;
      const dragged = tabRefs.current.get(current.id);
      if (dragged === undefined) return;
      const middle = current.startTop + delta + dragged.offsetHeight / 2;
      // A tab moves among its own group only: dragging never pins or unpins.
      const { pinned } = getState();
      const group = pinned.includes(current.id);
      const before =
        live.current.shown.find((other) => {
          if (other === current.id || pinned.includes(other) !== group) return false;
          const el = tabRefs.current.get(other);
          return el !== undefined && el.offsetTop + el.offsetHeight / 2 > middle;
        }) ?? null;
      update((s) => moveBefore(s, current.id, before));
      // Follow the pointer from wherever the slot is now.
      setState({ id: current.id, dy: current.startTop + delta - dragged.offsetTop });
    };

    const onUp = (up: PointerEvent) => {
      const current = press.current;
      if (current === null || up.pointerId !== current.pointerId) return;
      if (current.moved) {
        // The click that ends a drag must not open the tab. It arrives right
        // after this event, or not at all if the pointer left the tab.
        swallowClick.current = true;
        window.setTimeout(() => {
          swallowClick.current = false;
        }, 0);
      }
      press.current = null;
      setState(null);
      stop();
    };

    const onCancel = () => {
      const current = press.current;
      if (current === null) return;
      if (current.moved) update((s) => ({ ...s, open: current.order }));
      press.current = null;
      setState(null);
      stop();
    };
    // Escape, from the user or from bb taking the drag over for a split.
    const onKeyDown = (key: KeyboardEvent) => {
      if (key.key !== "Escape") return;
      onCancel();
    };

    const stop = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      document.removeEventListener("keydown", onKeyDown, true);
      cleanup.current = null;
    };
    cleanup.current?.();
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    document.addEventListener("keydown", onKeyDown, true);
    cleanup.current = stop;
  };

  /** True once for the click that ends a drag, so dropping a tab does not open it. */
  const consumeClick = () => {
    const swallow = swallowClick.current;
    swallowClick.current = false;
    return swallow;
  };

  return { state, onPointerDown, consumeClick };
}
