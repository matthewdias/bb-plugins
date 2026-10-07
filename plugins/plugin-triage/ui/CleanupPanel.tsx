// The Cleanup tab: installed plugins worth a second look, and what was
// removed from here lately.
import { useEffect, useState } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CleanupCard as Card, CleanupReason } from "../lib/cleanup-deck";
import type { RemoveJob } from "../lib/queue";
import { describeCost, type RemovalCost } from "../lib/removal-cost";
import { CardStack } from "./CardStack";
import { cleanupActions, decideCleanup, undoLastCleanup } from "./cleanup-decisions";
import { PluginIcon, ago } from "./EntryCard";
import { navigateInApp, pluginDetailsPath } from "./navigate";
import type { CleanupState, TriageRpc } from "./triage-store";

const date = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/** Why the card is in the deck, in a sentence. */
export function reasonText(reason: CleanupReason): { title: string; detail: string | null; tone?: "warn" } {
  switch (reason.kind) {
    case "broken":
      return { title: `Not working (${reason.status})`, detail: reason.detail, tone: "warn" };
    case "trial":
      return { title: "Did you miss it?", detail: `It has been off since ${date(reason.since)}, to try without it.` };
    case "disabled":
      return {
        title: "Turned off",
        detail: reason.since === null ? "Since before Plugin Triage was watching." : `Since ${date(reason.since)}.`,
      };
    case "idle":
      return {
        title: "No activity in a month",
        detail:
          reason.lastActiveAt === null
            ? `Nothing since Plugin Triage started watching, on ${date(reason.watchedSince)}.`
            : `Last seen in use on ${date(reason.lastActiveAt)}.`,
      };
  }
}

const costs = new Map<string, Promise<RemovalCost | null>>();

/** What uninstalling the top card's plugin would delete, asked once per plugin. */
function useCost(rpc: TriageRpc, pluginId: string | null): RemovalCost | null | undefined {
  const [loaded, setLoaded] = useState<{ pluginId: string; cost: RemovalCost | null } | null>(null);
  useEffect(() => {
    if (pluginId === null) return;
    let request = costs.get(pluginId);
    if (request === undefined) {
      request = rpc.call("cleanup_cost", { pluginId }).catch(() => null);
      costs.set(pluginId, request);
    }
    let live = true;
    void request.then((cost) => live && setLoaded({ pluginId, cost }));
    return () => {
      live = false;
    };
  }, [pluginId, rpc]);
  return loaded !== null && loaded.pluginId === pluginId ? loaded.cost : undefined;
}

/** Tests only. */
export function resetCosts(): void {
  costs.clear();
}

function CleanupCardView({ card, top, cost }: { card: Card; top: boolean; cost?: RemovalCost | null }) {
  const reason = reasonText(card.reason);
  return (
    <article
      className="flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-xl"
      aria-label={card.displayName}
    >
      <header className="flex items-center gap-3 px-4 pb-2 pt-4">
        <PluginIcon card={card} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold leading-tight">{card.displayName}</h2>
          <p className="truncate font-mono text-[11px] text-muted-foreground" title={card.source}>
            {card.source}
          </p>
        </div>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-hidden px-4 pt-2">
        <div
          className={cn(
            "rounded-lg border border-border bg-muted/40 p-3",
            reason.tone === "warn" && "border-amber-500/40 bg-amber-500/5",
          )}
        >
          <p className={cn("text-sm font-medium", reason.tone === "warn" && "text-amber-600 dark:text-amber-400")}>
            {reason.title}
          </p>
          {reason.detail !== null && <p className="mt-0.5 line-clamp-3 text-xs text-muted-foreground">{reason.detail}</p>}
        </div>
        {card.description !== null && <p className="line-clamp-3 text-sm leading-relaxed text-muted-foreground">{card.description}</p>}
        {card.surfaces.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {card.surfaces.map((surface) => (
              <span key={surface} className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                {surface}
              </span>
            ))}
          </div>
        )}
        {top && (
          <p className="text-xs text-muted-foreground" data-testid="removal-cost">
            {cost === undefined
              ? "Checking what uninstalling would delete…"
              : cost === null
                ? "Uninstalling deletes its settings, secrets and schedules, for good."
                : describeCost(cost)}
          </p>
        )}
      </div>
      {top && (
        <footer className="border-t border-border p-2">
          <Button variant="ghost" size="sm" className="w-full" onClick={() => navigateInApp(pluginDetailsPath(card.pluginId, "cleanup"))}>
            <Icon name="Info" aria-hidden /> Details
          </Button>
        </footer>
      )}
    </article>
  );
}

function Recent({ history }: { history: RemoveJob[] }) {
  if (history.length === 0) return null;
  return (
    <section className="mx-auto w-full max-w-md space-y-1">
      <h3 className="px-1 text-xs font-medium text-muted-foreground">Recent</h3>
      <ul className="divide-y divide-border rounded-xl border border-border">
        {history.map((job) => (
          <li key={job.id} className="flex items-center gap-3 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{job.displayName}</p>
              <p
                className={cn("truncate text-xs text-muted-foreground", job.state === "failed" && "text-amber-600 dark:text-amber-400")}
                title={job.error ?? undefined}
              >
                {job.state === "failed" ? `Couldn't remove: ${job.error ?? "failed"}` : "Removed"}
              </p>
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">
              {job.finishedAt === null ? "" : ago(new Date(job.finishedAt).toISOString())}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function CleanupPanel({ rpc, cleanup, keyboard }: { rpc: TriageRpc; cleanup: CleanupState; keyboard: boolean }) {
  const top = cleanup.cards[0] ?? null;
  const cost = useCost(rpc, top?.pluginId ?? null);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {top !== null ? (
        <div className="flex h-[min(520px,calc(100dvh-14rem))] min-h-[26rem] shrink-0 flex-col">
          <CardStack
            cards={cleanup.cards}
            actions={cleanupActions(top).labels}
            details={false}
            keyboard={keyboard}
            onDecide={(card, direction) => void decideCleanup(rpc, card, direction)}
            onUndo={() => void undoLastCleanup(rpc)}
            onDetails={() => {}}
            render={(card, isTop) => <CleanupCardView card={card} top={isTop} cost={isTop ? cost : undefined} />}
          />
        </div>
      ) : (
        <div className="mx-auto flex max-w-sm flex-col items-center gap-2 pt-10 text-center">
          <Icon name="CircleCheck" className="size-8 text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium">Nothing to clean up</p>
          <p className="text-xs text-muted-foreground">
            Broken and turned-off plugins show up here, and, once Plugin Triage has watched them for a month, ones you
            haven't used.
          </p>
        </div>
      )}
      <Recent history={cleanup.history} />
    </div>
  );
}
