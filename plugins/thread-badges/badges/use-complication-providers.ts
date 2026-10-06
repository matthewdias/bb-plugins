// The complications other plugins provide that can be drawn on a thread row.
//
// Read live from the window's registry: a provider appears when its plugin's
// bundle registers it and disappears when that plugin stops, so the list in
// Settings and the badges on rows follow installs without a reload.
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { getComplications, type ComplicationProviderInfo } from "../lib/complications";

const registry = getComplications();
const NONE: readonly ComplicationProviderInfo[] = [];

/** A provider that answers threads, or does not say which subjects it answers. */
export function answersThreads(provider: ComplicationProviderInfo): boolean {
  return provider.subjects === undefined || provider.subjects.includes("thread");
}

export function useThreadProviders(): readonly ComplicationProviderInfo[] {
  const subscribe = useCallback(
    (listener: () => void) => registry?.subscribeProviders(listener) ?? (() => undefined),
    [],
  );
  // `providers()` keeps its identity until something changes, so it is a safe
  // snapshot; the filter below is memoised on it for the same reason.
  const read = useCallback(() => registry?.providers() ?? NONE, []);
  const all = useSyncExternalStore(subscribe, read, read);
  return useMemo(() => all.filter(answersThreads), [all]);
}
