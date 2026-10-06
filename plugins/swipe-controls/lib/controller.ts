// The gestures, wired to the page.
//
// One controller per set of settings: the overlay starts one, and stops and
// replaces it when a setting changes, so nothing here re-reads settings
// mid-gesture. Stopping puts every row back, removes every view and listener,
// and unmarks the rows it marked.
//
// Three gestures:
// - two-finger swipe over the main pane: back / forward (desktop viewport);
// - two-finger swipe over a thread row: slide it (desktop, as in Mail);
// - one-finger drag on a thread row: slide it (touch).
//
// A row slid far enough left stays open on its buttons. Tapping or clicking
// anywhere else closes it, as does scrolling the list, Escape, or a resize.

import { type HapticKind } from "./haptics.ts";
import { BACK_FORWARD, type HistoryDirection, directionOf, progressOf } from "./history.ts";
import { type RowArm, type RowLayout, armOf, clampOffset, releaseOf, revealWidth } from "./row.ts";
import { markRows } from "./row-marks.ts";
import { type RowTarget, canScrollX, insetTarget, rowTarget } from "./targets.ts";
import { type TouchTrack, beginTouch, flingOf, moveTouch } from "./touch.ts";
import { ArrowView, RowView, type RowViewContent, type TrailingAction } from "./views.ts";
import { WHEEL, type WheelGesture, isSwipeCandidate, stepWheel } from "./wheel.ts";

export interface GestureSettings {
  /** Swipe thread rows at all. */
  rowSwipes: boolean;
  /** On a phone, rows take leftward drags from bb's drawer. */
  rowLeftSwipe: boolean;
  /** A long leftward swipe archives on release. */
  fullSwipeArchive: boolean;
  /** Two-finger swipe over the main pane goes back and forward. */
  backForward: boolean;
}

export interface ThreadFacts {
  isUnread: boolean;
  isPinned: boolean;
  isArchived: boolean;
}

export interface GestureEnv {
  doc: Document;
  settings: GestureSettings;
  /** bb's compact (phone) layout: the sidebar is a drawer. */
  compact(): boolean;
  thread(threadId: string): ThreadFacts | null;
  setRead(threadId: string, read: boolean): void;
  setPinned(threadId: string, pinned: boolean): void;
  archive(threadId: string): void;
  canGo(direction: HistoryDirection): boolean;
  go(direction: HistoryDirection): void;
  haptic(kind: HapticKind): void;
  reducedMotion(): boolean;
}

export const TIMING = {
  /** A row easing back, or open. */
  settleMs: 220,
  /** A row leaving to the left before it is archived. */
  slideOutMs: 180,
  /** At most this long an archived row stays slid out while bb removes it. */
  archiveHoldMs: 600,
  /** How often to look for the archived row being gone. */
  archivePollMs: 50,
  /** The back/forward arrow fading after it fires. */
  arrowFadeMs: 200,
  /** A click this soon after a drag on a row is the drag's, not a tap. */
  clickSuppressMs: 400,
} as const;

interface RowSession {
  target: RowTarget;
  facts: ThreadFacts;
  layout: RowLayout;
  view: RowView;
  /** Where the row sat when this drag began: 0, or open. */
  base: number;
  offset: number;
  arm: RowArm;
}

type WheelRoute =
  | { kind: "none" }
  | { kind: "history"; inset: Element; spent: boolean }
  | { kind: "row"; target: RowTarget; session: RowSession | null };

interface TouchSession {
  id: number;
  target: RowTarget;
  track: TouchTrack;
  session: RowSession | null;
  /** The touch began on the open row: a tap closes it rather than opening the thread. */
  onOpenRow: boolean;
}

const TRAILING_ACTIONS = 2;

function contentFor(facts: ThreadFacts): RowViewContent {
  return {
    leading: facts.isUnread ? { icon: "read", label: "Read" } : { icon: "unread", label: "Unread" },
    trailing: [
      facts.isPinned ? { id: "pin", icon: "unpin", label: "Unpin" } : { id: "pin", icon: "pin", label: "Pin" },
      { id: "archive", icon: "archive", label: "Archive" },
    ],
  };
}

function findTouch(list: TouchList, id: number): Touch | null {
  for (let index = 0; index < list.length; index += 1) {
    const touch = list.item(index);
    if (touch?.identifier === id) return touch;
  }
  return null;
}

export function startGestures(env: GestureEnv): () => void {
  const { doc, settings } = env;
  const win = doc.defaultView ?? window;
  const listeners = new AbortController();
  const signal = listeners.signal;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const views = new Set<RowView>();
  const arrow = new ArrowView(doc);

  const later = (fn: () => void, ms: number) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      fn();
    }, ms);
    timers.add(timer);
    return timer;
  };
  const ms = (value: number) => (env.reducedMotion() ? 0 : value);

  // ── Rows ──────────────────────────────────────────────────────────────

  let open: RowSession | null = null;

  const layoutFor = (target: RowTarget): RowLayout => ({
    width: target.element.getBoundingClientRect().width,
    trailingActions: TRAILING_ACTIONS,
    leading: true,
    trailing: settings.rowLeftSwipe || !env.compact(),
    full: settings.fullSwipeArchive,
  });

  const finish = (session: RowSession) => {
    session.view.destroy();
    views.delete(session.view);
    if (open === session) open = null;
  };

  const settle = (session: RowSession, offset: number, isOpen: boolean, then?: () => void) => {
    session.offset = offset;
    session.arm = null;
    const duration = ms(TIMING.settleMs);
    session.view.update(offset, null, isOpen, duration);
    if (then) later(then, duration);
  };

  const closeRow = (session: RowSession) => {
    if (open === session) open = null;
    settle(session, 0, false, () => finish(session));
  };

  const archiveRow = (session: RowSession) => {
    if (open === session) open = null;
    const duration = ms(TIMING.slideOutMs);
    session.view.update(-session.layout.width, "full", false, duration);
    later(() => {
      env.archive(session.target.threadId);
      // bb removes the row once the archive lands. Until then it stays out of
      // the way. The view goes the moment the row does, or the strip it draws
      // would sit over the row that moves up. If bb asks first (the thread has
      // children), the row comes back when the hold runs out.
      let waited = 0;
      const poll = () => {
        if (!session.target.element.isConnected || waited >= TIMING.archiveHoldMs) {
          finish(session);
          return;
        }
        waited += TIMING.archivePollMs;
        later(poll, TIMING.archivePollMs);
      };
      poll();
    }, duration);
  };

  const onAction = (session: RowSession, action: TrailingAction) => {
    if (action === "archive") {
      archiveRow(session);
      return;
    }
    env.setPinned(session.target.threadId, !session.facts.isPinned);
    closeRow(session);
  };

  /** Start sliding a row, or pick up the one already open. Null when the row can't move this way. */
  const beginRow = (target: RowTarget, firstDelta: number): RowSession | null => {
    if (open !== null && open.target.element === target.element) {
      const session = open;
      open = null;
      session.base = session.offset;
      return session;
    }
    const facts = env.thread(target.threadId);
    if (facts === null || facts.isArchived) return null;
    const layout = layoutFor(target);
    if (clampOffset(firstDelta, layout) === 0) return null;
    if (open !== null) closeRow(open);
    const rect = target.element.getBoundingClientRect();
    const session: RowSession = {
      target,
      facts,
      layout,
      base: 0,
      offset: 0,
      arm: null,
      view: new RowView(doc, target.element, rect, contentFor(facts), (action) => onAction(session, action)),
    };
    views.add(session.view);
    return session;
  };

  const dragRow = (session: RowSession, delta: number) => {
    const offset = clampOffset(session.base + delta, session.layout);
    const arm = armOf(offset, session.layout);
    if (arm !== session.arm) env.haptic("selection");
    session.offset = offset;
    session.arm = arm;
    session.view.update(offset, arm, false, 0);
  };

  const releaseRow = (session: RowSession, fling: -1 | 0 | 1) => {
    const release = releaseOf(session.offset, fling, session.layout);
    if (release === "open") {
      open = session;
      settle(session, -revealWidth(session.layout), true);
    } else if (release === "full") {
      env.haptic("impact-medium");
      archiveRow(session);
    } else {
      if (release === "leading") env.setRead(session.target.threadId, session.facts.isUnread);
      closeRow(session);
    }
  };

  if (settings.rowSwipes && settings.rowLeftSwipe) {
    const unmark = markRows(doc.body);
    signal.addEventListener("abort", unmark);
  }

  // ── Wheel: back/forward and rows ──────────────────────────────────────

  let wheel: WheelGesture | null = null;
  let route: WheelRoute = { kind: "none" };
  /** Until then, back/forward is still the swipe that last went. See BACK_FORWARD.releaseQuietMs. */
  let historyLatchUntil = -Infinity;
  let wheelEnd: ReturnType<typeof setTimeout> | null = null;

  const pickRoute = (target: EventTarget | null): WheelRoute => {
    if (settings.rowSwipes) {
      const row = rowTarget(target);
      if (row !== null) return { kind: "row", target: row, session: null };
    }
    if (settings.backForward && !env.compact()) {
      const inset = insetTarget(target);
      if (inset !== null) return { kind: "history", inset, spent: false };
    }
    return { kind: "none" };
  };

  const clearWheelEnd = () => {
    if (wheelEnd === null) return;
    clearTimeout(wheelEnd);
    timers.delete(wheelEnd);
    wheelEnd = null;
  };

  const finishWheel = () => {
    clearWheelEnd();
    if (route.kind === "history" && !route.spent) arrow.hide(ms(TIMING.arrowFadeMs));
    if (route.kind === "row" && route.session !== null) releaseRow(route.session, 0);
    route = { kind: "none" };
    wheel = null;
  };

  const onWheel = (event: WheelEvent) => {
    if (!isSwipeCandidate(event)) return;
    const latched = event.timeStamp < historyLatchUntil;
    if (latched && Math.abs(event.deltaX) >= Math.abs(event.deltaY)) {
      historyLatchUntil = event.timeStamp + BACK_FORWARD.releaseQuietMs;
    }
    const step = stepWheel(wheel, { dx: event.deltaX, dy: event.deltaY, t: event.timeStamp });
    if (step.began) {
      finishWheel();
      route = pickRoute(event.target);
    }
    wheel = step.gesture;
    clearWheelEnd();
    wheelEnd = later(finishWheel, WHEEL.gestureGapMs + 20);

    if (wheel.axis === "vertical") {
      if (step.began || route.kind !== "none") {
        if (open !== null) closeRow(open);
        route = { kind: "none" };
      }
      return;
    }
    if (wheel.axis !== "horizontal") return;

    if (route.kind === "history") {
      if (step.locked && canScrollX(event.target, wheel.x, route.inset)) {
        route = { kind: "none" };
        return;
      }
      if (event.cancelable) event.preventDefault();
      if (route.spent || latched) return;
      if (step.locked && open !== null) closeRow(open);
      const direction = directionOf(wheel.x);
      const progress = progressOf(wheel.x);
      // Nowhere to go this way: no arrow. A swipe can turn around, so this
      // is asked on every event, not once.
      if (!env.canGo(direction)) {
        arrow.hide();
        return;
      }
      arrow.show(route.inset.getBoundingClientRect(), direction, progress);
      if (progress >= 1) {
        route.spent = true;
        historyLatchUntil = event.timeStamp + BACK_FORWARD.releaseQuietMs;
        arrow.commit(ms(TIMING.arrowFadeMs));
        env.go(direction);
      }
      return;
    }

    if (route.kind === "row") {
      // Fingers moving left scroll content right (positive deltaX); the row follows the fingers.
      const delta = -wheel.x;
      if (step.locked) {
        route.session = beginRow(route.target, delta);
        if (route.session === null) {
          route = { kind: "none" };
          return;
        }
      }
      if (route.session === null) return;
      if (event.cancelable) event.preventDefault();
      dragRow(route.session, delta);
      return;
    }

    if (step.locked && open !== null) closeRow(open);
  };

  doc.addEventListener("wheel", onWheel, { capture: true, passive: false, signal });

  // ── Touch: rows ───────────────────────────────────────────────────────

  let touch: TouchSession | null = null;
  let touchListeners: AbortController | null = null;
  let suppressClickUntil = -Infinity;

  const stopTouch = () => {
    touchListeners?.abort();
    touchListeners = null;
    touch = null;
  };

  const cancelTouch = () => {
    const session = touch?.session ?? null;
    stopTouch();
    if (session !== null) closeRow(session);
  };

  const onTouchMove = (event: TouchEvent) => {
    if (touch === null) return;
    const point = findTouch(event.changedTouches, touch.id) ?? findTouch(event.touches, touch.id);
    if (point === null) return;
    touch.track = moveTouch(touch.track, point.clientX, point.clientY, event.timeStamp);
    if (touch.track.state === "rejected") {
      // Scrolling the list. An open row closes, as it would for a wheel.
      const wasOnOpenRow = touch.onOpenRow;
      stopTouch();
      if (wasOnOpenRow && open !== null) closeRow(open);
      return;
    }
    if (touch.track.state !== "claimed") return;
    // bb arms a row for drag-to-reorder after a long press. That drag is bb's.
    if (touch.target.element.getAttribute("data-sidebar-touch-armed") === "true") {
      cancelTouch();
      return;
    }
    if (touch.session === null) {
      touch.session = beginRow(touch.target, touch.track.dx);
      if (touch.session === null) {
        // Not a direction this row takes: leave the drag to bb.
        stopTouch();
        return;
      }
    }
    if (event.cancelable) event.preventDefault();
    dragRow(touch.session, touch.track.dx);
  };

  const onTouchEnd = (event: TouchEvent) => {
    if (touch === null || findTouch(event.changedTouches, touch.id) === null) return;
    const { session, track, onOpenRow } = touch;
    stopTouch();
    if (session === null) {
      // A tap on the open row closes it and doesn't open the thread.
      if (onOpenRow && open !== null) {
        closeRow(open);
        suppressClickUntil = event.timeStamp + TIMING.clickSuppressMs;
      }
      return;
    }
    suppressClickUntil = event.timeStamp + TIMING.clickSuppressMs;
    releaseRow(session, flingOf(track, event.timeStamp));
  };

  /** A press outside the open row closes it. A press on the row itself closes it without opening the thread. */
  const closeOpenFor = (target: EventTarget | null, timeStamp: number) => {
    if (open === null || open.view.contains(target)) return;
    const inRow = target instanceof Node && open.target.element.contains(target);
    closeRow(open);
    if (inRow) suppressClickUntil = timeStamp + TIMING.clickSuppressMs + 300;
  };

  const onTouchStart = (event: TouchEvent) => {
    if (touch !== null) {
      cancelTouch();
      return;
    }
    if (event.touches.length !== 1) return;
    // The open row's buttons take their own taps.
    if (open !== null && open.view.contains(event.target)) return;
    const target = settings.rowSwipes ? rowTarget(event.target) : null;
    const onOpenRow = open !== null && target !== null && target.element === open.target.element;
    if (!onOpenRow) closeOpenFor(event.target, event.timeStamp);
    const point = event.touches.item(0);
    if (target === null || point === null) return;
    touch = {
      id: point.identifier,
      target,
      track: beginTouch(point.clientX, point.clientY, event.timeStamp),
      session: null,
      onOpenRow,
    };
    touchListeners = new AbortController();
    const options = { signal: touchListeners.signal };
    win.addEventListener("touchmove", onTouchMove, { ...options, passive: false });
    win.addEventListener("touchend", onTouchEnd, options);
    win.addEventListener("touchcancel", cancelTouch, options);
  };

  doc.addEventListener("touchstart", onTouchStart, { capture: true, passive: true, signal });
  signal.addEventListener("abort", stopTouch);

  // ── Closing an open row ───────────────────────────────────────────────

  doc.addEventListener(
    "pointerdown",
    (event) => {
      if (event.pointerType !== "touch") closeOpenFor(event.target, event.timeStamp);
    },
    { capture: true, signal },
  );
  doc.addEventListener(
    "click",
    (event) => {
      if (event.timeStamp > suppressClickUntil) return;
      suppressClickUntil = -Infinity;
      event.preventDefault();
      event.stopPropagation();
    },
    { capture: true, signal },
  );
  doc.addEventListener(
    "scroll",
    (event) => {
      // Only scrolling that moves the open row: a thread streaming in the
      // main pane scrolls constantly and must not close it.
      if (open === null || touch?.session != null) return;
      const scroller = event.target;
      if (scroller === doc || (scroller instanceof Node && scroller.contains(open.target.element))) {
        closeRow(open);
      }
    },
    { capture: true, passive: true, signal },
  );
  doc.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape" && open !== null) closeRow(open);
    },
    { capture: true, signal },
  );
  win.addEventListener(
    "resize",
    () => {
      if (open !== null) closeRow(open);
    },
    { signal },
  );

  return () => {
    listeners.abort();
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    for (const view of views) view.destroy();
    views.clear();
    arrow.destroy();
    open = null;
  };
}
