// The overlay: draws nothing of its own, holds the SDK hooks, runs the gestures.
//
// The controller (lib/controller.ts) is plain DOM and knows nothing of React
// or the SDK. This hands it what it needs: the settings it runs under, what
// swiping each thread's row offers, and bb's icons for it. A settings change
// stops it and starts a new one. Threads are read through a ref, so a list
// update doesn't interrupt a swipe.
//
// What a row offers comes from three places. Its buttons are the user's row
// actions, the thread list's preference (useRowActions). Its two whole swipes
// are this plugin's settings. What each of those actions is for one thread,
// its label, icon and what it does, is bb's to say, through a hook that takes
// one thread. So the overlay keeps one component mounted for the
// thread being swiped (SwipedThread), and renders it at once when the
// controller asks about a row.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import {
  type PluginSidebarThread,
  type PluginThreadActionEntry,
  type PluginThreadActionTarget,
  experimental_Icon as Icon,
  experimental_useSidebarThreads,
  experimental_useThreadActions,
  useRealtimeConnectionState,
  useSdk,
  useSettings,
} from "@get-bb/plugin-sdk/app";
import { startGestures } from "../lib/controller.ts";
import { createHaptics } from "../lib/haptics.ts";
import { canGo, go } from "../lib/history.ts";
import {
  FALLBACK_ROW_ACTIONS,
  type RowActionKeys,
  THREAD_LIST,
  keysOf,
  rowContent,
  threadListPreferencesSchema,
} from "../lib/row-actions.ts";
import {
  hapticsEnabled,
  hidesRowActions,
  isDesktopApp,
  parseGestureSettings,
  parseSwipeActions,
} from "../lib/settings.ts";

/** bb's compact layout, where the sidebar is a drawer: below Tailwind's md. */
const COMPACT_QUERY = "(max-width: 767px)";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
/**
 * Read the row actions at most this often. Every swipe, and every scroll that
 * starts over a row, asks for them.
 */
const ROW_ACTIONS_REFRESH_MS = 1000;
/** On <html> while bb's own row buttons are hidden. See swipe-controls.css. */
const HIDE_ROW_ACTIONS_ATTRIBUTE = "data-bbsc-hide-row-actions";

/**
 * The user's row actions: the thread list's `rowActions` preference, as
 * thread action keys.
 *
 * Another plugin can call the thread list's RPC, but not hear its realtime
 * signal when the preference changes, so this reads it again instead: on
 * load, on reconnecting, when the window comes back, and when a swipe starts.
 * The last case is what catches a change made in this window, from a row's
 * Customize row actions. Until the first read lands, and whenever the thread
 * list can't be asked, rows keep the last list read, or the fallback.
 */
function useRowActions() {
  const sdk = useSdk();
  const connection = useRealtimeConnectionState();
  const state = useRef({ keys: FALLBACK_ROW_ACTIONS, reading: false, readAt: -Infinity });

  const rowActions = useMemo(() => {
    const refresh = (now = false) => {
      const current = state.current;
      const at = performance.now();
      if (current.reading || (!now && at - current.readAt < ROW_ACTIONS_REFRESH_MS)) return;
      current.reading = true;
      current.readAt = at;
      sdk.plugins
        .callRpc({ ...THREAD_LIST, input: null, outputSchema: threadListPreferencesSchema })
        .then(
          (keys) => {
            current.keys = keys;
          },
          () => {},
        )
        .finally(() => {
          current.reading = false;
        });
    };
    return { get: (): readonly string[] => state.current.keys, refresh };
  }, [sdk]);

  useEffect(() => {
    if (connection === "connected") rowActions.refresh(true);
  }, [connection, rowActions]);

  useEffect(() => {
    rowActions.refresh(true);
    const onFocus = () => rowActions.refresh();
    const onVisibility = () => {
      if (document.visibilityState === "visible") rowActions.refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [rowActions]);

  return rowActions;
}

/** The thread as bb's thread actions take it, as bb's own list builds it. */
function targetOf(thread: PluginSidebarThread): PluginThreadActionTarget {
  return {
    id: thread.id,
    projectId: thread.projectId,
    parentThreadId: thread.parentThreadId,
    archivedAt: thread.archivedAt,
    pinnedAt: thread.pinnedAt,
    sectionId: thread.sectionId,
    isUnread: thread.isUnread,
    status: thread.status,
    environment:
      thread.environment?.id == null ? null : { id: thread.environment.id, path: thread.environment.path },
  };
}

interface Evaluated {
  threadId: string;
  entries: readonly PluginThreadActionEntry[];
}

/** Has bb evaluate `keys` for one thread, and leaves the result where the controller's question can read it. */
function SwipedThread({
  thread,
  keys,
  evaluated,
}: {
  thread: PluginSidebarThread;
  keys: readonly string[];
  evaluated: { current: Evaluated | null };
}) {
  const target = useMemo(() => targetOf(thread), [thread]);
  const entries = experimental_useThreadActions(target, { keys });
  // A layout effect, so it has run by the time flushSync returns.
  useLayoutEffect(() => {
    evaluated.current = { threadId: thread.id, entries };
  });
  return null;
}

interface IconSlot {
  id: number;
  slot: HTMLElement;
  name: string;
}

export function Gestures() {
  const { values, isLoading } = useSettings();
  const { threads } = experimental_useSidebarThreads();
  const rowActions = useRowActions();

  const byId = useMemo(() => new Map(threads.map((thread) => [thread.id, thread])), [threads]);

  const live = useRef({ byId, haptics: hapticsEnabled(values), swipes: parseSwipeActions(values) });
  live.current = { byId, haptics: hapticsEnabled(values), swipes: parseSwipeActions(values) };

  const [swiped, setSwiped] = useState<{ threadId: string; keys: RowActionKeys } | null>(null);
  const evaluated = useRef<Evaluated | null>(null);
  const [icons, setIcons] = useState<readonly IconSlot[]>([]);
  const nextIconId = useRef(0);

  const settings = parseGestureSettings(values, isDesktopApp(window));
  const settingsKey = JSON.stringify(settings);

  useEffect(() => {
    // Start under the user's settings, not the defaults: rows marked for a
    // swipe the user turned off would change how bb's drawer closes.
    if (isLoading) return;
    const haptics = createHaptics(window);
    return startGestures({
      doc: document,
      settings: JSON.parse(settingsKey),
      compact: () => window.matchMedia(COMPACT_QUERY).matches,
      reducedMotion: () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
      row: (threadId) => {
        const thread = live.current.byId.get(threadId);
        if (thread === undefined || thread.isArchived) return null;
        // Asked from a wheel or touch listener, outside React, with the swipe
        // already moving: render SwipedThread now, not when React gets to it.
        const keys = { rowActions: rowActions.get(), ...live.current.swipes };
        flushSync(() => setSwiped({ threadId, keys }));
        const read = evaluated.current;
        return read?.threadId === threadId ? rowContent(read.entries, thread, keys) : null;
      },
      refreshRowActions: () => rowActions.refresh(),
      drawIcon: (slot, name) => {
        const id = (nextIconId.current += 1);
        setIcons((current) => [...current, { id, slot, name }]);
        return () => setIcons((current) => current.filter((icon) => icon.id !== id));
      },
      canGo: (direction) => canGo(direction),
      go: (direction) => go(direction),
      haptic: (kind) => {
        if (live.current.haptics) haptics.play(kind);
      },
    });
  }, [settingsKey, isLoading, rowActions]);

  // Hidden by a rule on <html>, not by touching bb's rows: bb re-renders them,
  // and the rule goes the moment the plugin does.
  const hideRowActions = !isLoading && hidesRowActions(values);
  useEffect(() => {
    if (!hideRowActions) return;
    document.documentElement.setAttribute(HIDE_ROW_ACTIONS_ATTRIBUTE, "");
    return () => document.documentElement.removeAttribute(HIDE_ROW_ACTIONS_ATTRIBUTE);
  }, [hideRowActions]);

  const swipedThread = swiped === null ? undefined : byId.get(swiped.threadId);
  const swipedKeys = useMemo(() => (swiped === null ? [] : keysOf(swiped.keys)), [swiped]);

  return (
    <>
      {swiped !== null && swipedThread !== undefined && (
        <SwipedThread key={swiped.threadId} thread={swipedThread} keys={swipedKeys} evaluated={evaluated} />
      )}
      {icons.map((icon) => createPortal(<Icon name={icon.name} aria-hidden />, icon.slot, String(icon.id)))}
    </>
  );
}
