// The window-wide half of the plugin. It draws nothing of its own: it loads
// the read point of the thread in view, puts the "New" divider above it,
// scrolls there when you come back, forgets the point once you have been back,
// and listens for the modifier-click.
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useBbContext, useRealtime, useRpc, useSettings } from "@get-bb/plugin-sdk/app";
import { modifierMatches, parseModifier, POINT_CHANGED, type ReadPoint, seenDuringVisit } from "../lib/read-point";
import {
  findMessageRow,
  findTargetRow,
  findViewport,
  NATIVE_DIVIDER,
  resolveClick,
  revealRow,
  searchDirection,
} from "../lib/timeline";
import type { rpcContract } from "../server";
import { knownAbsent, markFromHere, type MarkUnreadRpc, rememberPoint, rememberRpc } from "./actions";
import { readVisit, type Visit, visitFor, writeVisit } from "./visit";

export const TARGET_ATTR = "data-mark-unread-target";
export const ACTIVE_ATTR = "data-mark-unread-active";

// A copy of bb's own divider, drawn above the target row: the same "New"
// label, size, tracking and accent, so it reads as bb's. bb's divider is
// hidden while ours is up, because with the thread marked unread bb would
// put its own at the very top.
export const DIVIDER_CSS = `
[${ACTIVE_ATTR}] ${NATIVE_DIVIDER} { display: none !important; }
[${TARGET_ATTR}]::before {
  content: "New";
  display: block;
  box-sizing: border-box;
  width: 100%;
  flex: 0 0 100%;
  margin-bottom: 4px;
  padding: 4px 8px;
  font-size: 10px;
  font-weight: 500;
  line-height: 15px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--timeline-accent);
  background: linear-gradient(var(--timeline-accent), var(--timeline-accent)) no-repeat right 8px center / calc(100% - 52px) 1px;
}
`;

/** How long to wait for the timeline, and for bb's own scroll on arrival. */
const VIEWPORT_TIMEOUT_MS = 5000;
const SETTLE_MS = 400;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function useReadPoint(rpc: MarkUnreadRpc, threadId: string | null): ReadPoint | null {
  const [loaded, setLoaded] = useState<{ threadId: string; point: ReadPoint | null } | null>(null);
  const [version, setVersion] = useState(0);
  useRealtime(POINT_CHANGED, (payload) => {
    const changed = (payload as { threadId?: unknown } | null)?.threadId;
    if (changed === threadId) setVersion((value) => value + 1);
  });
  useEffect(() => {
    if (!threadId) return;
    let live = true;
    rpc.call("points_get", { threadId }).then(
      ({ point }) => {
        rememberPoint(threadId, point);
        if (live) setLoaded({ threadId, point });
      },
      (cause: unknown) => console.warn("[mark-unread] could not load the read point", cause),
    );
    return () => {
      live = false;
    };
  }, [rpc, threadId, version]);
  return loaded !== null && loaded.threadId === threadId ? loaded.point : null;
}

/**
 * Forget a point once you have been back to it. bb marks a thread read as you
 * enter it, so leaving after a visit that began after the point was set is
 * Slack's "you've seen it". Leaving a thread you marked while in it keeps the
 * point: you have not been back yet.
 *
 * Leaving is noticed as the next visit starts, not when this one's effect is
 * cleaned up, because an unmount is not a departure: the visit is stored, and
 * the overlay that mounts next compares against it. That also covers leaving
 * while the plugin was off.
 */
function useForgetOnLeave(rpc: MarkUnreadRpc, visit: Visit | null): void {
  useEffect(() => {
    const previous = readVisit(sessionStorage);
    // Same thread: the same visit, and the stored copy is the current one.
    if (previous && previous.threadId === visit?.threadId) return;
    writeVisit(sessionStorage, visit);
    if (!previous) return;
    // Nothing to forget, and nothing to ask the server, when the thread is known to have no point.
    if (knownAbsent(previous.threadId)) return;
    rpc.call("points_clear", { threadId: previous.threadId, setBefore: previous.startedAt }).catch((cause: unknown) => {
      console.warn("[mark-unread] could not clear the read point", cause);
    });
  }, [rpc, visit]);
}

/** Keep the divider on the right row as bb renders, recycles and replaces rows. */
function useDivider(threadId: string | null, point: ReadPoint | null): void {
  useEffect(() => {
    if (!threadId || !point) return;
    let target: Element | null = null;
    let viewport: HTMLElement | null = null;
    let frame = 0;
    const apply = () => {
      frame = 0;
      const nextViewport = findViewport(document, threadId);
      if (nextViewport !== viewport) {
        viewport?.removeAttribute(ACTIVE_ATTR);
        viewport = nextViewport;
      }
      viewport?.setAttribute(ACTIVE_ATTR, "");
      const next = findTargetRow(document, point);
      if (next !== target) {
        target?.removeAttribute(TARGET_ATTR);
        target = next;
      }
      target?.setAttribute(TARGET_ATTR, "");
    };
    // Child-list changes only: setting our own attributes must not re-trigger.
    const observer = new MutationObserver(() => {
      if (frame === 0) frame = requestAnimationFrame(apply);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    apply();
    return () => {
      observer.disconnect();
      if (frame !== 0) cancelAnimationFrame(frame);
      target?.removeAttribute(TARGET_ATTR);
      viewport?.removeAttribute(ACTIVE_ATTR);
    };
  }, [threadId, point]);
}

/** On coming back to a marked thread, scroll to where you left off, once a visit. */
function useRevealOnArrival(visit: Visit | null, point: ReadPoint | null): void {
  const threadId = visit?.threadId ?? null;
  const due =
    visit !== null &&
    point !== null &&
    seenDuringVisit(point, visit.startedAt) &&
    visit.revealedSetAt !== point.setAt;
  useEffect(() => {
    if (!due || !threadId || !point) return;
    const controller = new AbortController();
    void (async () => {
      let viewport: HTMLElement | null = null;
      for (let waited = 0; !viewport && waited < VIEWPORT_TIMEOUT_MS; waited += 100) {
        if (controller.signal.aborted) return;
        viewport = findViewport(document, threadId);
        if (!viewport) await sleep(100);
      }
      if (!viewport) return;
      // bb scrolls to its own divider as the thread opens; let it, then go.
      await sleep(SETTLE_MS);
      const row = await revealRow(viewport, {
        // The divider's row when it is there; the message when nothing has answered it yet.
        find: () => findTargetRow(document, point) ?? findMessageRow(document, point),
        direction: searchDirection(document, point),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      // Done for this visit, even across a remount.
      const current = readVisit(sessionStorage);
      if (current?.threadId === threadId) writeVisit(sessionStorage, { ...current, revealedSetAt: point.setAt });
      if (!row) {
        toast("Couldn't find where this thread was marked unread", {
          description: "The message may no longer be in the thread.",
        });
      }
    })();
    return () => controller.abort();
    // Keyed on setAt, not the object: a refetch of the same point is not a new arrival.
  }, [due, threadId, point?.setAt, visit?.startedAt]);
}

function useModifierClick(rpc: MarkUnreadRpc, setting: unknown): void {
  const modifier = parseModifier(setting);
  useEffect(() => {
    if (modifier === "Off") return;
    const onClick = (event: MouseEvent) => {
      const hit = resolveClick(event, modifier, modifierMatches, window.getSelection());
      if (!hit) return;
      event.preventDefault();
      void markFromHere(rpc, hit);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [rpc, modifier]);
}

export function MarkUnreadOverlay() {
  const rpc = useRpc<typeof rpcContract>();
  const { threadId } = useBbContext();
  const { values } = useSettings();
  useEffect(() => rememberRpc(rpc), [rpc]);
  // A new visit each time the thread in view changes; the same one across a remount.
  const visit = useMemo(() => visitFor(sessionStorage, threadId, Date.now()), [threadId]);
  const point = useReadPoint(rpc, threadId);
  useForgetOnLeave(rpc, visit);
  useDivider(threadId, point);
  useRevealOnArrival(visit, point);
  useModifierClick(rpc, values?.modifier);
  return <style>{DIVIDER_CSS}</style>;
}
