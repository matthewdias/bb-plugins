// Reading a complication another plugin provides.
//
// The consumer side of ../lib/complications: a row says it is showing a thread,
// and re-renders when the provider publishes for it. Only enabled complications
// mount a badge, so a provider is never asked about one you have switched off.
import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  getComplications,
  type ComplicationSubject,
  type ComplicationValue,
} from "../lib/complications";

const registry = getComplications();

export function useComplication(
  id: string,
  threadId: string,
): { provided: boolean; value: ComplicationValue | null | undefined } {
  const subscribePresence = useCallback(
    (listener: () => void) => registry?.subscribe(id, null, listener) ?? (() => undefined),
    [id],
  );
  const readPresence = useCallback(() => registry?.isProvided(id) ?? false, [id]);
  const provided = useSyncExternalStore(subscribePresence, readPresence, readPresence);

  const subscribeValue = useCallback(
    (listener: () => void) =>
      registry?.subscribe(id, thread(threadId), listener) ?? (() => undefined),
    [id, threadId],
  );
  const readValue = useCallback(() => registry?.read(id, thread(threadId)), [id, threadId]);
  const value = useSyncExternalStore(subscribeValue, readValue, readValue);

  // Wanted whether or not a provider is there yet: one that loads later is
  // handed everything already wanted, so rows mounted first are not skipped.
  useEffect(() => registry?.want(id, thread(threadId)), [id, threadId]);

  return { provided, value };
}

function thread(id: string): ComplicationSubject {
  return { kind: "thread", id };
}
