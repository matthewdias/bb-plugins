// The Updates tab: a deck of pending updates, the batch they are queued into,
// what bb couldn't check, and what the last batches did.
import { useState } from "react";
import { experimental_Icon as Icon, useBbNavigate } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { UpdateJob } from "../lib/queue";
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

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function UpdatesPanel({ rpc, updates, keyboard }: { rpc: TriageRpc; updates: UpdatesState; keyboard: boolean }) {
  const navigate = useBbNavigate();
  const [starting, setStarting] = useState(false);
  const [checking, setChecking] = useState<string | "all" | null>(null);

  async function start() {
    setStarting(true);
    try {
      const { started } = await rpc.call("updates_start", {});
      if (started > 0) haptic("impact-medium");
    } catch (cause) {
      toast.error(`Couldn't start the updates: ${message(cause)}`);
    } finally {
      setStarting(false);
    }
  }

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
      {updates.queued.length > 0 && (
        <BatchBar queued={updates.queued} running={updates.running} starting={starting} onStart={() => void start()} />
      )}

      {updates.cards.length > 0 ? (
        // The lists below share this scroll area, so the deck keeps a height
        // of its own rather than being squeezed under its buttons.
        <div className="flex h-[min(520px,calc(100dvh-14rem))] min-h-[26rem] shrink-0 flex-col">
        <CardStack
          cards={updates.cards}
          actions={UPDATE_ACTIONS}
          details={false}
          keyboard={keyboard}
          onDecide={(card, direction) => void decideUpdate(rpc, card, direction)}
          onUndo={() => void undoLastUpdate(rpc)}
          onDetails={() => {}}
          render={(card, top) => (
            <UpdateCard
              card={card}
              top={top}
              onChanges={() => card.compareUrl !== null && navigate.openUrl(card.compareUrl)}
              onDetails={() => navigateInApp(pluginDetailsPath(card.pluginId))}
            />
          )}
        />
        </div>
      ) : (
        <div className="mx-auto flex max-w-sm flex-col items-center gap-2 pt-10 text-center">
          <Icon name="CircleCheck" className="size-8 text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium">
            {updates.queued.length > 0 ? "Nothing else to decide" : "Everything's up to date"}
          </p>
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

function BatchBar({
  queued,
  running,
  starting,
  onStart,
}: {
  queued: UpdateJob[];
  running: boolean;
  starting: boolean;
  onStart: () => void;
}) {
  const current = queued.find((job) => job.state === "running");
  return (
    <div className="mx-auto flex w-full max-w-md shrink-0 items-center gap-3 rounded-xl border border-border bg-card px-3 py-2" role="status">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {running
            ? current
              ? `Updating ${current.displayName}…`
              : "Starting…"
            : `${queued.length} update${queued.length === 1 ? "" : "s"} queued`}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {running
            ? `${queued.length} to go · keeps going if you close bb`
            : queued.map((job) => job.displayName).join(", ")}
        </p>
      </div>
      {!running && (
        <Button size="sm" onClick={onStart} disabled={starting}>
          Update all
        </Button>
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
