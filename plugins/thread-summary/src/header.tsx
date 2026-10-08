// The thread header's Thread Summary control, and the card it opens.
//
// bb renders one of these per visible thread — a split layout has a header
// per pane — so everything about an open card is this component's own state,
// and each pane gets its own card. The two things a card remembers across
// threads, its mode and the pin, are the device's (./device-state).
//
// Beside the button sit up to three chips, the thread's worst values first,
// unless the setting is off or the viewport is compact; then the button
// carries a dot in the worst tone instead, and none when all is quiet.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  experimental_useSidebarThreads,
  experimental_usePluginId,
  experimental_Icon as Icon,
  useSettings,
  type PluginThreadHeaderActionProps,
} from "@get-bb/plugin-sdk/app";
import type { ComplicationProviderInfo } from "../lib/complications";
import { SHOW_CHIPS_KEY } from "../lib/hidden";
import { chips, orderedIds, present, worstTone } from "../lib/order";
import { toneColor } from "../lib/tone";
import { CardBody, Controls, type CardEntry } from "./card-body";
import { useThreadProviders, useThreadValues } from "./complications";
import { useDeviceState } from "./device-state";
import { SummaryDrawer } from "./drawer";
import { FloatingCard } from "./floating-card";
import { Glyph, useRunningStyle } from "./glyph";
import { navigateInApp, settingsPath } from "./navigate";
import { markOpen } from "./open-cards";
import { useHiddenProviders } from "./use-hidden-providers";

/** The thread's live values, in the card's order, hidden providers left out. */
export function useThreadEntries(threadId: string): CardEntry[] {
  const providers = useThreadProviders();
  const { hidden } = useHiddenProviders();
  const ordered = useMemo(() => {
    const byId = new Map(providers.map((provider) => [provider.id, provider]));
    return orderedIds(
      providers.map((provider) => provider.id),
      hidden,
    ).map((id) => byId.get(id) as ComplicationProviderInfo);
  }, [providers, hidden]);
  const values = useThreadValues(
    useMemo(() => ordered.map((provider) => provider.id), [ordered]),
    threadId,
  );
  return useMemo(() => present(ordered, values), [ordered, values]);
}

function chipLabel(entry: CardEntry): string {
  const text = entry.value.text !== undefined ? ` (${entry.value.text})` : "";
  return `${entry.provider.name}: ${entry.value.label}${text}`;
}

const CONTROL =
  "inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring";

export function SummaryAction({ threadId, isCompactViewport }: PluginThreadHeaderActionProps) {
  useRunningStyle();
  const pluginId = experimental_usePluginId();
  const settings = useSettings();
  const showChips = settings.values?.[SHOW_CHIPS_KEY] !== false && !isCompactViewport;
  const [device, updateDevice] = useDeviceState();
  const entries = useThreadEntries(threadId);
  const { threads } = experimental_useSidebarThreads();
  const environmentId = threads.find((entry) => entry.id === threadId)?.environment?.id ?? null;

  // Pin does not apply to the phone drawer. Pinned on a desktop, the card is
  // open the moment this header mounts — including the remount a thread
  // switch can bring — and stays open through the switch.
  const [open, setOpen] = useState(() => device.pinned && !isCompactViewport);
  const shownThread = useRef(threadId);
  useEffect(() => {
    if (shownThread.current === threadId) return;
    shownThread.current = threadId;
    setOpen(device.pinned && !isCompactViewport);
  }, [threadId, device.pinned, isCompactViewport]);

  // Git refreshes when a card opens and polls while it stays open.
  useEffect(() => (open ? markOpen(threadId) : undefined), [open, threadId]);

  // The whole group: a chip opens the card, so pressing one is not "outside".
  const [control, setControl] = useState<HTMLSpanElement | null>(null);
  const shown = useMemo(() => (showChips ? chips(entries) : []), [entries, showChips]);
  const dot = showChips ? null : worstTone(entries);
  const settingsHref = settingsPath(pluginId);
  const close = () => setOpen(false);

  const body = <CardBody entries={entries} environmentId={environmentId} mode={device.mode} />;

  return (
    <span className="flex items-center gap-0.5" data-thread-summary-header="" ref={setControl}>
      {shown.map((entry) => (
        <button
          aria-label={chipLabel(entry)}
          className={CONTROL}
          data-thread-summary-chip={entry.provider.id}
          key={entry.provider.id}
          onClick={() => setOpen(true)}
          title={chipLabel(entry)}
          type="button"
        >
          <Glyph value={entry.value} />
          {entry.value.text !== undefined ? (
            <span className="max-w-16 truncate tabular-nums">{entry.value.text}</span>
          ) : null}
        </button>
      ))}
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Thread summary"
        className={`${CONTROL} relative w-7 justify-center px-0`}
        data-thread-summary-button=""
        onClick={() => setOpen((current) => !current)}
        title="Thread summary"
        type="button"
      >
        <Icon aria-hidden name="ListView" style={{ height: 16, width: 16 }} />
        {dot !== null ? (
          <span
            aria-hidden
            className="absolute right-1 top-1 size-1.5 rounded-full"
            data-thread-summary-dot={dot}
            style={{ background: toneColor(dot) }}
          />
        ) : null}
      </button>
      {isCompactViewport ? (
        <SummaryDrawer
          controls={
            <Controls
              mode={device.mode}
              onMode={(mode) => updateDevice({ mode })}
              onSettings={(event) => navigateInApp(event, settingsHref)}
              settingsHref={settingsHref}
            />
          }
          mode={device.mode}
          onClose={close}
          onMode={(mode) => updateDevice({ mode })}
          open={open}
        >
          {body}
        </SummaryDrawer>
      ) : open ? (
        <FloatingCard
          control={control}
          controls={
            <Controls
              mode={device.mode}
              onClose={close}
              onMode={(mode) => updateDevice({ mode })}
              onPin={(pinned) => updateDevice({ pinned })}
              onSettings={(event) => navigateInApp(event, settingsHref)}
              pinned={device.pinned}
              settingsHref={settingsHref}
            />
          }
          onClose={close}
          pinned={device.pinned}
        >
          {body}
        </FloatingCard>
      ) : null}
    </span>
  );
}
