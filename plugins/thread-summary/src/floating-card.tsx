// The card on a desktop: under the thread header, against the pane's right
// edge, floating over the chat.
//
// The header action renders it and portals it to the document's body. Body,
// so it floats above the chat without taking any room in the header; rendered
// by the header action rather than an app overlay, because bb's file links
// work only beneath a thread's own surface, and React context — unlike the
// DOM — follows a portal back to where it was rendered.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { closesOn, isOutside } from "../lib/card-state";
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
  pinned,
  onClose,
  controls,
  children,
}: {
  /** The header control the card hangs from: presses on it are not outside. */
  control: HTMLElement | null;
  pinned: boolean;
  onClose: () => void;
  /** The strip's buttons. */
  controls: ReactNode;
  children: ReactNode;
}) {
  const scope = usePortalScopeProps();
  const placement = usePlacement(control);
  const cardRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const dismiss = useCallback(
    (reason: "escape" | "outside") => {
      if (closesOn(reason, pinned)) onCloseRef.current();
    },
    [pinned],
  );

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (isOutside(event.target, cardRef.current, control)) dismiss("outside");
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) dismiss("escape");
    };
    // Capture: a menu that stops propagation must not keep the card open.
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [control, dismiss]);

  if (placement === null) return null;
  return createPortal(
    <section
      {...scope}
      aria-label="Thread summary"
      className="group fixed z-40 flex flex-col overflow-hidden rounded-lg border border-border bg-popover text-xs text-popover-foreground shadow-lg"
      data-thread-summary-card=""
      ref={cardRef}
      role="dialog"
      style={{ left: placement.left, top: placement.top, width: placement.width, maxHeight: placement.maxHeight }}
    >
      {/*
        The strip overlays the card's top-right corner, inside its edges, and
        shows only on hover or keyboard focus. Keyboard focus means
        :focus-visible, not :focus-within: a mouse click leaves its button
        focused, and the strip would stay up after the pointer left. It may
        cover the first line's trailing text while it shows; the card takes no
        room beyond itself.
      */}
      <div
        aria-label="Thread summary controls"
        className="pointer-events-none absolute right-1 top-1 z-10 flex items-center gap-0.5 rounded-md border border-border bg-popover p-0.5 opacity-0 shadow-sm transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-has-[:focus-visible]:pointer-events-auto group-has-[:focus-visible]:opacity-100"
        data-thread-summary-strip=""
        role="toolbar"
      >
        {controls}
      </div>
      <div className="min-h-0 overflow-y-auto">{children}</div>
    </section>,
    document.body,
  );
}
