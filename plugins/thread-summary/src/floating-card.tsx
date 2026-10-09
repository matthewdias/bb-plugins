// The card on a desktop: under the thread header, against the pane's right
// edge, floating over the chat.
//
// The header action renders it and portals it to the document's body. Body,
// so it floats above the chat without taking any room in the header; rendered
// by the header action rather than an app overlay, because bb's file links
// work only beneath a thread's own surface, and React context — unlike the
// DOM — follows a portal back to where it was rendered.
//
// It has no controls of its own. The header button shows and hides it.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { placeCard, type CardPlacement, type Rect } from "../lib/placement";
import { usePortalScopeProps } from "../lib/portal-scope";

const PANE_SELECTOR = "[data-split-pane-id]";

function rectOf(element: Element): Rect {
  const rect = element.getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

function viewport(): Rect {
  return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
}

/**
 * Where the card goes for a control in a thread header, kept in step with the
 * header, the pane and the window. The header is the row the control sits in;
 * the pane is the thread's own column, so each split pane's card stays over
 * its thread. Either missing, the card falls back to the control and the
 * window.
 */
function usePlacement(control: HTMLElement | null): CardPlacement | null {
  const [placement, setPlacement] = useState<CardPlacement | null>(null);
  useLayoutEffect(() => {
    if (control === null) return;
    const header = control.closest("header") ?? control;
    const pane = control.closest(PANE_SELECTOR);
    const measure = () => setPlacement(placeCard(rectOf(header), pane !== null ? rectOf(pane) : viewport()));
    measure();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(header);
    if (pane !== null) observer?.observe(pane);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [control]);
  return placement;
}

export function FloatingCard({
  control,
  returnFocusTo,
  focusOnOpen,
  onClose,
  children,
}: {
  /** The header control the card hangs from. */
  control: HTMLElement | null;
  /** Where focus goes back to when Escape closes the card from inside it. */
  returnFocusTo: HTMLElement | null;
  /**
   * Opened from the keyboard: take focus, or the card — at the end of the
   * document — would come only after tabbing through the whole app.
   */
  focusOnOpen: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const scope = usePortalScopeProps();
  const placement = usePlacement(control);
  const cardRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const returnFocusRef = useRef(returnFocusTo);
  returnFocusRef.current = returnFocusTo;

  // The card stays until the header button hides it: a click elsewhere does
  // not. Escape hides it only from inside the card, and hands focus back to
  // the button; pressed anywhere else — the composer — it is not the card's.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (cardRef.current?.contains(document.activeElement) !== true) return;
      onCloseRef.current();
      returnFocusRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const placed = placement !== null;
  useEffect(() => {
    // Only when the card first appears: a later re-render must not pull focus.
    if (placed && focusOnOpen) cardRef.current?.focus();
  }, [placed]);

  if (placement === null) return null;
  return createPortal(
    <section
      {...scope}
      aria-label="Thread summary"
      // The glass panel itself — radius, padding, translucent popover, blur,
      // hairline border, shadow and their fallbacks — is in ./style.
      className="fixed z-40 flex flex-col overflow-hidden text-xs text-popover-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-thread-summary-card=""
      ref={cardRef}
      role="dialog"
      style={{ left: placement.left, top: placement.top, width: placement.width, maxHeight: placement.maxHeight }}
      tabIndex={-1}
    >
      <div className="min-h-0 overflow-y-auto">{children}</div>
    </section>,
    document.body,
  );
}
