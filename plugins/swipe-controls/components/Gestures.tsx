// The overlay: draws nothing, holds the SDK hooks, runs the gestures.
//
// The controller (lib/controller.ts) is plain DOM and knows nothing of React
// or the SDK. This hands it what it needs: the settings it runs under, the
// facts about each thread it may swipe, and bb's own actions to take on them.
// A settings change stops it and starts a new one. Thread facts and actions
// are read through a ref, so a list update doesn't interrupt a swipe.
import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import {
  experimental_useSidebarThreadActions,
  experimental_useSidebarThreads,
  useSettings,
} from "@get-bb/plugin-sdk/app";
import { type ThreadFacts, startGestures } from "../lib/controller.ts";
import { createHaptics } from "../lib/haptics.ts";
import { canGo, go } from "../lib/history.ts";
import { hapticsEnabled, isDesktopApp, parseGestureSettings } from "../lib/settings.ts";

/** bb's compact layout, where the sidebar is a drawer: below Tailwind's md. */
const COMPACT_QUERY = "(max-width: 767px)";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function attempt(what: string, run: () => unknown): void {
  const fail = () => {
    toast.error(`Couldn't ${what}`);
  };
  try {
    const result = run();
    if (result instanceof Promise) result.catch(fail);
  } catch {
    fail();
  }
}

export function Gestures() {
  const { values, isLoading } = useSettings();
  const { threads } = experimental_useSidebarThreads();
  const actions = experimental_useSidebarThreadActions();

  const facts = useMemo(() => {
    const byId = new Map<string, ThreadFacts>();
    for (const thread of threads) {
      byId.set(thread.id, {
        isUnread: thread.isUnread,
        isPinned: thread.isPinned,
        isArchived: thread.isArchived,
      });
    }
    return byId;
  }, [threads]);

  const live = useRef({ facts, actions, haptics: hapticsEnabled(values) });
  live.current = { facts, actions, haptics: hapticsEnabled(values) };

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
      thread: (threadId) => live.current.facts.get(threadId) ?? null,
      setRead: (threadId, read) =>
        attempt(read ? "mark the thread read" : "mark the thread unread", () =>
          live.current.actions.setRead(threadId, read),
        ),
      setPinned: (threadId, pinned) =>
        attempt(pinned ? "pin the thread" : "unpin the thread", () =>
          live.current.actions.setPinned(threadId, pinned),
        ),
      archive: (threadId) => attempt("archive the thread", () => live.current.actions.archive(threadId)),
      canGo: (direction) => canGo(direction),
      go: (direction) => go(direction),
      haptic: (kind) => {
        if (live.current.haptics) haptics.play(kind);
      },
    });
  }, [settingsKey, isLoading]);

  return null;
}
