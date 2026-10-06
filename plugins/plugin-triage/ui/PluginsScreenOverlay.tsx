// Draws the Triage page inside bb's own Plugins screen. bb has no slot for a
// page there, so this app overlay (mounted once per window, inside bb's React
// tree) portals the page into the screen's main panel, and screen/engine.ts
// does the DOM work around it: the sidebar row and its count, and hiding
// bb's page while this one is shown.
//
// Being mounted everywhere also makes it the place that hears about finished
// installs, so their toasts appear wherever you are.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { CHANGED_CHANNEL } from "../lib/channel";
import type { rpcContract } from "../lib/contract";
import type { Job } from "../lib/queue";
import { startScreenEngine, type ScreenEngine } from "../screen/engine";
import { haptic } from "./haptics";
import { navigateInApp } from "./navigate";
import { TriagePage } from "./TriagePage";
import { triageStore } from "./triage-store";

declare const __BB_PLUGIN_ID__: string | undefined;

/** Toasts each install this window saw start, once it finishes. */
function useInstallToasts() {
  const rpc = useRpc<typeof rpcContract>();
  const seen = useRef<Map<string, Job["state"]> | null>(null);

  const refresh = useRef(async () => {});
  refresh.current = async () => {
    let jobs: Job[];
    try {
      ({ jobs } = await rpc.call("jobs_list", {}));
    } catch {
      return;
    }
    const before = seen.current;
    seen.current = new Map(jobs.map((job) => [job.id, job.state]));
    // The first read is the baseline: jobs that finished before this window
    // opened are not news.
    if (before === null) return;
    for (const job of jobs) {
      const was = before.get(job.id);
      if (was === job.state || (was !== "pending" && was !== "running" && was !== undefined)) continue;
      if (job.kind === "update") {
        if (job.state === "done") {
          haptic("success");
          toast.success(job.result === "current" ? `${job.displayName} was already up to date` : `Updated ${job.displayName}`, {
            id: `triage-update-${job.pluginId}`,
          });
        } else if (job.state === "failed") {
          haptic("error");
          toast.error(`Couldn't update ${job.displayName}`, {
            id: `triage-update-${job.pluginId}`,
            description: job.error ?? undefined,
          });
        }
        continue;
      }
      if (job.state === "done") {
        haptic("success");
        toast.success(`Installed ${job.displayName}`, {
          id: `triage-install-${job.key}`,
          description: undefined,
          action:
            job.pluginId === null
              ? undefined
              : { label: "Settings", onClick: () => navigateInApp(`/settings/plugins/${encodeURIComponent(job.pluginId!)}`) },
        });
      } else if (job.state === "failed") {
        haptic("error");
        toast.error(`Couldn't install ${job.displayName}`, {
          id: `triage-install-${job.key}`,
          description: job.error ?? undefined,
          action: undefined,
        });
      }
    }
  };

  useEffect(() => {
    void refresh.current();
  }, []);
  return () => void refresh.current();
}

export function PluginsScreenOverlay() {
  const rpc = useRpc<typeof rpcContract>();
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const engine = useRef<ScreenEngine | null>(null);
  const deck = useSyncExternalStore(triageStore.subscribe, triageStore.getSnapshot);
  const onJobs = useInstallToasts();

  useEffect(() => {
    const controller = new AbortController();
    engine.current = startScreenEngine({
      signal: controller.signal,
      doc: document,
      location: () => window.location,
      defer: (run) => {
        const frame = window.requestAnimationFrame(run);
        return () => window.cancelAnimationFrame(frame);
      },
      navigate: navigateInApp,
      onPanel: setContainer,
    });
    void triageStore.load(rpc);
    return () => {
      controller.abort();
      engine.current = null;
    };
  }, [rpc]);

  useRealtime(CHANGED_CHANNEL, (payload) => {
    void triageStore.load(rpc);
    if ((payload as { reason?: string } | null)?.reason === "job") onJobs();
  });

  useEffect(() => {
    // Queued items count too: a queue nobody ran shows on the tab.
    engine.current?.setCount(
      deck.status === "ready" ? deck.cards.length + deck.updates.cards.length + deck.queue.jobs.length : null,
    );
  }, [deck.cards.length, deck.updates.cards.length, deck.queue.jobs.length, deck.status]);

  // bb scopes a plugin's stylesheet to elements under [data-bb-plugin], and a
  // portal leaves that subtree, so the page has to name the plugin itself.
  return container === null
    ? null
    : createPortal(
        <div
          className="h-full"
          data-bb-plugin={typeof __BB_PLUGIN_ID__ === "string" ? __BB_PLUGIN_ID__ : undefined}
        >
          <TriagePage />
        </div>,
        container,
      );
}
