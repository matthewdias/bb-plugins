// The Cleanup tab: installed plugins worth a second look, and the Graveyard
// of ones removed from here, each with a way back.
import { useState } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CleanupCard as Card, CleanupReason } from "../lib/cleanup-deck";
import type { GraveyardEntry } from "../lib/graveyard";
import { CardStack } from "./CardStack";
import { cleanupActions, decideCleanup, undoLastCleanup } from "./cleanup-decisions";
import { PluginIcon, ago } from "./EntryCard";
import { haptic } from "./haptics";
import { navigateInApp, pluginDetailsPath } from "./navigate";
import { triageStore, type CleanupState, type TriageRpc } from "./triage-store";

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

function CleanupCardView({ card, top }: { card: Card; top: boolean }) {
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
        <p className="text-xs text-muted-foreground">
          Uninstalling deletes its settings; Plugin Triage keeps a copy, so it can be restored from the Graveyard.
        </p>
      </div>
      {top && (
        <footer className="border-t border-border p-2">
          <Button variant="ghost" size="sm" className="w-full" onClick={() => navigateInApp(pluginDetailsPath(card.pluginId))}>
            <Icon name="Info" aria-hidden /> Details
          </Button>
        </footer>
      )}
    </article>
  );
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function Graveyard({ rpc, entries }: { rpc: TriageRpc; entries: GraveyardEntry[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  if (entries.length === 0) return null;

  async function restore(entry: GraveyardEntry) {
    setBusy(entry.id);
    try {
      const { secrets } = await rpc.call("graveyard_restore", { id: entry.id });
      haptic("success");
      toast.success(`Restored ${entry.displayName}`, {
        description: secrets.length > 0 ? `Set again by hand: ${secrets.join(", ")}.` : undefined,
      });
      void triageStore.load(rpc);
    } catch (cause) {
      haptic("error");
      toast.error(`Couldn't restore ${entry.displayName}: ${message(cause)}`);
    } finally {
      setBusy(null);
    }
  }

  async function forget(entry: GraveyardEntry) {
    try {
      await rpc.call("graveyard_forget", { id: entry.id });
      void triageStore.load(rpc);
    } catch (cause) {
      toast.error(`Couldn't forget it: ${message(cause)}`);
    }
  }

  return (
    <section className="mx-auto w-full max-w-md space-y-1">
      <h3 className="px-1 text-xs font-medium text-muted-foreground">Graveyard</h3>
      <ul className="divide-y divide-border rounded-xl border border-border">
        {entries.map((entry) => {
          const kept = Object.keys(entry.settings).length;
          const notes = [
            `Removed ${ago(new Date(entry.removedAt).toISOString()) ?? ""}`.trim(),
            kept > 0 ? `${kept} setting${kept === 1 ? "" : "s"} kept` : null,
            entry.secrets.length > 0 ? `${entry.secrets.length} secret${entry.secrets.length === 1 ? "" : "s"} won't come back` : null,
          ].filter(Boolean);
          return (
            <li key={entry.id} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{entry.displayName}</p>
                <p className="truncate text-xs text-muted-foreground">{notes.join(" · ")}</p>
              </div>
              <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => void restore(entry)} disabled={busy !== null}>
                {busy === entry.id ? "Restoring…" : "Restore"}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => void forget(entry)}
                disabled={busy !== null}
                aria-label={`Forget ${entry.displayName}`}
              >
                <Icon name="X" aria-hidden />
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function CleanupPanel({ rpc, cleanup, keyboard }: { rpc: TriageRpc; cleanup: CleanupState; keyboard: boolean }) {
  const top = cleanup.cards[0] ?? null;
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
            render={(card, isTop) => <CleanupCardView card={card} top={isTop} />}
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
      <Graveyard rpc={rpc} entries={cleanup.graveyard} />
    </div>
  );
}
