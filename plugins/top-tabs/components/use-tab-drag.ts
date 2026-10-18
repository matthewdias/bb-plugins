// Dragging a tab: sideways to reorder, down into the page to split.
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { contentRect } from "../lib/shell.ts";
import { getState, update } from "../lib/store.ts";
import { moveBefore } from "../lib/tabs-model.ts";

/** Pointer travel before a press on a tab becomes a drag. */
const DRAG_THRESHOLD_PX = 5;
/** How far below the strip a dragged tab goes before it becomes a split. */
const SPLIT_HANDOFF_PX = 8;

export interface LiveStrip {
  shown: readonly string[];
}

export interface SplitHooks {
  /** "Split with …" for the tab in view, or null when it cannot be split. */
  partnerLabelFor: (id: string) => string | null;
  splitWithPartner: (id: string) => void;
  /** Whether a tab not in view can open in a pane beside the focused one. */
  canBeInPane: (id: string) => boolean;
  openInSplit: (id: string) => void;
}

interface DragState {
  id: string;
  dx: number;
}

/** Where the split will open, drawn while a tab is dragged down into the page. */
export interface SplitPreview {
  label: string;
  rect: { left: number; top: number; width: number; height: number };
}

/** What a tab dragged into the page does on release. */
type Drop = "partner" | "self";

/**
 * Drag a tab sideways to reorder. The order changes live as the dragged tab's
 * centre crosses a neighbour's, and the tab itself follows the pointer
 * between slots, so it never jumps out from under it.
 *
 * Drag it down out of the strip instead to open it in a split. bb 0.46 no
 * longer lends plugins its split gesture for destinations, so the strip runs
 * the drag itself: it previews the new pane on the right half of the page,
 * where bb puts a split, and opens it there on release. The order goes back
 * to how it was before the drag.
 *
 * The tab in view is already on screen, so dragging it down opens its split
 * partner beside it instead.
 */
export function useTabDrag(
  tabRefs: { current: Map<string, HTMLElement> },
  live: { current: LiveStrip },
  stripRef: { current: HTMLElement | null },
  split: { current: SplitHooks },
) {
  const [state, setState] = useState<DragState | null>(null);
  const [preview, setPreview] = useState<SplitPreview | null>(null);
  const press = useRef<{
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    startLeft: number;
    order: readonly string[];
    source: HTMLElement;
    moved: boolean;
    previewing: Drop | null;
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
      startX: event.clientX,
      startY: event.clientY,
      startLeft: tab.offsetLeft,
      order: getState().open,
      source: event.currentTarget,
      moved: false,
      previewing: null,
    };


    const onMove = (move: PointerEvent) => {
      const current = press.current;
      if (current === null || move.pointerId !== current.pointerId) return;
      const delta = move.clientX - current.startX;
      if (!current.moved && Math.abs(delta) < DRAG_THRESHOLD_PX && Math.abs(move.clientY - current.startY) < DRAG_THRESHOLD_PX) {
        return;
      }
      current.moved = true;
      const stripBottom = stripRef.current?.getBoundingClientRect().bottom ?? Infinity;
      if (move.clientY > stripBottom + SPLIT_HANDOFF_PX) {
        const partner = split.current.partnerLabelFor(current.id);
        const drop: Drop | null =
          partner !== null ? "partner" : split.current.canBeInPane(current.id) ? "self" : null;
        const content = drop === null ? null : contentRect();
        if (drop !== null && content !== null) {
          if (current.previewing !== drop) {
            current.previewing = drop;
            update((s) => ({ ...s, open: current.order }));
            setState(null);
            const inset = 6;
            setPreview({
              label: drop === "partner" ? `Split with ${partner}` : "Open in split",
              rect: {
                left: content.left + content.width / 2,
                top: content.top + inset,
                width: content.width / 2 - inset,
                height: content.height - inset * 2,
              },
            });
          }
          return;
        }
      } else if (current.previewing !== null) {
        // Back over the strip: it is a reorder again.
        current.previewing = null;
        setPreview(null);
      }

      const dragged = tabRefs.current.get(current.id);
      if (dragged === undefined) return;
      const centre = current.startLeft + delta + dragged.offsetWidth / 2;
      // A tab moves among its own group only: dragging never pins or unpins.
      const { pinned } = getState();
      const group = pinned.includes(current.id);
      const before =
        live.current.shown.find((other) => {
          if (other === current.id || pinned.includes(other) !== group) return false;
          const el = tabRefs.current.get(other);
          return el !== undefined && el.offsetLeft + el.offsetWidth / 2 > centre;
        }) ?? null;
      update((s) => moveBefore(s, current.id, before));
      // Follow the pointer from wherever the slot is now.
      setState({ id: current.id, dx: current.startLeft + delta - dragged.offsetLeft });
    };

    const onUp = (up: PointerEvent) => {
      const current = press.current;
      if (current === null || up.pointerId !== current.pointerId) return;
      if (current.previewing === "partner") split.current.splitWithPartner(current.id);
      if (current.previewing === "self") split.current.openInSplit(current.id);
      setPreview(null);
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
      setPreview(null);
      stop();
    };
    const onKeyDown = (key: KeyboardEvent) => {
      if (key.key !== "Escape") return;
      key.preventDefault();
      onCancel();
    };

    const stop = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKeyDown, true);
      cleanup.current = null;
    };
    cleanup.current?.();
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKeyDown, true);
    cleanup.current = stop;
  };

  /** True once for the click that ends a drag, so dropping a tab does not open it. */
  const consumeClick = () => {
    const swallow = swallowClick.current;
    swallowClick.current = false;
    return swallow;
  };

  return { state, preview, onPointerDown, consumeClick };
}
