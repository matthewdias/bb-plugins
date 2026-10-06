// The offer under a thread's latest reply, for the card and the palette.
//
// Module scope, like store.ts, for the same reason: the palette's "take a next
// step" commands run outside any component and still need to know what is on
// offer. The banner, which is mounted for the life of the composer, does the
// fetching and writes here; everything else reads.
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import {
  useComposer,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "../server";
import type { NextOffer } from "../lib/next-steps.ts";
import { isChangeSignal } from "./use-follow-ups.ts";
import type { FollowUpRpc } from "./rpc.ts";

/** Must match NEXT_CHANGED in server.ts. */
export const NEXT_CHANGED = "followups-next-changed";

const byThread = new Map<string, NextOffer | null>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Replace a thread's offer. Compared by `offeredAt` and step count, which
 * between them change whenever the offer does — a new offer gets a new
 * timestamp, and keeping a step removes one — so an unchanged refetch does not
 * wake every subscriber.
 */
export function setOffer(threadId: string, offer: NextOffer | null): void {
  const current = byThread.get(threadId) ?? null;
  if (
    current === offer ||
    (current !== null &&
      offer !== null &&
      current.offeredAt === offer.offeredAt &&
      current.steps.length === offer.steps.length &&
      current.goalMet === offer.goalMet)
  ) {
    return;
  }
  byThread.set(threadId, offer);
  for (const listener of listeners) listener();
}

/** Read once, for callbacks that cannot use hooks — the palette commands. */
export function peekOffer(threadId: string | null): NextOffer | null {
  return threadId === null ? null : (byThread.get(threadId) ?? null);
}

export function useOffer(threadId: string | null): NextOffer | null {
  return useSyncExternalStore(
    subscribe,
    () => peekOffer(threadId),
    () => null,
  );
}

/**
 * Keep this thread's offer fresh. Called by the banner alone, so there is one
 * fetcher per composer however many surfaces read the result.
 */
export function useNextStepsFetch(threadId: string | null): () => void {
  const composer = useComposer();
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const threadIdRef = useRef(threadId);
  const rpcRef = useRef(rpc);
  threadIdRef.current = threadId;
  rpcRef.current = rpc;

  const load = useCallback(async (target = threadIdRef.current) => {
    if (target === null) return;
    try {
      const result = await rpcRef.current.call("followups_next_get", { threadId: target });
      setOffer(target, result.offer);
    } catch {
      // Keep the last good answer. An offer that vanished for a beat because a
      // fetch failed would read as the agent withdrawing it.
    }
  }, []);

  useEffect(() => {
    void load(threadId);
  }, [threadId, connection, load]);

  useRealtime(NEXT_CHANGED, (payload) => {
    if (isChangeSignal(payload) && payload.threadId === threadIdRef.current) {
      void load(payload.threadId);
    }
  });

  // An offer is written during a turn and shown after it, so the end of a turn
  // is the moment to ask, in case realtime was down when it landed.
  const running = composer.isRunning;
  const wasRunning = useRef(running);
  useEffect(() => {
    if (wasRunning.current && !running) void load();
    wasRunning.current = running;
  }, [running, load]);

  return useCallback(() => {
    void load();
  }, [load]);
}

export const STALE_OFFER = "That offer was replaced by a newer one. Pick again.";
export const SEND_FAILED = "It was not sent. Try again.";

/**
 * Press a step: the chip and the palette's "take a next step" commands both
 * come here, so they cannot come to disagree about what a press does or says.
 * A refusal is a toast, because neither caller has anywhere else to put it.
 */
export async function takeStep(
  rpc: FollowUpRpc,
  threadId: string,
  offer: NextOffer,
  index: number,
): Promise<"sent" | "queued" | "stale" | "failed"> {
  try {
    const result = await rpc.call("followups_next_take", {
      threadId,
      offeredAt: offer.offeredAt,
      index,
    });
    if (result.outcome === "sent" || result.outcome === "queued") {
      // The server cleared it before sending; this just does not wait for the
      // signal to say so.
      setOffer(threadId, null);
      return result.outcome;
    }
    toast.error(result.outcome === "stale" ? STALE_OFFER : SEND_FAILED);
    const fresh = await rpc.call("followups_next_get", { threadId });
    setOffer(threadId, fresh.offer);
    return result.outcome;
  } catch {
    toast.error(SEND_FAILED);
    return "failed";
  }
}
