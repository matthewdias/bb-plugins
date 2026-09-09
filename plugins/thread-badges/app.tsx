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
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { definePluginApp, useSettings } from "@get-bb/plugin-sdk/app";
import {
  maxBadges,
  orderedBadgeTypes,
  type BadgeSettings,
  type BadgeType,
} from "./badges/catalog";
import { BADGE_COMPONENTS } from "./badges/components";

/**
 * The column a sidebar pads on hover to clear room for the row's actions.
 *
 * bb's own CSS owns this: a row is `.bb-sidebar-hover-actions-row`, its actions
 * fade in over the trailing end, and the column marked
 * `.bb-sidebar-hover-actions-inset` takes `padding-right: 1.5rem` for as long
 * as the row is hovered or its menu is open. That padding is the sidebar
 * stating, in its own units, how much of the row's right edge it is about to
 * need — so a badge that lives inside that column is moved out of the way by
 * the sidebar itself, in whatever amount it decides, rather than by a number
 * measured here that goes stale the moment it adds a button.
 *
 * bb's native rows carry it. Ribbon's do not: its actions button replaces the
 * indicator inside the same 28px box, so it clears nothing and needs nothing.
 */
const INSET_SELECTOR = ":scope > .bb-sidebar-hover-actions-inset";

/** The trailing controls: the activity indicator, and the actions on hover. */
function trailingColumn(row: HTMLElement, own: HTMLElement): Element | null {
  const siblings = Array.from(row.children).filter((child) => child !== own);
  const last = siblings[siblings.length - 1];
  if (last === undefined) return null;
  // The title column grows; anything after it is trailing chrome. Never treat
  // the title itself — or the row-covering link — as trailing.
  if (last.classList.contains("flex-1") || last.hasAttribute("data-sidebar-thread-id")) {
    return null;
  }
  return last;
}

interface Placement {
  parent: Element;
  /** `null` appends, which is what `insertBefore` does with it. */
  before: Element | null;
  /** Right-align within a column that is wider than its contents. */
  push: boolean;
}

/**
 * Where a badge goes.
 *
 * Inside the hover-inset column when the sidebar publishes one, pushed to its
 * right end so it still reads as trailing the row; otherwise immediately
 * before the trailing controls, where it sat before any sidebar told us
 * different. Both land the badge in the same place at rest — the difference is
 * only that the first one moves aside on hover and the second has nothing to
 * move aside for.
 */
function placement(row: HTMLElement, own: HTMLElement): Placement {
  // `:scope >` keeps this to the row's own column, never a nested row's.
  const inset = row.querySelector(INSET_SELECTOR);
  if (inset !== null) return { before: null, parent: inset, push: true };
  return { before: trailingColumn(row, own), parent: row, push: false };
}

const ROW_SELECTOR = "a[data-sidebar-thread-id]";
const SLOT_ATTRIBUTE = "data-thread-badges-for";
const CAP_STYLE_ID = "thread-badges-cap";

/**
 * Enforce the per-row cap in CSS rather than by rendering fewer badges.
 *
 * A badge decides for itself whether it has anything to say — it returns null
 * when it does not — and only it can know that. Nothing upstream can count the
 * badges that *would* draw without rendering them first, so the row renders
 * them all, in priority order, and this hides everything past the cap. Because
 * a silent badge contributes no element, `nth-child` counts exactly the ones
 * that had something to show, which is the count the cap is about.
 *
 * `!important` is not decoration: every badge sets `display` inline, and an
 * inline style beats a stylesheet rule without it.
 */
function useBadgeCap(max: number): void {
  useEffect(() => {
    let style = document.getElementById(CAP_STYLE_ID) as HTMLStyleElement | null;
    if (style === null) {
      style = document.createElement("style");
      style.id = CAP_STYLE_ID;
      document.head.append(style);
    }
    style.textContent = `[${SLOT_ATTRIBUTE}] > *:nth-child(n + ${max + 1}) { display: none !important; }`;
    return () => {
      style?.remove();
    };
  }, [max]);
}

/**
 * Pulls a badge back over the empty part of the trailing column, which is a
 * 28px hit target around a 16px indicator: six of its pixels always sit
 * between the two, on top of the row's own 8px gap. Cancelling them leaves one
 * row gap between the badge and the glyph it is read beside.
 */
const TRAILING_SLACK = "-6px";

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
  badges,
  threadId,
  values,
  revision,
}: {
  /** Enabled types, already in priority order; the cap hides the tail. */
  badges: readonly BadgeType[];
  threadId: string;
  values: BadgeSettings;
  revision: number;
}) {
  return (
    <>
      {badges.map((badge) => {
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
            "position:relative;z-index:20;display:inline-flex;flex:none;align-items:center;gap:4px";
          nodes.set(threadId, node);
          changed = true;
        }
        // Re-place rather than re-create when a row re-renders around it: the
        // portal keeps working as long as this is the same node.
        const { parent, before, push } = placement(row, node);
        if (node.parentElement !== parent || node.nextElementSibling !== before) {
          parent.insertBefore(node, before);
        }
        node.style.marginLeft = push ? "auto" : "";
        // The slack is about the gap to the indicator, which is there whenever
        // a trailing column is — including from inside the inset column, where
        // the badge is the last thing before it.
        const trailing = push ? trailingColumn(row, node) : before;
        node.style.marginRight = trailing === null ? "4px" : TRAILING_SLACK;
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
  // Sorted once per settings change rather than once per row: this list is the
  // same for every row and there is one row per visible thread.
  const badges = useMemo(() => orderedBadgeTypes(values), [values]);
  useBadgeCap(maxBadges(values));
  return (
    <>
      {slots.map(({ threadId, node }) =>
        createPortal(
          <RowBadges
            badges={badges}
            revision={revision}
            threadId={threadId}
            values={values}
          />,
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
