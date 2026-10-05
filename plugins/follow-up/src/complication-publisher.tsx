// The provider half of the follow-up progress complication.
//
// Mounted once per window as an app overlay, so it lives exactly as long as
// this bundle does — and it hears `followups-changed` for every thread, which
// is the signal no other plugin can. Surfaces say which threads they are
// showing; this answers them through the batch counts call, then answers again
// whenever one of those threads changes. That is the whole liveness fix: a
// ring drawn by Thread Badges moves the moment a follow-up is recorded,
// instead of on its next 30-second poll.
//
// It renders nothing. A component, not a content script, because the realtime
// subscription and the RPC client are hooks.
import { useEffect, useRef } from "react";
import { useRealtime, useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import { getComplications } from "../lib/complications.ts";
import { progressRegistration, progressValue } from "../lib/progress-complication.ts";
import { isChangeSignal } from "./use-follow-ups.ts";

/** Long enough that a sidebar mounting its rows lands in one request. */
const BATCH_DELAY = 25;

/** The counts call's own ceiling — `COUNTS_MAX_THREADS` in server.ts. */
const MAX_THREADS = 500;

interface Provider {
  ask(threadIds: Iterable<string>): void;
  isWanted(threadId: string): boolean;
  wanted(): string[];
}

export function ComplicationPublisher(): null {
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const rpcRef = useRef(rpc);
  rpcRef.current = rpc;
  const provider = useRef<Provider | null>(null);

  useEffect(() => {
    const registry = getComplications();
    if (registry === null) return;
    let live = true;
    let timer = 0;
    const pending = new Set<string>();

    const flush = () => {
      timer = 0;
      const threadIds = [...pending];
      pending.clear();
      for (let start = 0; start < threadIds.length; start += MAX_THREADS) {
        const chunk = threadIds.slice(start, start + MAX_THREADS);
        rpcRef.current
          .call("getFollowUpCountsV1", { threadIds: chunk })
          .then(({ counts }) => {
            if (!live) return;
            for (const entry of counts) {
              handle.set({ kind: "thread", id: entry.threadId }, progressValue(entry));
            }
          })
          // Keep the last good value: a failed refresh is not "no follow-ups".
          .catch(() => undefined);
      }
    };

    const ask = (threadIds: Iterable<string>) => {
      for (const threadId of threadIds) pending.add(threadId);
      if (pending.size > 0 && timer === 0) timer = window.setTimeout(flush, BATCH_DELAY);
    };

    const handle = registry.provide(progressRegistration(ask));
    provider.current = {
      ask,
      isWanted: (threadId) => handle.isWanted({ kind: "thread", id: threadId }),
      wanted: () => handle.wanted().map((subject) => subject.id),
    };

    return () => {
      live = false;
      window.clearTimeout(timer);
      provider.current = null;
      handle.dispose();
    };
  }, []);

  // Only threads someone is drawing. One that scrolled away keeps its last
  // value in the registry, and wanting it again asks afresh.
  useRealtime("followups-changed", (payload) => {
    if (isChangeSignal(payload) && provider.current?.isWanted(payload.threadId)) {
      provider.current.ask([payload.threadId]);
    }
  });

  // Realtime drops signals while it is down, so a reconnect re-asks for
  // everything on screen rather than trusting what it may have missed.
  useEffect(() => {
    provider.current?.ask(provider.current.wanted());
  }, [connection]);

  return null;
}
