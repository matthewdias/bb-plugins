// The ports badge: a plug on threads whose worktree is serving something.
//
// Like the follow-ups ring this reads another plugin's state — Worktree Ports'
// snapshot — and ./port-counts owns the one request that answers for the whole
// sidebar. Worktree Ports absent, disabled, or answering something unreadable
// all end the same way: no plug, nothing else affected.
//
// The glyph is `ElectricPlugs` because that is the one Worktree Ports puts on
// its own rows and pills, and a reader who has seen it there should not have to
// learn a second symbol for the same fact.
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { Icon } from "@/components/ui/icon";
import { getPorts, requestPorts, subscribePorts, type ThreadPort } from "./port-counts";
import type { BadgeProps } from "./components";

function useThreadPorts(threadId: string, revision: number): readonly ThreadPort[] | null {
  // `revision` is the host's focus signal, shared by every row, so all of them
  // ask again on the same tick and the store collapses that into one request.
  // It is not the only refresh — the store polls every 10s — but it is the one
  // that fires the instant you come back, ahead of the next tick.
  useEffect(() => {
    requestPorts(revision);
  }, [revision]);

  // Memoised because React re-subscribes whenever this identity changes, and
  // these rows re-render constantly.
  const subscribe = useCallback(
    (listener: () => void) => subscribePorts(threadId, listener),
    [threadId],
  );
  const read = useCallback(() => getPorts(threadId), [threadId]);
  return useSyncExternalStore(subscribe, read, read);
}

/** "vite :5173 · 2 others", or a bare count when nothing is an app port. */
function describe(visible: readonly ThreadPort[], apps: readonly ThreadPort[]): string {
  const rest = visible.length - apps.length;
  if (apps.length === 0) {
    return `${visible.length} listening`;
  }
  const parts = apps.map((port) => `${port.name} :${port.port}`);
  if (rest > 0) parts.push(`${rest} ${rest === 1 ? "other" : "others"}`);
  return parts.join(" · ");
}

export function PortsBadge({ threadId, values, revision }: BadgeProps) {
  const ports = useThreadPorts(threadId, revision);
  // Null is "nothing to show", never an error: Worktree Ports missing, the
  // snapshot not read yet, and a worktree with no listeners all land here.
  if (ports === null || ports.length === 0) return null;

  const apps = ports.filter((port) => port.role === "app");
  // Off by default this badge would still be honest, but on by default it
  // would not: a worktree's only listener is very often the agent process's
  // own ephemeral loopback port, which is classified `internal` and means
  // nothing to anyone. Hiding those is what makes the plug worth looking at.
  const appsOnly = values.ports_appsOnly !== false;
  const visible = appsOnly ? apps : ports;
  if (visible.length === 0) return null;

  const label = describe(visible, apps);
  // Green when something the operator is actually developing is up, matching
  // the pull-request badge's open state; a row that is only running backing
  // services or loopback listeners stays quiet chrome.
  const color = apps.length > 0 ? "light-dark(#1a7f37, #3fb950)" : "var(--muted-foreground)";

  return (
    <span
      aria-label={label}
      style={{
        alignItems: "center",
        color,
        display: "inline-flex",
        fontSize: 11,
        gap: 2,
        lineHeight: 1,
      }}
      title={label}
    >
      <Icon aria-hidden name="ElectricPlugs" style={{ height: 14, width: 14 }} />
      {values.ports_showNumber === true ? <span>{visible[0]?.port}</span> : null}
    </span>
  );
}
