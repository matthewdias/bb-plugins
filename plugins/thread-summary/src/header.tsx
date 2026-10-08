// The thread header's Thread Summary control, and the card it opens.
//
// bb renders one of these per visible thread — a split layout has a header
// per pane — so each pane gets its own card. The button shows and hides it,
// and on a desktop that choice is the device's (./device-state): it holds
// across thread switches and reloads, in every pane.
//
// Beside the button sit up to three chips, the thread's worst values first,
// unless the setting is off or the viewport is compact; then the button
// carries a dot in the worst tone instead, and none when all is quiet.
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  experimental_useSidebarThreads,
  useSettings,
  type PluginThreadHeaderActionProps,
} from "@get-bb/plugin-sdk/app";
import { PropertyNewIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ComplicationProviderInfo } from "../lib/complications";
import { SHOW_CHIPS_KEY } from "../lib/hidden";
import { chips, orderedIds, present, worstTone } from "../lib/order";
import { toneColor } from "../lib/tone";
import { CardBody, type CardEntry } from "./card-body";
import { useThreadProviders, useThreadValues } from "./complications";
import { useDeviceState } from "./device-state";
import { SummaryDrawer } from "./drawer";
import { FloatingCard } from "./floating-card";
import { Glyph, useRunningStyle } from "./glyph";
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
  "inline-flex h-7 items-center rounded-md text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring";
/** A chip: glyph and text, padded. */
const CHIP = `${CONTROL} gap-1 px-1.5`;
/**
 * The button: 28px square with no padding, so its glyph has the room to grow
 * to 20px on a phone as bb's own header icons do. Padding here would shrink
 * the glyph, a flex item, back to 16px.
 */
const BUTTON = `${CONTROL} relative size-7 justify-center p-0`;

export function SummaryAction({ threadId, isCompactViewport }: PluginThreadHeaderActionProps) {
  useRunningStyle();
  const settings = useSettings();
  const showChips = settings.values?.[SHOW_CHIPS_KEY] !== false && !isCompactViewport;
  const [device, updateDevice] = useDeviceState();
  const entries = useThreadEntries(threadId);
  const { threads } = experimental_useSidebarThreads();
  const environmentId = threads.find((entry) => entry.id === threadId)?.environment?.id ?? null;

  // On a desktop the card shows or hides for this whole device: the button's
  // choice outlives the thread and the page, so a header that mounts — a
  // thread switch can remount it — shows the card at once if it was showing.
  // On a phone the drawer opens only when asked, and closes on a switch.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const shownThread = useRef(threadId);
  useEffect(() => {
    if (shownThread.current === threadId) return;
    shownThread.current = threadId;
    setDrawerOpen(false);
  }, [threadId]);
  const open = isCompactViewport ? drawerOpen : device.shown;
  const setShown = (shown: boolean) => (isCompactViewport ? setDrawerOpen(shown) : updateDevice({ shown }));

  // Git refreshes when a card opens and polls while it stays open.
  useEffect(() => (open ? markOpen(threadId) : undefined), [open, threadId]);

  const [control, setControl] = useState<HTMLSpanElement | null>(null);
  const [button, setButton] = useState<HTMLButtonElement | null>(null);
  // Whether the open in progress came from a key: Enter and Space make a
  // click with no click count, a mouse one has one.
  const [focusOnOpen, setFocusOnOpen] = useState(false);
  const show = (event: MouseEvent) => {
    setFocusOnOpen(event.detail === 0);
    setShown(true);
  };
  const hide = () => setShown(false);
  const shownChips = useMemo(() => (showChips ? chips(entries) : []), [entries, showChips]);
  const dot = showChips ? null : worstTone(entries);
  const body = <CardBody entries={entries} environmentId={environmentId} />;

  return (
    <span className="flex items-center gap-0.5" data-thread-summary-header="" ref={setControl}>
      {shownChips.map((entry) => (
        <button
          aria-label={chipLabel(entry)}
          className={CHIP}
          data-thread-summary-chip={entry.provider.id}
          key={entry.provider.id}
          onClick={show}
          title={chipLabel(entry)}
          type="button"
        >
          <Glyph value={entry.value} />
          {entry.value.text !== undefined ? (
            <span className="max-w-28 truncate tabular-nums">{entry.value.text}</span>
          ) : null}
        </button>
      ))}
      <button
        aria-expanded={open}
        aria-label="Thread summary"
        className={BUTTON}
        data-thread-summary-button=""
        onClick={(event) => (open ? hide() : show(event))}
        ref={setButton}
        title="Thread summary"
        type="button"
      >
        {/*
          Bundled rather than named: bb 0.45 has no built-in "PropertyNew", and
          experimental_Icon would draw its fallback in its place. Sized by bb's
          own header-icon classes, 16px and 20px on a phone, with the stroke in
          viewBox units so it scales with them, as bb's own icons' strokes do.
        */}
        <HugeiconsIcon
          aria-hidden
          className="size-4 shrink-0 max-md:pointer-coarse:size-5"
          data-icon="PropertyNew"
          icon={PropertyNewIcon}
          strokeWidth={1.5}
        />
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
        <SummaryDrawer onClose={hide} open={open} returnFocusTo={button}>
          {body}
        </SummaryDrawer>
      ) : open ? (
        <FloatingCard control={control} focusOnOpen={focusOnOpen} onClose={hide} returnFocusTo={button}>
          {body}
        </FloatingCard>
      ) : null}
    </span>
  );
}
