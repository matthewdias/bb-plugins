// The installed inventory, with a filter for disabled plugins.
import { useEffect, useState } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CleanupCard as Card, CleanupReason } from "../lib/cleanup-deck";
import type { Direction } from "../lib/gesture";
import type { RemoveJob } from "../lib/queue";
import { describeCost, type RemovalCost } from "../lib/removal-cost";
import { CardGrid, GridCard } from "./CardGrid";
import { canManage, cleanupActions, decideCleanup, undoLastCleanup } from "./cleanup-decisions";
import { PluginIcon, ago } from "./EntryCard";
import { navigateInApp, pluginDetailsPath } from "./navigate";
import type { CleanupState, TriageRpc } from "./triage-store";

const date = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/** Why the card is in the deck, in a sentence. */
export function reasonText(reason: CleanupReason): { title: string; detail: string | null; tone?: "warn" } {
  switch (reason.kind) {
    case "enabled":
      return { title: "Enabled", detail: null };
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

/** What uninstalling each of these plugins would delete, asked once per plugin. */
function useCosts(rpc: TriageRpc, pluginIds: readonly string[]): ReadonlyMap<string, RemovalCost | null> {
  const [loaded, setLoaded] = useState<ReadonlyMap<string, RemovalCost | null>>(new Map());
  const key = pluginIds.join("\n");
  useEffect(() => {
    let live = true;
    for (const pluginId of pluginIds) {
      let request = costs.get(pluginId);
      if (request === undefined) {
        request = rpc.call("cleanup_cost", { pluginId }).catch(() => null);
        costs.set(pluginId, request);
      }
      void request.then((cost) => {
        if (live) setLoaded((before) => before.has(pluginId) ? before : new Map(before).set(pluginId, cost));
      });
    }
    return () => {
      live = false;
    };
    // `key` is `pluginIds`, as a value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, rpc]);
  return loaded;
}

/** The sentence a card shows before it is queued to uninstall; undefined while asking. */
export function costText(cost: RemovalCost | null | undefined): string {
  return cost === undefined
    ? "Checking what uninstalling would delete…"
    : cost === null
      ? "Uninstalling deletes its settings, secrets and schedules, for good."
      : describeCost(cost);
}

/** Tests only. */
export function resetCosts(): void {
  costs.clear();
}

function CleanupCardView({
  card,
  cost,
  onDetails,
  onTrial,
}: {
  card: Card;
  cost?: RemovalCost | null;
  /** Before it leaves for bb's detail pane: a preview closes. */
  onDetails?: () => void;
  onTrial?: () => void;
}) {
  const reason = installedStatus(card);
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
      <div className="min-h-0 flex-1 touch-pan-y space-y-3 overflow-y-auto overscroll-contain px-4 py-2" data-scroll="">
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
        {canManage(card) && (
          <p className="text-xs text-muted-foreground" data-testid="removal-cost">
            {costText(cost)}
          </p>
        )}
      </div>
      <footer className="flex flex-wrap items-center gap-1 border-t border-border p-2">
        {onTrial !== undefined && (
          <div className="min-w-0">
            <Button
              variant="outline"
              size="sm"
              onClick={onTrial}
              aria-description="Turns this plugin off now and asks again in two weeks."
            >
              <Icon name="PowerOff" fallback="Power" aria-hidden /> Try without it
            </Button>
            <p className="mt-1 text-xs text-muted-foreground">Turn off now and review in two weeks.</p>
          </div>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={() => {
            onDetails?.();
            navigateInApp(pluginDetailsPath(card.pluginId, "installed"));
          }}
        >
          <Icon name="Info" aria-hidden /> Details
        </Button>
      </footer>
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

function installedStatus(card: Card): ReturnType<typeof reasonText> {
  return card.removalPending
    ? { title: "Queued to uninstall", detail: null }
    : reasonText(card.reason);
}

export function InstalledPanel({
  rpc,
  installed,
  keyboard,
}: {
  rpc: TriageRpc;
  installed: CleanupState;
  keyboard: boolean;
}) {
  const [disabledOnly, setDisabledOnly] = useState(false);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState<ReadonlySet<string>>(new Set());
  const cards = disabledOnly ? installed.cards.filter((card) => !card.enabled) : installed.cards;
  const gridCosts = useCosts(rpc, cards
    .filter((card) => canManage(card) && (reviewed.has(card.key) || card.key === previewKey))
    .map((card) => card.pluginId));

  function review(card: Card) {
    if (!canManage(card)) return;
    setReviewed((before) => before.has(card.key) ? before : new Set(before).add(card.key));
  }

  function decide(card: Card, direction: Direction) {
    const action = cleanupActions(card)[direction];
    if (action !== undefined) void decideCleanup(rpc, card, action.action);
  }

  function filter(disabled: boolean) {
    setDisabledOnly(disabled);
    setPreviewKey(null);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="mx-auto flex w-full max-w-[80rem] gap-1" role="group" aria-label="Filter installed plugins">
        {([false, true] as const).map((disabled) => (
          <Button
            key={String(disabled)}
            variant="ghost"
            className={cn(disabledOnly === disabled && "bg-state-active text-foreground")}
            size="sm"
            aria-pressed={disabledOnly === disabled}
            onClick={() => filter(disabled)}
          >
            {disabled ? "Disabled" : "All"}
          </Button>
        ))}
      </div>
      <CardGrid
        cards={cards}
        facts={(card) => ({
          name: card.displayName,
          published: null,
          installs: null,
          category: card.listing?.category ?? null,
          source: card.listing?.store ?? null,
        })}
        sorts={["name"]}
        noun={disabledOnly ? ["disabled plugin", "disabled plugins"] : ["installed plugin", "installed plugins"]}
        onUndo={() => void undoLastCleanup(rpc)}
        keyboard={keyboard}
        actions={cleanupActions}
        onDecide={decide}
        previewKey={previewKey}
        onPreview={setPreviewKey}
        renderPreview={(card, close) => (
          <CleanupCardView
            key={card.key}
            card={card}
            cost={gridCosts.get(card.pluginId)}
            onDetails={close}
            onTrial={card.enabled && canManage(card) ? () => void decideCleanup(rpc, card, "trial") : undefined}
          />
        )}
        render={(card) => {
          const status = installedStatus(card);
          const removal = canManage(card) && reviewed.has(card.key) ? costText(gridCosts.get(card.pluginId)) : undefined;
          return (
            <GridCard
              title={card.displayName}
              leading={<PluginIcon card={card} compact />}
              description={card.description ?? ""}
              note={{ text: status.detail === null ? status.title : `${status.title} · ${status.detail}`, tone: status.tone }}
              footnote={removal}
              hints={canManage(card) ? { left: removal ?? costText(null) } : undefined}
              byline={card.surfaces.length > 0 ? card.surfaces.join(", ") : <span className="font-mono">{card.source}</span>}
              actions={cleanupActions(card)}
              onDecide={(direction) => decide(card, direction)}
              openLabel={`Preview ${card.displayName}`}
              onOpen={() => setPreviewKey(card.key)}
              onReview={() => review(card)}
            />
          );
        }}
      />
      {cards.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {disabledOnly ? "No disabled plugins" : "No installed plugins"}
        </p>
      )}
      <Recent history={installed.history} />
    </div>
  );
}
