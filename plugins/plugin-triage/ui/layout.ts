// How the Triage page lays its cards out: dealt one at a time, or all at once
// as bb's own plugin store does, and in that grid, its order and groups. One
// choice for every tab, kept in this browser: the Plugins screen and the
// sidebar item's page share it, and another window follows a change through
// the storage event.
import { useSyncExternalStore } from "react";
import { DEFAULT_ARRANGEMENT, type Arrangement, type Grouping, type SortDirection, type SortKey } from "../lib/arrange";

export type Layout = "deck" | "grid";

/** A choice kept in localStorage under `key`, as text. */
function stored<T>(key: string, parse: (raw: string | null) => T | null, initial: T) {
  const listeners = new Set<() => void>();
  /** The choice when storage refuses it, as private browsing can. */
  let fallback = initial;
  // A snapshot must be the same value until it changes, so parsing is kept
  // per stored text rather than redone on every read.
  let last: { raw: string | null; value: T } | null = null;

  function read(): T {
    let raw: string | null;
    try {
      raw = window.localStorage.getItem(key);
    } catch {
      return fallback;
    }
    if (last === null || last.raw !== raw) last = { raw, value: parse(raw) ?? fallback };
    return last.value;
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    const onStorage = (event: StorageEvent) => event.key === key && listener();
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", onStorage);
    };
  }

  return {
    set(value: T, raw: string): void {
      fallback = value;
      try {
        window.localStorage.setItem(key, raw);
      } catch {
        // The choice then lasts until the page reloads.
      }
      for (const listener of listeners) listener();
    },
    use(): T {
      return useSyncExternalStore(subscribe, read, () => initial);
    },
  };
}

const layout = stored<Layout>("plugin-triage:layout", (raw) => (raw === "grid" || raw === "deck" ? raw : null), "deck");

export function setLayout(next: Layout): void {
  layout.set(next, next);
}

export function useLayout(): Layout {
  return layout.use();
}

const SORTS: readonly SortKey[] = ["deal", "name", "published", "installs"];
const DIRECTIONS: readonly SortDirection[] = ["asc", "desc"];
const GROUPINGS: readonly Grouping[] = ["none", "category", "source"];

function parseArrangement(raw: string | null): Arrangement | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as Partial<Arrangement>;
    return {
      sort: SORTS.includes(value.sort as SortKey) ? (value.sort as SortKey) : DEFAULT_ARRANGEMENT.sort,
      direction: DIRECTIONS.includes(value.direction as SortDirection)
        ? (value.direction as SortDirection)
        : DEFAULT_ARRANGEMENT.direction,
      group: GROUPINGS.includes(value.group as Grouping) ? (value.group as Grouping) : DEFAULT_ARRANGEMENT.group,
    };
  } catch {
    return null;
  }
}

const arrangement = stored<Arrangement>("plugin-triage:arrangement", parseArrangement, DEFAULT_ARRANGEMENT);

export function setArrangement(next: Arrangement): void {
  arrangement.set(next, JSON.stringify(next));
}

export function useArrangement(): Arrangement {
  return arrangement.use();
}
