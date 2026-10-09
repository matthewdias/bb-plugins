// The list of switches, one per item any window has seen. The same component
// is the plugin's settings section and the thread panel tab; in the panel the
// thread stays in view, so a switch shows its effect as you flip it.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { Item, Surface } from "../lib/items";
import { CHANGED } from "../lib/state";
import type { rpcContract } from "../server";

interface Entry {
  key: string;
  item: Item;
}

const GROUPS: { surface: Surface; title: string; empty: string }[] = [
  {
    surface: "header",
    title: "Thread header",
    empty: "Nothing yet. Open a thread and its header controls appear here.",
  },
  {
    surface: "banner",
    title: "Banners above the composer",
    empty: "Nothing yet. Open a thread and the plugins that add banners appear here.",
  },
  {
    surface: "message",
    title: "Message actions",
    empty: "Nothing yet. Open a thread with messages and their actions appear here.",
  },
];

/**
 * Plugin display names, best effort. The SDK has no way to list plugins, so
 * this reads the endpoint bb's own Plugins screen uses; when that fails the
 * list shows plugin ids instead.
 */
function usePluginNames(): ReadonlyMap<string, string> {
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  useEffect(() => {
    let live = true;
    fetch("/api/v1/plugins", { credentials: "same-origin" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: unknown) => {
        const plugins = (body as { plugins?: unknown } | null)?.plugins;
        if (!live || !Array.isArray(plugins)) return;
        const next = new Map<string, string>();
        for (const plugin of plugins as { id?: unknown; name?: unknown }[]) {
          if (typeof plugin.id === "string" && typeof plugin.name === "string") {
            next.set(plugin.id, plugin.name);
          }
        }
        setNames(next);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return names;
}

export function describeItem(item: Item, names: ReadonlyMap<string, string>): { name: string; source: string } {
  const plugin = item.pluginId === null ? null : (names.get(item.pluginId) ?? item.pluginId);
  if (item.surface === "banner") return { name: plugin ?? "Banner", source: "" };
  if (item.surface === "message") return { name: item.label ?? "", source: "" };
  return { name: item.label ?? "", source: plugin ?? "bb" };
}

function Toggle({ shown, label, onChange }: { shown: boolean; label: string; onChange: (shown: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={shown}
      aria-label={`Show ${label}`}
      onClick={() => onChange(!shown)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        shown ? "bg-primary" : "bg-muted-foreground/30"
      }`}
    >
      <span
        className={`inline-block size-4 rounded-full bg-background shadow transition-transform ${
          shown ? "translate-x-[18px]" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

export function Customize() {
  const rpc = useRpc<typeof rpcContract>();
  const names = usePluginNames();
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const state = await rpc.call("state_get");
      setEntries(state.items.map(({ key, item }) => ({ key, item })));
      setHidden(new Set(state.hidden));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [rpc]);

  useEffect(() => void load(), [load]);
  useRealtime(CHANGED, () => void load());

  const toggle = (key: string, shown: boolean) => {
    setHidden((current) => {
      const next = new Set(current);
      if (shown) next.delete(key);
      else next.add(key);
      return next;
    });
    rpc.call("hidden_set", { key, hidden: !shown }).then(
      (result) => setHidden(new Set(result.hidden)),
      (cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
        void load();
      },
    );
  };

  const showAll = () => {
    rpc.call("hidden_reset").then(
      () => setHidden(new Set()),
      (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)),
    );
  };

  const groups = useMemo(
    () =>
      GROUPS.map((group) => ({
        ...group,
        rows: (entries ?? [])
          .filter((entry) => entry.item.surface === group.surface)
          .map((entry) => ({ ...entry, ...describeItem(entry.item, names) }))
          .sort((a, b) => a.source.localeCompare(b.source) || a.name.localeCompare(b.name)),
      })),
    [entries, names],
  );

  if (entries === null) {
    return <p className="text-sm text-muted-foreground">{error ?? "Loading…"}</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {groups.map((group) => (
        <section key={group.surface} aria-label={group.title} className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">{group.title}</h3>
          {group.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{group.empty}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
              {group.rows.map((row) => (
                <li key={row.key} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className={`truncate text-sm ${hidden.has(row.key) ? "text-muted-foreground" : ""}`}>
                      {row.name}
                    </div>
                    {row.source ? <div className="truncate text-xs text-muted-foreground">{row.source}</div> : null}
                  </div>
                  <Toggle shown={!hidden.has(row.key)} label={row.name} onChange={(shown) => toggle(row.key, shown)} />
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
      {hidden.size > 0 ? (
        <div>
          <button
            type="button"
            onClick={showAll}
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
          >
            Show everything
          </button>
        </div>
      ) : null}
    </div>
  );
}
