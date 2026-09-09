// Thread Badges — small per-thread indicators on sidebar rows.
//
// The rows belong to whichever sidebar is installed, and no sidebar offers a
// slot for a badge. What they all publish is `a[data-sidebar-thread-id]` —
// bb's own attribute, which Ribbon's replacement list emits too so the host can
// keep targeting rows for keyboard shortcuts. So: hang one span per row off
// that anchor's parent and portal React into it. The badges keep their hooks
// and context, the rows stay entirely the sidebar's business, and if a sidebar
// ever stops publishing the attribute the badges disappear and nothing else
// changes.
//
// Nothing in this file knows what a badge means. It owns mount points and
// ordering; ./badges owns what is drawn.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { definePluginApp, useSettings } from "@get-bb/plugin-sdk/app";
import { BADGE_TYPES, isEnabled, type BadgeSettings } from "./badges/catalog";
import { BADGE_COMPONENTS } from "./badges/components";

/**
 * Where a badge goes: before the row's trailing controls — the column holding
 * the activity indicator and, on hover, the actions menu — so badges never sit
 * outside them. Rows without that column take badges at the end, which is what
 * a null return means to `insertBefore`.
 */
function insertionPoint(row: HTMLElement, own: HTMLElement): Element | null {
  const siblings = Array.from(row.children).filter((child) => child !== own);
  const last = siblings[siblings.length - 1];
  if (last === undefined) return null;
  // The title column grows; anything after it is trailing chrome. Never insert
  // ahead of the title itself.
  if (last.classList.contains("flex-1") || last.hasAttribute("data-sidebar-thread-id")) {
    return null;
  }
  return last;
}

const ROW_SELECTOR = "a[data-sidebar-thread-id]";
const SLOT_ATTRIBUTE = "data-thread-badges-for";

/**
 * Bumped when the window comes back, at most once every ten seconds. A plugin
 * cannot hear another plugin's realtime signals, so a badge reading someone
 * else's state has no push to listen to; coming back to the window is the
 * cheapest honest moment to re-ask.
 */
function useFocusRevision(): number {
  const [revision, setRevision] = useState(0);
  const lastRef = useRef(Date.now());
  useEffect(() => {
    const bump = (): void => {
      const now = Date.now();
      if (now - lastRef.current < 10_000) return;
      lastRef.current = now;
      setRevision((value) => value + 1);
    };
    const onVisible = (): void => {
      if (!document.hidden) bump();
    };
    window.addEventListener("focus", bump);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", bump);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return revision;
}

function RowBadges({
  threadId,
  values,
  revision,
}: {
  threadId: string;
  values: BadgeSettings;
  revision: number;
}) {
  return (
    <>
      {BADGE_TYPES.map((badge) => {
        if (!isEnabled(values, badge.id)) return null;
        const Badge = BADGE_COMPONENTS[badge.id];
        if (Badge === undefined) return null;
        return (
          <Badge
            key={badge.id}
            revision={revision}
            threadId={threadId}
            values={values}
          />
        );
      })}
    </>
  );
}

interface Slot {
  threadId: string;
  node: HTMLElement;
}

function SidebarBadges() {
  const settings = useSettings();
  const [slots, setSlots] = useState<readonly Slot[]>([]);
  const nodesRef = useRef<Map<string, HTMLElement>>(new Map());

  useEffect(() => {
    const nodes = nodesRef.current;
    // A timer rather than requestAnimationFrame: rAF does not run in a hidden
    // window, so a sidebar that changed while this window sat in the
    // background would never be re-scanned — and the pending frame would block
    // every later one behind it.
    let timer = 0;
    let disposed = false;

    const sync = (): void => {
      timer = 0;
      const seen = new Set<string>();
      let changed = false;
      const anchors = Array.from(
        document.querySelectorAll<HTMLAnchorElement>(ROW_SELECTOR),
      );
      for (const anchor of anchors) {
        const threadId = anchor.getAttribute("data-sidebar-thread-id");
        const row = anchor.parentElement;
        if (threadId === null || threadId === "" || row === null) continue;
        seen.add(threadId);
        let node = nodes.get(threadId);
        if (node === undefined) {
          node = document.createElement("span");
          node.setAttribute(SLOT_ATTRIBUTE, threadId);
          // Inline, not a class: this node is built outside JSX, so the CSS
          // build never sees it and would not emit the utilities.
          node.style.cssText =
            "position:relative;z-index:20;display:inline-flex;flex:none;align-items:center;gap:4px;margin-right:4px";
          nodes.set(threadId, node);
          changed = true;
        }
        // Re-place rather than re-create when a row re-renders around it: the
        // portal keeps working as long as this is the same node.
        const before = insertionPoint(row, node);
        if (node.parentElement !== row || node.nextElementSibling !== before) {
          row.insertBefore(node, before);
        }
      }
      for (const [threadId, node] of nodes) {
        if (seen.has(threadId)) continue;
        node.remove();
        nodes.delete(threadId);
        changed = true;
      }
      // Only when the mount points actually moved. This observer sees its own
      // writes, and a state update per mutation would spin.
      if (changed && !disposed) {
        setSlots([...nodes].map(([threadId, node]) => ({ threadId, node })));
      }
    };

    const schedule = (): void => {
      if (timer !== 0 || disposed) return;
      timer = window.setTimeout(sync, 50);
    };

    sync();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      disposed = true;
      observer.disconnect();
      if (timer !== 0) window.clearTimeout(timer);
      for (const node of nodes.values()) node.remove();
      nodes.clear();
    };
  }, []);

  const values: BadgeSettings = settings.values ?? {};
  const revision = useFocusRevision();
  return (
    <>
      {slots.map(({ threadId, node }) =>
        createPortal(
          <RowBadges revision={revision} threadId={threadId} values={values} />,
          node,
          threadId,
        ),
      )}
    </>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({
    id: "thread-badges",
    component: SidebarBadges,
  });
});
