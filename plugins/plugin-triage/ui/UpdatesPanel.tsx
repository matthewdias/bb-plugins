// The Updates tab: a deck of pending updates, what bb couldn't check, and
// what the last batches did. The batch itself is the page's QueueBar.
import { useEffect, useState } from "react";
import { experimental_Icon as Icon, useBbNavigate } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Changes } from "../lib/changes";
import type { UpdateCard as Card } from "../lib/updates-deck";
import { CardStack, type DeckActions } from "./CardStack";
import { ago } from "./EntryCard";
import { haptic } from "./haptics";
import { navigateInApp, pluginDetailsPath } from "./navigate";
import type { TriageRpc, UpdatesState } from "./triage-store";
import { UpdateCard } from "./UpdateCard";
import { decideUpdate, undoLastUpdate } from "./update-decisions";

export const UPDATE_ACTIONS: DeckActions = {
  right: { label: "Update", name: "Queue the update", icon: "Download", hint: "queue" },
  left: { label: "Skip", name: "Skip this version", icon: "X", hint: "skip version" },
  up: { label: "Later", name: "Remind me in a week", icon: "Clock", hint: "later" },
};

/** How long a card sits on top before its changes are fetched: skimming is free. */
export const DWELL_MS = 700;

const changesCache = new Map<string, Promise<Changes>>();
const settledChanges = new Map<string, Changes>();

/** Answers that may be different next time are asked again, not kept. */
const keep = (changes: Changes) => changes.kind === "github" || changes.kind === "none";

/** What the top card's update changes, fetched once per card. */
function useChanges(rpc: TriageRpc, card: Card | null): { changes: Changes | undefined; load: () => void } {
  const [loaded, setLoaded] = useState<{ key: string; changes: Changes } | null>(null);
  const key = card === null ? null : `${card.pluginId}:${card.from.version}...${card.to.version}`;

  function ask(force: boolean): Promise<Changes> | null {
    if (card === null || key === null) return null;
    let request = force ? undefined : changesCache.get(key);
    if (request === undefined) {
      request = rpc
        .call("update_changes", {
          pluginId: card.pluginId,
          from: { version: card.from.version, display: card.from.display },
          to: { version: card.to.version, display: card.to.display },
          ...(force ? { force: true } : {}),
        })
        .catch((): Changes => ({ kind: "unavailable", reason: "Couldn't load the changes." }));
      changesCache.set(key, request);
      void request.then((changes) => {
        if (keep(changes)) settledChanges.set(key, changes);
        else changesCache.delete(key);
      });
    }
    return request;
  }

  useEffect(() => {
    if (key === null) return;
    const known = settledChanges.get(key);
    if (known !== undefined) {
      setLoaded({ key, changes: known });
      return;
    }
    let live = true;
    // Only once the card has stayed on top: a card flicked past costs nothing.
    const timer = setTimeout(() => {
      void ask(false)?.then((changes) => live && setLoaded({ key, changes }));
    }, DWELL_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // `ask` reads the same card and rpc this effect keys on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, rpc]);

  return {
    changes: loaded !== null && loaded.key === key ? loaded.changes : undefined,
    load: () => {
      setLoaded(null);
      void ask(true)?.then((changes) => key !== null && setLoaded({ key, changes }));
    },
  };
}

/** Tests only. */
export function resetChangesCache(): void {
  changesCache.clear();
  settledChanges.clear();
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function UpdatesPanel({ rpc, updates, keyboard }: { rpc: TriageRpc; updates: UpdatesState; keyboard: boolean }) {
  const navigate = useBbNavigate();
  const [checking, setChecking] = useState<string | "all" | null>(null);
  const [expanded, setExpanded] = useState(false);
  const top = updates.cards[0] ?? null;
  useEffect(() => setExpanded(false), [top?.key]);
  const { changes, load: loadChanges } = useChanges(rpc, top);

  async function check(pluginId?: string) {
    setChecking(pluginId ?? "all");
    try {
      await rpc.call("updates_check", pluginId === undefined ? {} : { pluginId });
    } catch (cause) {
      toast.error(`Couldn't check for updates: ${message(cause)}`);
    } finally {
      setChecking(null);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {updates.cards.length > 0 ? (
        // The lists below share this scroll area, so the deck keeps a height
        // of its own rather than being squeezed under its buttons.
        <div className="flex h-[min(520px,calc(100dvh-14rem))] min-h-[26rem] shrink-0 flex-col">
        <CardStack
          cards={updates.cards}
          actions={UPDATE_ACTIONS}
          keyboard={keyboard}
          scrollable={expanded}
          onDecide={(card, direction) => void decideUpdate(rpc, card, direction)}
          onUndo={() => void undoLastUpdate(rpc)}
          onDetails={() => setExpanded((value) => !value)}
          render={(card, isTop) => (
            <UpdateCard
              card={card}
              top={isTop}
              changes={isTop ? changes : undefined}
              onLoadChanges={loadChanges}
              onChanges={() => card.compareUrl !== null && navigate.openUrl(card.compareUrl)}
              expanded={isTop && expanded}
              onToggleDetails={() => setExpanded((value) => !value)}
              onOpen={() => navigateInApp(pluginDetailsPath(card.pluginId, "updates"))}
            />
          )}
        />
        </div>
      ) : (
        <div className="mx-auto flex max-w-sm flex-col items-center gap-2 pt-10 text-center">
          <Icon name="CircleCheck" className="size-8 text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium">Nothing to update</p>
          <p className="text-xs text-muted-foreground">bb checks for updates on its own. Check now to look again.</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => void check()} disabled={checking !== null}>
            {checking === "all" ? "Checking… (this takes a while)" : "Check now"}
          </Button>
        </div>
      )}

      {updates.unavailable.length > 0 && (
        <Section title="Couldn't check">
          {updates.unavailable.map((item) => (
            <Row key={item.pluginId} title={item.displayName} detail={item.detail ?? "bb couldn't read this plugin's source."} tone="warn">
              <Button variant="ghost" size="sm" onClick={() => void check(item.pluginId)} disabled={checking !== null}>
                {checking === item.pluginId ? "Checking…" : "Retry"}
              </Button>
            </Row>
          ))}
        </Section>
      )}

      {updates.history.length > 0 && (
        <Section title="Recent">
          {updates.history.map((job) => (
            <Row
              key={job.id}
              title={job.displayName}
              detail={
                job.state === "failed"
                  ? (job.error ?? "Failed")
                  : job.result === "current"
                    ? "Was already up to date"
                    : `Updated to ${job.to.display.slice(job.to.display.lastIndexOf("@") + 1)}`
              }
              tone={job.state === "failed" ? "warn" : undefined}
            >
              <span className="shrink-0 text-xs text-muted-foreground">
                {job.finishedAt === null ? "" : ago(new Date(job.finishedAt).toISOString())}
              </span>
            </Row>
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mx-auto w-full max-w-md space-y-1">
      <h3 className="px-1 text-xs font-medium text-muted-foreground">{title}</h3>
      <ul className="divide-y divide-border rounded-xl border border-border">{children}</ul>
    </section>
  );
}

function Row({ title, detail, tone, children }: { title: string; detail: string; tone?: "warn"; children?: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{title}</p>
        <p className={cn("truncate text-xs text-muted-foreground", tone === "warn" && "text-amber-600 dark:text-amber-400")} title={detail}>
          {detail}
        </p>
      </div>
      {children}
    </li>
  );
}
