// The Threads tab's hover card: the threads that want something, without
// going back to the thread list to find them.
//
// The tab can say "2 need you"; it cannot say which two. Resting on it opens
// this card: what is waiting for an answer, what is running, what finished
// since you last looked, and the threads you were in recently. A row goes
// straight to its thread. It works on Threads too, where it is quicker than
// scanning a long thread list for the ones that want something.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import * as HoverCard from "@radix-ui/react-hover-card";
import {
  experimental_useSidebarThreads,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { usePortalScopeProps } from "../lib/portal-scope.ts";
import { ago, groupThreads, type ThreadGroups } from "../lib/tabs-model.ts";

export const SwitcherTrigger = HoverCard.Trigger;

interface ThreadSwitcherProps {
  children: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The thread on screen, if Threads is in view: not "recent", and marked. */
  currentThreadId: string | null;
  /** Opened from the keyboard: the first row takes focus. */
  focusFirst: boolean;
  recentThreadIds: readonly string[];
  onOpenThread: (thread: PluginSidebarThread) => void;
}

export function ThreadSwitcher(props: ThreadSwitcherProps) {
  const scope = usePortalScopeProps();
  return (
    <HoverCard.Root
      open={props.open}
      openDelay={450}
      closeDelay={150}
      onOpenChange={props.onOpenChange}
    >
      {props.children}
      <HoverCard.Portal>
        <HoverCard.Content
          className="bb-top-tabs-menu bb-top-tabs-switcher"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          {...scope}
        >
          {props.open && (
            <SwitcherBody
              recentThreadIds={props.recentThreadIds}
              currentThreadId={props.currentThreadId}
              focusFirst={props.focusFirst}
              onOpenThread={props.onOpenThread}
            />
          )}
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
}

function SwitcherBody({
  recentThreadIds,
  currentThreadId,
  focusFirst,
  onOpenThread,
}: Pick<ThreadSwitcherProps, "recentThreadIds" | "currentThreadId" | "focusFirst" | "onOpenThread">) {
  const { threads, projects } = experimental_useSidebarThreads();
  // The thread on screen is where you are, not somewhere you were.
  const groups = useMemo(
    () => groupThreads(threads, recentThreadIds.filter((id) => id !== currentThreadId)),
    [threads, recentThreadIds, currentThreadId],
  );
  const projectName = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);
  // Ages tick over while the card is open.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const list = useRef<HTMLDivElement>(null);
  // Opened from the keyboard, the first row takes focus; from a hover it
  // does not, so the card never pulls focus out of what you were doing.
  useEffect(() => {
    if (focusFirst) list.current?.querySelector<HTMLButtonElement>(".bb-top-tabs-switcher-row")?.focus();
  }, [focusFirst]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const rows = Array.from(list.current?.querySelectorAll<HTMLButtonElement>(".bb-top-tabs-switcher-row") ?? []);
    const index = rows.indexOf(document.activeElement as HTMLButtonElement);
    event.preventDefault();
    const next = index === -1 ? 0 : (index + (event.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
    rows[next]?.focus();
  };

  const sections: [keyof ThreadGroups<PluginSidebarThread>, string][] = [
    ["needsYou", "Needs you"],
    ["running", "Running"],
    ["finished", "Finished"],
    ["recent", "Recent"],
  ];
  const empty = sections.every(([key]) => groups[key].length === 0);

  return (
    <div ref={list} className="bb-top-tabs-switcher-body" onKeyDown={onKeyDown}>
      {empty && <div className="bb-top-tabs-menu-label">Nothing needs you.</div>}
      {sections.map(([key, title]) =>
        groups[key].length === 0 ? null : (
          <section key={key} className="bb-top-tabs-switcher-section">
            <div className="bb-top-tabs-menu-label">
              {title}
              {key !== "recent" && <span className="bb-top-tabs-switcher-count">{groups[key].length}</span>}
            </div>
            {groups[key].map((thread) => (
              <button
                key={thread.id}
                type="button"
                className="bb-top-tabs-switcher-row"
                data-current={thread.id === currentThreadId ? "" : undefined}
                aria-current={thread.id === currentThreadId ? "page" : undefined}
                title={thread.indicatorLabel ?? thread.displayTitle}
                onClick={() => onOpenThread(thread)}
              >
                <span className="bb-top-tabs-mark" data-kind={markKind(key, thread)} aria-hidden="true" />
                <span className="bb-top-tabs-switcher-title">{thread.displayTitle}</span>
                <span className="bb-top-tabs-switcher-meta">
                  {projectName.get(thread.projectId) ?? ""}
                  {projectName.has(thread.projectId) ? " · " : ""}
                  {ago(thread.latestAttentionAt ?? thread.updatedAt, now)}
                </span>
              </button>
            ))}
          </section>
        ),
      )}
    </div>
  );
}

function markKind(section: keyof ThreadGroups<PluginSidebarThread>, thread: PluginSidebarThread) {
  if (section === "needsYou") return "waiting";
  if (section === "running") return "running";
  if (section === "finished") return thread.indicator === "unread-error" ? "error" : "done";
  return "none";
}
