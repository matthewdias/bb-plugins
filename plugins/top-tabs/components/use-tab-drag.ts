// Dragging a tab: sideways to reorder, down into the page to split.
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { ExperimentalSidebarNavigationSplit } from "@get-bb/plugin-sdk/app";
import { contentRect } from "../lib/shell.ts";
import { getState, update } from "../lib/store.ts";
import { moveBefore } from "../lib/tabs-model.ts";

/** Pointer travel before a press on a tab becomes a drag. */
const DRAG_THRESHOLD_PX = 5;
/** How far below the strip a dragged tab goes before it becomes a split. */
const SPLIT_HANDOFF_PX = 8;

export interface LiveStrip {
  shown: readonly string[];
  splits: ReadonlyMap<string, ExperimentalSidebarNavigationSplit>;
}

export interface SplitHooks {
  /** "Split with …" for the tab in view, or null when it cannot be split. */
  partnerLabelFor: (id: string) => string | null;
  splitWithPartner: (id: string) => void;
}

interface DragState {
  id: string;
  dx: number;
}

/** Where the partner will open, drawn while the tab in view is dragged down. */
export interface SplitPreview {
  label: string;
  rect: { left: number; top: number; width: number; height: number };
}

/**
 * Drag a tab sideways to reorder. The order changes live as the dragged tab's
 * centre crosses a neighbour's, and the tab itself follows the pointer
 * between slots, so it never jumps out from under it.
 *
 * Drag it down out of the strip instead and bb's own split gesture takes
 * over: drop zones, the pane cap, focusing a destination that is already
 * open. The order goes back to how it was before the drag.
 *
 * The tab in view is the exception. bb would only offer to focus the pane it
 * is already in, so the strip runs that drag itself: it previews the partner
 * opening beside the tab and splits on release.
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
    previewing: boolean;
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
      previewing: false,
    };

    const handOffToSplit = (current: NonNullable<typeof press.current>): boolean => {
      const split = live.current.splits.get(current.id);
      const begin = split?.isAvailable ? split.splitProps.onPointerDown : undefined;
      if (begin === undefined) return false;
      update((s) => ({ ...s, open: current.order }));
      press.current = null;
      setState(null);
      stop();
      // bb's gesture reads where the press began and the element it began
      // on, then follows the pointer itself. The press began a while ago, so
      // it engages on the next movement.
      begin({
        button: 0,
        clientX: current.startX,
        clientY: current.startY,
        currentTarget: current.source,
        target: current.source,
        pointerId: current.pointerId,
        preventDefault() {},
        stopPropagation() {},
      } as unknown as ReactPointerEvent<HTMLElement>);
      return true;
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
        const label = split.current.partnerLabelFor(current.id);
        const content = label === null ? null : contentRect();
        if (label !== null && content !== null) {
          if (!current.previewing) {
            current.previewing = true;
            update((s) => ({ ...s, open: current.order }));
            setState(null);
            const inset = 6;
            setPreview({
              label: `Split with ${label}`,
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
        if (handOffToSplit(current)) return;
      } else if (current.previewing) {
        // Back over the strip: it is a reorder again.
        current.previewing = false;
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
      if (current.previewing) split.current.splitWithPartner(current.id);
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
