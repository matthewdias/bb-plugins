// The Follow Up page's data: one snapshot, fetched again whenever something
// that could move a card changes.
//
// The server gathers everything (see page_snapshot in server.ts) and sends one
// signal for host changes — a question arriving, a thread going idle, a read
// mark moving. Follow Up's own changes — rows, offers, wrap-ups — already have
// signals of their own, which the banner listens to, so the page listens to
// those too rather than the server repeating them.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime, useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";
import type { FollowUpRpc } from "../rpc.ts";
import { PAGE_CHANGED, type Card, type LaneGroup, type Running } from "../../lib/page.ts";

export interface PageSnapshot {
  cards: Card[];
  /** Put away with "Not now": the Put away fold. */
  putAway: Card[];
  moreFinished: number;
  count: number;
  running: Running[];
  followUps: LaneGroup[];
  projects: Array<{ id: string; name: string }>;
}

export interface PageSummary {
  count: number;
  top: Card[];
}

/**
 * A burst of signals is one refetch. A turn ending moves a thread's status,
 * clears its offer and maybe writes a new one, all within a few milliseconds.
 */
const REFETCH_DEBOUNCE_MS = 200;

function useRefetchOnChange(refetch: () => void): void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  const schedule = useCallback(() => {
    if (timer.current !== null) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      refetchRef.current();
    }, REFETCH_DEBOUNCE_MS);
  }, []);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  useRealtime(PAGE_CHANGED, schedule);
  useRealtime("followups-changed", schedule);
  useRealtime("followups-next-changed", schedule);
  useRealtime("followups-wrap-up-changed", schedule);
  // Signals sent while the connection was down were missed, so a reconnect
  // is a reason to look again.
  const connection = useRealtimeConnectionState();
  const previous = useRef(connection);
  useEffect(() => {
    if (previous.current !== connection && connection === "connected") schedule();
    previous.current = connection;
  }, [connection, schedule]);
}

function useLatest<T>(
  fetch: (rpc: FollowUpRpc) => Promise<T>,
): { value: T | null; failed: boolean; reload: () => void } {
  const rpc = useRpc<typeof rpcContract>();
  const rpcRef = useRef(rpc);
  rpcRef.current = rpc;
  const fetchRef = useRef(fetch);
  fetchRef.current = fetch;
  const [value, setValue] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  // Only the newest answer is kept: a slow snapshot that lands after a newer
  // one would put the page back in time.
  const ticket = useRef(0);
  const load = useCallback(async () => {
    const mine = ++ticket.current;
    try {
      const next = await fetchRef.current(rpcRef.current);
      if (mine !== ticket.current) return;
      setValue(next);
      setFailed(false);
    } catch {
      if (mine === ticket.current) setFailed(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useRefetchOnChange(() => void load());
  return { value, failed, reload: () => void load() };
}

/** Everything the page shows. */
export function usePage(): { snapshot: PageSnapshot | null; failed: boolean; reload: () => void } {
  const { value, failed, reload } = useLatest((rpc) => rpc.call("page_snapshot", {}));
  return { snapshot: value, failed, reload };
}

/** The count and first cards: the sidebar item and the new-thread strip. */
export function usePageSummary(): PageSummary | null {
  return useLatest((rpc) => rpc.call("page_summary", {})).value;
}
