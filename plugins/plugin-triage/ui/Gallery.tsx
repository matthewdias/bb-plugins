// A plugin's screenshots, full screen. Opened from the card's screenshot or
// from one in the details; a swipe, the arrows or the arrow keys move
// through them, and Escape, the close button or a tap outside the image
// closes it. A pinch, a double-tap, a trackpad pinch or ⌃-scroll, and the
// + − 0 keys zoom; a zoomed image pans under one finger or the wheel, and the
// swipe between screenshots waits until it is back at fit.
//
// `@radix-ui/react-dialog` is one of the packages bb shims at runtime, so
// this bundles none of it. Its content portals out of the plugin's subtree,
// so it carries the plugin's portal-scope attributes for styling, and bb's
// swipe-to-open sidebar markers so a swipe here moves the gallery.
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { usePortalScopeProps } from "@/lib/portal-scope";
import { cn } from "@/lib/utils";
import {
  IDENTITY,
  STEP_SCALE,
  isZoomed,
  pan,
  pinch,
  settle,
  toggleAt,
  zoomAbout,
  type Box,
  type Point,
  type View,
} from "../lib/zoom";
import { haptic } from "./haptics";

/** How far a swipe goes before it changes the screenshot. */
const SWIPE = 50;

/** Every key the deck acts on (see lib/gesture.ts keyCommand). */
const DECK_KEYS = new Set(["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown", " ", "Enter", "z", "Z"]);
const ZOOM_KEYS = new Set(["+", "=", "-", "_", "0"]);
/** How far a press moves before it is a drag rather than a tap. */
const SLOP = 6;
/** Two taps this close in time and space are a double-tap. */
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_PX = 30;

type Gesture =
  | { kind: "swipe" | "pan"; id: number; from: Point; start: View }
  | { kind: "pinch"; ids: [number, number]; from: [Point, Point]; start: View };

export interface GalleryProps {
  title: string;
  shots: readonly string[];
  /** The screenshot shown, or null when closed. */
  index: number | null;
  onIndex: (index: number | null) => void;
}

export function Gallery({ title, shots, index, onIndex }: GalleryProps) {
  const portalProps = usePortalScopeProps();
  const [loaded, setLoaded] = useState(false);
  const open = index !== null && shots.length > 0;
  const at = index ?? 0;
  const many = shots.length > 1;
  const go = (step: number) => onIndex((at + step + shots.length) % shots.length);
  useEffect(() => setLoaded(false), [at]);

  // The zoom. `smooth` animates a jump (a double-tap, a key, a reset); a
  // pinch, a pan or the wheel follow the hand directly.
  const [view, setViewState] = useState<View>(IDENTITY);
  const [smooth, setSmooth] = useState(false);
  const viewRef = useRef<View>(IDENTITY);
  const setView = (next: View, animate = false) => {
    viewRef.current = next;
    setSmooth(animate);
    setViewState(next);
  };
  useEffect(() => setView(IDENTITY), [at, open]);

  const stage = useRef<HTMLDivElement | null>(null);
  // The dialog mounts its content after this component's effects first run,
  // so the wheel listener follows the element itself, not the open flag.
  const [stageElement, setStageElement] = useState<HTMLDivElement | null>(null);
  const image = useRef<HTMLImageElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);
  const moved = useRef(false);
  const lastTap = useRef<{ at: number; point: Point } | null>(null);

  /** The stage's centre on screen, which is the image's, and the image's fitted size. */
  function geometry(): { centre: Point; box: Box } | null {
    if (stage.current === null || image.current === null) return null;
    const rect = stage.current.getBoundingClientRect();
    return {
      centre: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      box: { width: image.current.offsetWidth, height: image.current.offsetHeight },
    };
  }
  const relative = (point: Point, centre: Point): Point => ({ x: point.x - centre.x, y: point.y - centre.y });

  function capture(id: number) {
    // Only once a press moves, so a plain tap still reaches what it hit.
    stage.current?.setPointerCapture?.(id);
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as Element).closest("button")) return;
    const point = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, point);
    if (pointers.current.size === 1) {
      moved.current = false;
      gesture.current = {
        kind: isZoomed(viewRef.current) ? "pan" : "swipe",
        id: event.pointerId,
        from: point,
        start: viewRef.current,
      };
    } else if (pointers.current.size === 2) {
      const geo = geometry();
      if (geo === null) return;
      const [[idA, a], [idB, b]] = [...pointers.current.entries()] as [[number, Point], [number, Point]];
      moved.current = true;
      capture(idA);
      capture(idB);
      gesture.current = {
        kind: "pinch",
        ids: [idA, idB],
        from: [relative(a, geo.centre), relative(b, geo.centre)],
        start: viewRef.current,
      };
    }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    const point = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, point);
    const current = gesture.current;
    const geo = geometry();
    if (current === null || geo === null) return;
    if (current.kind === "pinch") {
      const a = pointers.current.get(current.ids[0]);
      const b = pointers.current.get(current.ids[1]);
      if (a === undefined || b === undefined) return;
      setView(pinch(current.start, current.from, [relative(a, geo.centre), relative(b, geo.centre)], geo.box));
      return;
    }
    if (current.id !== event.pointerId) return;
    const dx = point.x - current.from.x;
    const dy = point.y - current.from.y;
    if (!moved.current && Math.hypot(dx, dy) >= SLOP) {
      moved.current = true;
      capture(event.pointerId);
    }
    if (current.kind === "pan" && moved.current) setView(pan(current.start, dx, dy, geo.box));
  }

  function onPointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    if (!pointers.current.delete(event.pointerId)) return;
    const current = gesture.current;
    if (current === null) return;
    if (current.kind === "pinch") {
      // Lifting one finger of two carries on as a pan with the other.
      const [rest] = [...pointers.current.entries()];
      const settled = settle(viewRef.current);
      setView(settled, settled !== viewRef.current);
      gesture.current =
        rest === undefined || !isZoomed(settled)
          ? null
          : { kind: "pan", id: rest[0], from: rest[1], start: settled };
      return;
    }
    if (current.id !== event.pointerId) return;
    gesture.current = null;
    if (event.type === "pointercancel") return;
    const dx = event.clientX - current.from.x;
    const dy = event.clientY - current.from.y;
    if (current.kind === "swipe" && many && Math.abs(dx) >= SWIPE && Math.abs(dx) > Math.abs(dy)) {
      go(dx < 0 ? 1 : -1);
      return;
    }
    if (!moved.current) onTap(event);
  }

  function onTap(event: ReactPointerEvent<HTMLDivElement>) {
    const point = { x: event.clientX, y: event.clientY };
    const now = performance.now();
    const previous = lastTap.current;
    const onImage = event.target === image.current;
    if (
      onImage &&
      previous !== null &&
      now - previous.at <= DOUBLE_TAP_MS &&
      Math.hypot(point.x - previous.point.x, point.y - previous.point.y) <= DOUBLE_TAP_PX
    ) {
      lastTap.current = null;
      const geo = geometry();
      if (geo === null) return;
      haptic("selection");
      setView(toggleAt(viewRef.current, relative(point, geo.centre), geo.box), true);
      return;
    }
    lastTap.current = onImage ? { at: now, point } : null;
  }

  // A trackpad pinch arrives as a wheel event with ctrlKey set, as does
  // ⌃-scroll; either zooms about the pointer. A plain wheel pans a zoomed
  // image. Native, because React's wheel listener is passive and the page
  // must not zoom or scroll instead.
  useEffect(() => {
    const el = stageElement;
    if (el === null) return;
    function onWheel(event: WheelEvent) {
      const geo = geometry();
      if (geo === null) return;
      const v = viewRef.current;
      if (event.ctrlKey) {
        event.preventDefault();
        const focal = relative({ x: event.clientX, y: event.clientY }, geo.centre);
        setView(zoomAbout(v, v.scale * Math.exp(-event.deltaY * 0.01), focal, geo.box));
      } else if (isZoomed(v)) {
        event.preventDefault();
        setView(pan(v, -event.deltaX, -event.deltaY, geo.box));
      }
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [stageElement]);

  // While open, the gallery owns the keys the deck would act on. It listens
  // on the window in the capture phase, ahead of the deck's own listener and
  // whatever has focus, and marks each key handled so the deck skips it:
  // ← and → page through the screenshots, and the rest do nothing here.
  // Escape is left to the dialog, which closes on it.
  const step = useRef(go);
  step.current = go;
  const zoomKey = useRef((_key: string) => {});
  zoomKey.current = (key: string) => {
    const geo = geometry();
    if (geo === null) return;
    const v = viewRef.current;
    const centre = { x: 0, y: 0 };
    if (key === "0") setView(IDENTITY, true);
    else if (key === "+" || key === "=") setView(zoomAbout(v, isZoomed(v) ? v.scale * 1.5 : STEP_SCALE, centre, geo.box), true);
    else setView(settle(zoomAbout(v, v.scale / 1.5, centre, geo.box)), true);
  };
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (ZOOM_KEYS.has(event.key) && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        zoomKey.current(event.key);
        return;
      }
      if (!DECK_KEYS.has(event.key)) return;
      // Space and Enter on one of the gallery's buttons press that button.
      const onButton = event.target instanceof Element && event.target.closest("button") !== null;
      if ((event.key === " " || event.key === "Enter") && onButton) return;
      event.preventDefault();
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "ArrowRight" && many) step.current(1);
      else if (event.key === "ArrowLeft" && many) step.current(-1);
    }
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [many, open]);

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onIndex(null)}>
      <Dialog.Portal>
        <Dialog.Overlay
          {...portalProps}
          className="fixed inset-0 z-[70] bg-black/85 backdrop-blur-sm"
        />
        <Dialog.Content
          {...portalProps}
          aria-describedby={undefined}
          data-no-sidebar-swipe=""
          data-no-secondary-panel-swipe=""
          // Present only while open; the deck checks for it before taking Escape.
          data-triage-gallery=""
          className="fixed inset-0 z-[71] flex touch-none select-none flex-col text-white outline-none"
          // A portal's events still bubble through React to the card under
          // it, which would read a swipe here as a swipe of the card.
          onPointerDown={(event) => event.stopPropagation()}
          onPointerMove={(event) => event.stopPropagation()}
          onPointerUp={(event) => event.stopPropagation()}
          onPointerCancel={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            // A tap on the backdrop, not the image or a control, closes.
            if (event.target === event.currentTarget) onIndex(null);
          }}
        >
          <header className="flex shrink-0 items-center gap-3 px-4 py-3">
            <Dialog.Title className="min-w-0 flex-1 truncate text-sm font-medium">{title}</Dialog.Title>
            {many && (
              <span className="text-xs tabular-nums text-white/70" aria-live="polite">
                {at + 1} / {shots.length}
              </span>
            )}
            <Dialog.Close
              className="flex size-9 items-center justify-center rounded-full hover:bg-white/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/60"
              aria-label="Close"
            >
              <Icon name="X" className="size-5" aria-hidden />
            </Dialog.Close>
          </header>

          <div
            ref={(el) => {
              stage.current = el;
              setStageElement(el);
            }}
            data-testid="gallery-stage"
            className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-2 sm:px-16"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
            onClick={(event) => {
              // A drag or a pinch ends in a click on the stage; that is no tap.
              if (moved.current) {
                moved.current = false;
                return;
              }
              if (event.target === event.currentTarget) onIndex(null);
            }}
          >
            {open && (
              <img
                ref={image}
                key={shots[at]}
                src={shots[at]}
                alt={many ? `${title}, screenshot ${at + 1} of ${shots.length}` : `${title}, screenshot`}
                className={cn(
                  "max-h-full max-w-full rounded-lg object-contain shadow-2xl will-change-transform",
                  isZoomed(view) ? "cursor-grab" : "cursor-zoom-in",
                  loaded ? "opacity-100" : "opacity-0",
                )}
                style={{
                  transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})`,
                  transition: smooth ? "transform 200ms ease-out, opacity 150ms" : "opacity 150ms",
                }}
                onLoad={() => setLoaded(true)}
                draggable={false}
              />
            )}
            {many && (
              <>
                <NavButton side="left" onClick={() => go(-1)} />
                <NavButton side="right" onClick={() => go(1)} />
              </>
            )}
          </div>

          {many && (
            <div className="flex shrink-0 justify-center gap-2 py-4" role="tablist" aria-label="Screenshots">
              {shots.map((url, i) => (
                <button
                  key={url}
                  type="button"
                  role="tab"
                  aria-selected={i === at}
                  aria-label={`Screenshot ${i + 1}`}
                  onClick={() => onIndex(i)}
                  className={cn("size-2 rounded-full", i === at ? "bg-white" : "bg-white/35 hover:bg-white/60")}
                />
              ))}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function NavButton({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === "left" ? "Previous screenshot" : "Next screenshot"}
      className={cn(
        // Hidden on a phone, where a swipe does this.
        "absolute top-1/2 hidden size-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/60 sm:flex",
        side === "left" ? "left-3" : "right-3",
      )}
    >
      <Icon name={side === "left" ? "ChevronLeft" : "ChevronRight"} className="size-5" aria-hidden />
    </button>
  );
}
