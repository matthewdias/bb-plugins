// What the card draws, in either of its homes: the floating card on a desktop
// and the drawer on a phone.
//
// One block per provider, with no provider titles: the first line is the
// value's glyph, its headline and its text, and the provider's name is that
// line's tooltip and accessible name. Expanded, a block adds its detail rows.
// Nothing here trusts the value's `detail` or `open`: ../lib/validate checks
// them first, and a link that fails is drawn as plain text.
import {
  UrlLink,
  experimental_FileLink as FileLink,
  experimental_Icon as Icon,
} from "@get-bb/plugin-sdk/app";
import type { ComplicationProviderInfo } from "../lib/complications";
import type { Mode } from "../lib/card-state";
import type { Entry } from "../lib/order";
import { toneColor } from "../lib/tone";
import { readDetail, readOpen, type DetailRow } from "../lib/validate";
import { Glyph } from "./glyph";

/** Rows a block shows before it says how many more there are. */
export const MAX_ROWS = 8;

export type CardEntry = Entry<ComplicationProviderInfo>;

function RowLabel({ row, environmentId }: { row: DetailRow; environmentId: string | null }) {
  if (row.href !== undefined) {
    return (
      <UrlLink className="truncate underline-offset-2 hover:underline" href={row.href}>
        {row.label}
      </UrlLink>
    );
  }
  if (row.file !== undefined && environmentId !== null) {
    return (
      <FileLink
        className="truncate underline-offset-2 hover:underline"
        target={{ kind: "workspace", environmentId, path: row.file }}
      >
        {row.label}
      </FileLink>
    );
  }
  return <span className="truncate">{row.label}</span>;
}

function Row({ row, environmentId }: { row: DetailRow; environmentId: string | null }) {
  return (
    <li className="flex min-w-0 items-center gap-2" data-thread-summary-row="">
      {row.icon !== undefined ? (
        <Icon
          aria-hidden
          fallback="Circle"
          name={row.icon}
          style={{ color: toneColor(row.tone), flex: "none", height: 12, width: 12 }}
        />
      ) : null}
      <span className="flex min-w-0 flex-1">
        <RowLabel environmentId={environmentId} row={row} />
      </span>
      {row.value !== undefined ? (
        <span
          className="shrink-0 tabular-nums"
          style={row.tone !== undefined ? { color: toneColor(row.tone) } : undefined}
        >
          {row.value}
        </span>
      ) : null}
    </li>
  );
}

function Block({
  entry,
  expanded,
  environmentId,
}: {
  entry: CardEntry;
  expanded: boolean;
  environmentId: string | null;
}) {
  const { provider, value } = entry;
  const detail = readDetail(value);
  const open = readOpen(value);
  const headline = detail?.title ?? value.label;
  const rows = detail?.rows ?? [];
  const more = rows.length - MAX_ROWS;
  return (
    <div className="px-3 py-2" data-thread-summary-block={provider.id}>
      <div aria-label={provider.name} className="flex min-w-0 items-center gap-2" role="group" title={provider.name}>
        <Glyph value={value} />
        <span className="flex min-w-0 flex-1 font-medium">
          {open !== null ? (
            <UrlLink className="truncate underline-offset-2 hover:underline" href={open.href}>
              {headline}
            </UrlLink>
          ) : (
            <span className="truncate">{headline}</span>
          )}
        </span>
        {value.text !== undefined ? (
          <span className="shrink-0 tabular-nums text-muted-foreground">{value.text}</span>
        ) : null}
      </div>
      {expanded && rows.length > 0 ? (
        <ul className="mt-1.5 flex flex-col gap-1 pl-[22px] text-muted-foreground">
          {rows.slice(0, MAX_ROWS).map((row, index) => (
            <Row environmentId={environmentId} key={`${index}:${row.label}`} row={row} />
          ))}
          {more > 0 ? <li className="text-muted-foreground/80">{more} more</li> : null}
        </ul>
      ) : null}
    </div>
  );
}

export function CardBody({
  entries,
  mode,
  environmentId,
}: {
  entries: readonly CardEntry[];
  mode: Mode;
  /** For file rows; `null` while the thread has no environment, which draws them as text. */
  environmentId: string | null;
}) {
  if (entries.length === 0) {
    return <p className="px-3 py-2 text-muted-foreground">Nothing to report for this thread.</p>;
  }
  return (
    <div className="flex flex-col divide-y divide-border">
      {entries.map((entry) => (
        <Block
          entry={entry}
          environmentId={environmentId}
          expanded={mode === "expanded"}
          key={entry.provider.id}
        />
      ))}
    </div>
  );
}

const BUTTON =
  "inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring";

/**
 * The card's controls: mode, pin, settings and close. Pin and close are left
 * out where they do not apply — the phone drawer has neither.
 */
export function Controls({
  mode,
  onMode,
  pinned,
  onPin,
  settingsHref,
  onSettings,
  onClose,
}: {
  mode: Mode;
  onMode: (mode: Mode) => void;
  pinned?: boolean;
  onPin?: (pinned: boolean) => void;
  settingsHref: string;
  onSettings: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  onClose?: () => void;
}) {
  const expanded = mode === "expanded";
  return (
    <>
      <button
        aria-label={expanded ? "Show headlines only" : "Show details"}
        aria-pressed={expanded}
        className={BUTTON}
        onClick={() => onMode(expanded ? "compact" : "expanded")}
        title={expanded ? "Show headlines only" : "Show details"}
        type="button"
      >
        <Icon aria-hidden name={expanded ? "ChevronUp" : "ChevronDown"} style={{ height: 14, width: 14 }} />
      </button>
      {onPin !== undefined ? (
        <button
          aria-label={pinned ? "Unpin" : "Pin open on every thread"}
          aria-pressed={pinned === true}
          className={BUTTON}
          onClick={() => onPin(!pinned)}
          title={pinned ? "Unpin" : "Pin open on every thread"}
          type="button"
        >
          <Icon aria-hidden name={pinned ? "PinOff" : "Pin"} style={{ height: 14, width: 14 }} />
        </button>
      ) : null}
      <a aria-label="Thread Summary settings" className={BUTTON} href={settingsHref} onClick={onSettings} title="Settings">
        <Icon aria-hidden name="SlidersHorizontal" style={{ height: 14, width: 14 }} />
      </a>
      {onClose !== undefined ? (
        <button aria-label="Close" className={BUTTON} onClick={onClose} title="Close" type="button">
          <Icon aria-hidden name="X" style={{ height: 14, width: 14 }} />
        </button>
      ) : null}
    </>
  );
}
