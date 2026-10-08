// The card on a phone or a coarse pointer: a drawer from the bottom of the
// screen, like bb's own composer popups.
//
// It shows what the desktop card shows, and opens only when asked: whether
// the desktop card is showing is neither read nor written here. Its height
// fits its contents, up to 92% of the screen, and it scrolls inside once it
// reaches that.
//
// The top edge holds the handle and a close button: the backdrop covers the
// header button, so the drawer needs its own way out. The drawer moves down
// only: dragged past a quarter of its own height it closes,
// short of that it springs back. Tapping the backdrop, Escape and the close
// button close it too, and focus goes back to the header button. Focus and
// Escape are the vendored drawer's (components/ui/responsive-overlay.tsx),
// reused rather than rebuilt.
import { useCallback, useRef, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { usePersistentOverlayFocus } from "@/components/ui/responsive-overlay";
import { DRAWER_FULL, dismissesAt } from "../lib/placement";
import { usePortalScopeProps } from "../lib/portal-scope";

const EASING = "cubic-bezier(0.32, 0.72, 0, 1)";
const TRANSITION = `transform 220ms ${EASING}`;

interface Drag {
  pointerId: number;
  startY: number;
  height: number;
}

export function SummaryDrawer({
  open,
  onClose,
  returnFocusTo,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** The header button, which gets focus back however the drawer closes. */
  returnFocusTo: HTMLElement | null;
  children: ReactNode;
}) {
  const scope = usePortalScopeProps();
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const returnFocusRef = useRef(returnFocusTo);
  returnFocusRef.current = returnFocusTo;
  const requestClose = useCallback(() => onCloseRef.current(), []);
  // After the vendored hook puts focus back where it was on open, which on a
  // phone may be nowhere: the header button is where the drawer came from.
  const focusButton = useCallback(() => returnFocusRef.current?.focus({ preventScroll: true }), []);

  usePersistentOverlayFocus({ open, panelRef, requestClose, onAfterCloseAutoFocus: focusButton });

  const offsetOf = (drag: Drag, clientY: number) => Math.max(0, clientY - drag.startY);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || panelRef.current === null) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      height: panelRef.current.getBoundingClientRect().height,
    };
    panelRef.current.style.transition = "none";
    event.preventDefault();
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const panel = panelRef.current;
    if (drag === null || panel === null || drag.pointerId !== event.pointerId) return;
    // Down only: dragging up holds the drawer where it is.
    panel.style.transform = `translate3d(0, ${offsetOf(drag, event.clientY)}px, 0)`;
    event.preventDefault();
  };

  const onPointerEnd = (event: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const drag = dragRef.current;
    const panel = panelRef.current;
    if (drag === null || panel === null || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    panel.style.transition = TRANSITION;
    if (!cancelled && dismissesAt(offsetOf(drag, event.clientY), drag.height)) {
      onCloseRef.current();
      return;
    }
    // Short of the threshold: back to where it started.
    panel.style.transform = "";
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
        data-thread-summary-drawer=""
        ref={panelRef}
        role="dialog"
        style={{ maxHeight: `${Math.round(DRAWER_FULL * 100)}dvh`, transition: TRANSITION }}
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
          <button
            aria-label="Close"
            className="absolute right-2 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
            onClick={requestClose}
            title="Close"
            type="button"
          >
            <Icon aria-hidden name="X" style={{ height: 16, width: 16 }} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto" style={{ padding: "0 6px calc(6px + env(safe-area-inset-bottom))" }}>
          {children}
        </div>
      </div>
    </>,
    document.body,
  );
}
