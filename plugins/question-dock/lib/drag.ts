// Press-then-drag on elements bb owns.
//
// The card's header is bb's expand/collapse button, so a press there has to
// stay a click until the pointer travels far enough to be a drag. Once it has
// dragged, the click the browser sends on release is swallowed, or bb would
// collapse the card the person just moved.

/** Pointer travel before a press becomes a drag, as in Top Tabs. */
export const DRAG_THRESHOLD_PX = 5;
/** How long a swallowed click may take to arrive after its release. */
const SWALLOW_WINDOW_MS = 400;

export interface DragSession {
  start(): void;
  move(dx: number, dy: number, event: PointerEvent): void;
  end(event: PointerEvent, cancelled: boolean): void;
}

/** Return a session for a press that may become a drag, or null to leave it alone. */
export type BeginDrag = (target: Element, event: PointerEvent) => DragSession | null;

/** Swallow the next click anywhere in `doc`, if it comes soon. */
export function swallowNextClick(doc: Document): void {
  const view = doc.defaultView;
  const onClick = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    stop();
  };
  const timer = view?.setTimeout(() => stop(), SWALLOW_WINDOW_MS);
  function stop() {
    doc.removeEventListener("click", onClick, true);
    if (timer !== undefined) view?.clearTimeout(timer);
  }
  doc.addEventListener("click", onClick, true);
}

export function listenForDrags(doc: Document, begin: BeginDrag): () => void {
  let press: {
    pointerId: number;
    startX: number;
    startY: number;
    session: DragSession;
    dragging: boolean;
  } | null = null;

  const onDown = (event: PointerEvent) => {
    if (press !== null || event.button !== 0 || !event.isPrimary) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const session = begin(target, event);
    if (session === null) return;
    press = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, session, dragging: false };
  };

  const onMove = (event: PointerEvent) => {
    if (press === null || event.pointerId !== press.pointerId) return;
    const dx = event.clientX - press.startX;
    const dy = event.clientY - press.startY;
    if (!press.dragging) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      press.dragging = true;
      press.session.start();
    }
    event.preventDefault();
    press.session.move(dx, dy, event);
  };

  const finish = (event: PointerEvent, cancelled: boolean) => {
    if (press === null || event.pointerId !== press.pointerId) return;
    const { dragging, session } = press;
    press = null;
    if (!dragging) return;
    session.end(event, cancelled);
    if (!cancelled) swallowNextClick(doc);
  };
  const onUp = (event: PointerEvent) => finish(event, false);
  const onCancel = (event: PointerEvent) => finish(event, true);

  doc.addEventListener("pointerdown", onDown, true);
  doc.addEventListener("pointermove", onMove, true);
  doc.addEventListener("pointerup", onUp, true);
  doc.addEventListener("pointercancel", onCancel, true);
  return () => {
    doc.removeEventListener("pointerdown", onDown, true);
    doc.removeEventListener("pointermove", onMove, true);
    doc.removeEventListener("pointerup", onUp, true);
    doc.removeEventListener("pointercancel", onCancel, true);
  };
}
