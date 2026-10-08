// The card on a phone or a coarse pointer: a drawer from the bottom of the
// screen, like bb's own composer popups.
//
// The vendored drawer (components/ui/responsive-overlay.tsx) has one height
// and drags only down, to dismiss. This one has two: half height is compact,
// full height is expanded. Dragging its top edge settles on the nearer of the
// two, or closes it when let go low enough; the mode toggle on that edge does
// the same in one tap. Swipe down or tap outside to dismiss. Focus, Escape and
// the backdrop are the vendored drawer's, reused rather than rebuilt.
import { useCallback, useRef, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePersistentOverlayFocus } from "@/components/ui/responsive-overlay";
import type { Mode } from "../lib/card-state";
import { DRAWER_FULL, DRAWER_HALF, snapDrawer } from "../lib/placement";
import { usePortalScopeProps } from "../lib/portal-scope";

const EASING = "cubic-bezier(0.32, 0.72, 0, 1)";

function heightFor(mode: Mode): string {
  return `${Math.round((mode === "expanded" ? DRAWER_FULL : DRAWER_HALF) * 100)}dvh`;
}

interface Drag {
  pointerId: number;
  startY: number;
  startHeight: number;
}

export function SummaryDrawer({
  open,
  onClose,
  mode,
  onMode,
  controls,
  children,
}: {
  open: boolean;
  onClose: () => void;
  mode: Mode;
  onMode: (mode: Mode) => void;
  /** Sits on the drawer's top edge, beside the handle. */
  controls: ReactNode;
  children: ReactNode;
}) {
  const scope = usePortalScopeProps();
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const requestClose = useCallback(() => onCloseRef.current(), []);

  usePersistentOverlayFocus({ open, panelRef, requestClose });

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || panelRef.current === null) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: panelRef.current.getBoundingClientRect().height,
    };
    panelRef.current.style.transition = "none";
    event.preventDefault();
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const panel = panelRef.current;
    if (drag === null || panel === null || drag.pointerId !== event.pointerId) return;
    const height = Math.min(
      window.innerHeight * DRAWER_FULL,
      Math.max(0, drag.startHeight - (event.clientY - drag.startY)),
    );
    panel.style.height = `${height}px`;
    event.preventDefault();
  };

  const onPointerEnd = (event: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const drag = dragRef.current;
    const panel = panelRef.current;
    if (drag === null || panel === null || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    const height = panel.getBoundingClientRect().height;
    panel.style.transition = "";
    panel.style.height = "";
    if (cancelled) return;
    const settled = snapDrawer(height, window.innerHeight);
    if (settled === "close") onCloseRef.current();
    else onMode(settled === "full" ? "expanded" : "compact");
  };

  if (!open) return null;
  return createPortal(
    <>
      <div
        {...scope}
        aria-hidden="true"
        className="fixed inset-0 z-50 bg-black/40"
        data-thread-summary-backdrop=""
        onClick={requestClose}
      />
      <div
        {...scope}
        aria-label="Thread summary"
        aria-modal
        className="fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-xl border border-border bg-background text-sm outline-none"
        data-detent={mode === "expanded" ? "full" : "half"}
        data-thread-summary-drawer=""
        ref={panelRef}
        role="dialog"
        style={{ height: heightFor(mode), transition: `height 220ms ${EASING}` }}
        tabIndex={-1}
      >
        <div className="relative flex h-10 shrink-0 items-center justify-center">
          <div
            aria-hidden="true"
            className="flex h-full w-24 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
            data-thread-summary-handle=""
            onPointerCancel={(event) => onPointerEnd(event, true)}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={(event) => onPointerEnd(event, false)}
          >
            <div className="h-1 w-10 rounded-full bg-muted-foreground/20" />
          </div>
          <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5">{controls}</div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">{children}</div>
      </div>
    </>,
    document.body,
  );
}
