// The Follow Up page: every thread that needs you, answered in one place.
//
// A sidebar item opens it (see app.tsx). bb draws the title bar, so the page
// starts with what is waiting rather than its own name. Wide, the cards take
// the left and the two lanes the right; on a phone, three tabs.
import { useEffect, useMemo, useState } from "react";
import { useBbNavigate, type PluginHomepageSectionProps, type PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import type { Card } from "../../lib/page.ts";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { ago, PageCard } from "./cards.tsx";
import { FollowUpsLane, InMotion } from "./lanes.tsx";
import { usePage, usePageSummary, type PageSnapshot } from "./use-page.ts";

/** The sidebar item's path, as registered in app.tsx. */
export const PAGE_PATH = "page";

/** Ages on the cards move without a refetch. */
const CLOCK_MS = 30_000;

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}

const TIERS: Array<{ tier: Card["tier"]; title: string; note: string }> = [
  { tier: "blocked", title: "Blocked", note: "the agent is stopped until you answer" },
  { tier: "turn", title: "Your turn", note: "the turn ended with something for you" },
  { tier: "finished", title: "Finished", note: "nothing asked; read and move on" },
];

type Tab = "asks" | "running" | "followups";

export function FollowUpPage(_props: PluginNavPanelProps) {
  const { snapshot, failed, reload } = usePage();
  const compact = useIsCompactViewport();
  const [tab, setTab] = useState<Tab>("asks");
  const now = useNow();

  if (snapshot === null) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        {failed ? (
          <span className="flex items-center gap-2">
            The page could not load.
            <Button size="sm" variant="outline" onClick={reload}>
              Try again
            </Button>
          </span>
        ) : (
          <Icon name="Spinner" className="size-4 animate-spin" aria-label="Loading" />
        )}
      </div>
    );
  }

  const openRows = snapshot.followUps.reduce(
    (sum, group) => sum + group.threads.reduce((inner, thread) => inner + thread.rows.length, 0),
    0,
  );

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3 sm:px-6">
        <Summary snapshot={snapshot} openRows={openRows} />
        {compact && (
          <nav className="flex w-full rounded-lg border border-border p-0.5 text-xs" aria-label="Sections">
            {(
              [
                ["asks", `Needs you ${snapshot.count}`],
                ["running", `Working ${snapshot.running.length}`],
                ["followups", `Follow-ups ${openRows}`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={tab === key}
                onClick={() => setTab(key)}
                className={cn(
                  "flex-1 rounded-md px-2 py-1.5 text-muted-foreground",
                  tab === key && "bg-state-active font-medium text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </nav>
        )}
        {failed && (
          <span className="text-xs text-destructive">Showing the last update; the newest did not load.</span>
        )}
      </header>
      {compact ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-col gap-3 p-3">
            {tab === "asks" && <Cards snapshot={snapshot} now={now} />}
            {tab === "running" && <InMotion running={snapshot.running} now={now} />}
            {tab === "followups" && <FollowUpsLane groups={snapshot.followUps} />}
          </div>
        </div>
      ) : (
        // Two scrollers, not one: a long follow-ups lane shouldn't carry the
        // cards off screen, nor a long list of cards the lanes.
        <div className="mx-auto grid min-h-0 w-full max-w-6xl flex-1 grid-cols-[minmax(0,1fr)_20rem] gap-5 px-6">
          <div data-scroll="cards" className="min-h-0 overflow-y-auto py-5">
            <Cards snapshot={snapshot} now={now} />
          </div>
          <aside data-scroll="lanes" className="flex min-h-0 flex-col gap-3 overflow-y-auto py-5">
            <InMotion running={snapshot.running} now={now} />
            <FollowUpsLane groups={snapshot.followUps} />
          </aside>
        </div>
      )}
    </div>
  );
}

function Summary({ snapshot, openRows }: { snapshot: PageSnapshot; openRows: number }) {
  const blocked = snapshot.cards.filter((card) => card.tier === "blocked").length;
  const turn = snapshot.count - blocked;
  const parts = [
    blocked > 0 ? `${blocked} blocked` : null,
    turn > 0 ? `${turn} your turn` : null,
    `${snapshot.running.length} working`,
    `${openRows} follow-ups open`,
  ].filter((part): part is string => part !== null);
  return (
    <p className="text-sm text-muted-foreground">
      {snapshot.count === 0 ? <span className="font-medium text-foreground">Nothing needs you. </span> : null}
      {parts.map((part, index) => (
        <span key={part}>
          {index > 0 && " · "}
          <span className={cn(index === 0 && blocked > 0 && "font-medium text-amber-600 dark:text-amber-400")}>{part}</span>
        </span>
      ))}
    </p>
  );
}

function Cards({ snapshot, now }: { snapshot: PageSnapshot; now: number }) {
  const names = useMemo(() => new Map(snapshot.projects.map((project) => [project.id, project.name])), [snapshot.projects]);
  if (snapshot.cards.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
        No thread is waiting on you.
      </div>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {TIERS.map(({ tier, title, note }) => {
        const cards = snapshot.cards.filter((card) => card.tier === tier);
        if (cards.length === 0) return null;
        return (
          <section key={tier} aria-label={title} className="flex flex-col gap-2">
            <h2 className="mt-2 flex flex-wrap items-baseline gap-x-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground first:mt-0">
              {title}
              <span className="text-foreground">{cards.length}</span>
              <span className="font-normal normal-case tracking-normal">· {note}</span>
            </h2>
            {cards.map((card) => (
              <PageCard key={card.threadId} card={card} projectName={names.get(card.projectId) ?? null} now={now} />
            ))}
            {tier === "finished" && snapshot.moreFinished > 0 && (
              <p className="text-xs text-muted-foreground">
                {snapshot.moreFinished} more finished. The sidebar's unread dots have them.
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}

/**
 * The sidebar item's count: threads that want something from you. Plain text,
 * like Plugin Triage's, since a badge on every item is no signal at all.
 */
export function FollowUpPageCount() {
  const summary = usePageSummary();
  if (summary === null || summary.count <= 0) return null;
  return (
    <span className="text-[11px] tabular-nums text-muted-foreground" aria-label={`${summary.count} threads need you`}>
      {summary.count > 99 ? "99+" : summary.count}
    </span>
  );
}

/**
 * The new-thread page's strip: the first few threads that need you, each a
 * link to its thread, and a way into the page for the rest.
 */
export function NeedsYouStrip(_props: PluginHomepageSectionProps) {
  const summary = usePageSummary();
  const navigate = useBbNavigate();
  const now = useNow();
  if (summary === null || summary.top.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      {summary.top.map((card) => (
        <button
          key={card.threadId}
          type="button"
          onClick={() => navigate.toThread(card.threadId)}
          className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-state-hover"
        >
          <span
            aria-hidden
            className={cn(
              "size-2 shrink-0 rounded-full",
              card.tier === "blocked" ? "bg-amber-500" : card.lead === "stopped" ? "bg-destructive" : "bg-sky-500",
            )}
          />
          <span className="min-w-0 flex-1 truncate">{card.title}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{STRIP_LABEL[card.lead]}</span>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{ago(card.since, now)}</span>
        </button>
      ))}
      <button
        type="button"
        onClick={() => navigate.toPluginPanel(PAGE_PATH)}
        className="self-start px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
      >
        {summary.count > summary.top.length ? `All ${summary.count} on the Follow Up page` : "Open the Follow Up page"}
      </button>
    </div>
  );
}

const STRIP_LABEL: Record<Card["lead"], string> = {
  question: "asks a question",
  approval: "needs approval",
  form: "waits on a form",
  stopped: "stopped",
  "wrap-up": "ready to wrap up",
  next: "offers next steps",
  page: "asks on its page",
  pr: "has a PR for you",
  finished: "finished",
  workers: "has workers waiting",
};
