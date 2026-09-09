// Fetching for the composer banner.
//
// This used to live in a separate always-mounted pill, because the banner
// unmounted on collapse and so could not be the fetcher. The banner now keeps
// a one-line summary when collapsed instead of disappearing, so it is always
// mounted whenever the thread has rows — and the pair, along with the reason
// this logic sat somewhere else, is gone.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  useComposerView,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import type { FollowUp } from "../lib/followups.ts";
import { setRows, useFollowUpState } from "./store.ts";
import { rememberRpc } from "./rpc.ts";

/** Shared with the panel, which subscribes to the same signal separately. */
export function isChangeSignal(payload: unknown): payload is { threadId: string } {
  return (
    typeof payload === "object" &&
    payload !== null &&
    typeof (payload as { threadId?: unknown }).threadId === "string"
  );
}

export function useFollowUps(threadId: string | null): {
  rows: FollowUp[];
  done: FollowUp[];
  collapsed: boolean;
  showDone: boolean;
  /** Has this thread ever tracked a follow-up — the empty state's gate. */
  everRecorded: boolean;
  reload: () => void;
} {
  const view = useComposerView();
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const state = useFollowUpState(threadId);
  // Not in the shared store with the rows: the store is written by every
  // mutation response, and those do not carry this — it cannot change once
  // true, so asking for it on every dismiss would be re-asking a settled
  // question. It lives here, set by the list call that is the only thing that
  // answers it.
  const [everRecorded, setEverRecorded] = useState(false);

  const threadIdRef = useRef(threadId);
  const rpcRef = useRef(rpc);
  threadIdRef.current = threadId;
  rpcRef.current = rpc;

  const load = useCallback(async (target = threadIdRef.current) => {
    if (target === null) return;
    try {
      const result = await rpcRef.current.call("followups_list", { threadId: target });
      // Drop a response the composer has already moved on from.
      if (threadIdRef.current !== target) return;
      setRows(target, result.followUps, result.done);
      setEverRecorded(result.everRecorded);
    } catch {
      // Keep the last good snapshot rather than blanking on a transient reload.
    }
  }, []);

  // Keyed on the thread alone, not on `connection`: this is per-thread, and
  // carrying the previous thread's answer across a switch would show the empty
  // state for a frame on a thread that has never recorded anything. A reconnect
  // is not a switch, and clearing there would blink the card off and back.
  useEffect(() => {
    setEverRecorded(false);
  }, [threadId]);

  useEffect(() => {
    void load(threadId);
  }, [threadId, connection, load]);

  // Hand the client to callbacks that cannot use hooks — the messageAction.
  useEffect(() => {
    rememberRpc(rpc);
  }, [rpc]);

  useRealtime("followups-changed", (payload) => {
    if (isChangeSignal(payload) && payload.threadId === threadIdRef.current) {
      void load(payload.threadId);
    }
  });

  // A turn ending is when new follow-ups appear, and realtime can be down.
  const running = view.run.isRunning;
  const wasRunning = useRef(running);
  useEffect(() => {
    if (wasRunning.current && !running) void load();
    wasRunning.current = running;
  }, [running, load]);

  const reload = useCallback(() => {
    void load();
  }, [load]);

  return { ...state, everRecorded, reload };
}
