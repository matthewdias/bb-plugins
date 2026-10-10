// The form a thread's agent asked with, for the banner above the composer.
//
// Module scope, like use-next-steps.ts: the banner, mounted for the life of
// the composer, does the fetching and writes here. The Follow Up page does not
// use this; its cards carry their forms in the page's own snapshot.
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useComposer, useRealtime, useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import type { Form } from "../lib/ask.ts";
import { isChangeSignal } from "./use-follow-ups.ts";

/** Must match ASK_CHANGED in server.ts. */
export const ASK_CHANGED = "followups-ask-changed";

const byThread = new Map<string, Form | null>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Replace a thread's form. Compared by `askedAt` and how much of it is done,
 * which between them change whenever the form does, so an unchanged refetch
 * does not redraw a form someone is filling in.
 */
export function setForm(threadId: string, form: Form | null): void {
  const current = byThread.get(threadId) ?? null;
  if (
    current === form ||
    (current !== null &&
      form !== null &&
      current.askedAt === form.askedAt &&
      Object.keys(current.done).length === Object.keys(form.done).length)
  ) {
    return;
  }
  byThread.set(threadId, form);
  for (const listener of listeners) listener();
}

export function useForm(threadId: string | null): Form | null {
  return useSyncExternalStore(
    subscribe,
    () => (threadId === null ? null : (byThread.get(threadId) ?? null)),
    () => null,
  );
}

/** Keep this thread's form fresh. Called by the banner alone. */
export function useFormFetch(threadId: string | null): void {
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
      const result = await rpcRef.current.call("ask_get", { threadId: target });
      setForm(target, result.form);
    } catch {
      // Keep the last good answer: a form that vanished for a beat because a
      // fetch failed would read as the agent withdrawing it.
    }
  }, []);

  useEffect(() => {
    void load(threadId);
  }, [threadId, connection, load]);

  useRealtime(ASK_CHANGED, (payload) => {
    if (isChangeSignal(payload) && payload.threadId === threadIdRef.current) void load(payload.threadId);
  });

  // A form is written during a turn and shown after it, so the end of a turn
  // is the moment to ask, in case realtime was down when it landed.
  const running = composer.isRunning;
  const wasRunning = useRef(running);
  useEffect(() => {
    if (wasRunning.current && !running) void load();
    wasRunning.current = running;
  }, [running, load]);
}
