// Reading complications for one thread, from every provider at once.
//
// The consumer side of ../lib/complications, as Thread Badges reads it
// (badges/complication.ts, badges/use-complication-providers.ts), widened from
// one provider to a list: the card and the header draw every provider, and a
// hook per provider cannot be called in a loop.
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import {
  getComplications,
  type ComplicationProviderInfo,
  type ComplicationSubject,
  type ComplicationValue,
} from "../lib/complications";

const registry = getComplications();
const NONE: readonly ComplicationProviderInfo[] = [];

/** A provider that answers threads, or does not say which subjects it answers. */
export function answersThreads(provider: ComplicationProviderInfo): boolean {
  return provider.subjects === undefined || provider.subjects.includes("thread");
}

/** Every live provider that can speak about a thread, in registration order. */
export function useThreadProviders(): readonly ComplicationProviderInfo[] {
  const subscribe = useCallback(
    (listener: () => void) => registry?.subscribeProviders(listener) ?? (() => undefined),
    [],
  );
  // `providers()` keeps its identity until something changes, so it is a safe
  // snapshot; the filter is memoised on it for the same reason.
  const read = useCallback(() => registry?.providers() ?? NONE, []);
  const all = useSyncExternalStore(subscribe, read, read);
  return useMemo(() => all.filter(answersThreads), [all]);
}

export function thread(id: string): ComplicationSubject {
  return { kind: "thread", id };
}

type Values = readonly (ComplicationValue | null | undefined)[];

/**
 * Each provider's value for one thread, in the order of `ids`, re-rendering
 * when any of them changes. Wanted for as long as this is mounted, whether or
 * not a provider is there yet: one that loads later is handed what was wanted.
 */
export function useThreadValues(ids: readonly string[], threadId: string): Values {
  const key = ids.join("\n");
  const last = useRef<Values>([]);

  const subscribe = useCallback(
    (listener: () => void) => {
      const releases = ids.map(
        (id) => registry?.subscribe(id, thread(threadId), listener) ?? (() => undefined),
      );
      return () => {
        for (const release of releases) release();
      };
    },
    // `key` stands for `ids`, whose identity changes on every render.
    [key, threadId],
  );

  // A snapshot must keep its identity while nothing changed; the registry's
  // values do, so the array is rebuilt only when one of them moved.
  const read = useCallback(() => {
    const next = ids.map((id) => registry?.read(id, thread(threadId)));
    const previous = last.current;
    if (next.length === previous.length && next.every((value, index) => value === previous[index])) {
      return previous;
    }
    last.current = next;
    return next;
  }, [key, threadId]);

  const values = useSyncExternalStore(subscribe, read, read);

  useEffect(() => {
    const releases = ids.map((id) => registry?.want(id, thread(threadId)) ?? (() => undefined));
    return () => {
      for (const release of releases) release();
    };
  }, [key, threadId]);

  return values;
}
