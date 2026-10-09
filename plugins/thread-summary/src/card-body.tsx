// What the card draws, in either of its homes: the floating card on a desktop
// and the drawer on a phone.
//
// One block per provider, with no provider titles: the first line is the
// value's glyph, its headline and its text, and the provider's name is that
// line's tooltip and accessible name. A provider that supplies detail rows
// gets them under its line; Git and the pull request supply none.
// Nothing here trusts the value's `detail` or `open`: ../lib/validate checks
// them first, and a link that fails is drawn as plain text.
import {
  UrlLink,
  experimental_FileLink as FileLink,
  experimental_Icon as Icon,
} from "@get-bb/plugin-sdk/app";
import type { ComplicationProviderInfo } from "../lib/complications";
import type { Entry } from "../lib/order";
import { glyphFill, pillColors, toneColor } from "../lib/tone";
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

/** A line's inner gap and padding, and the glyph square: rows indent by their sum. */
const LINE_PADDING = 7;
const LINE_GAP = 9;
const BADGE = 24;
/** Detail rows line up with the headline. */
export const ROW_INDENT = LINE_PADDING + BADGE + LINE_GAP;

function Block({ entry, environmentId }: { entry: CardEntry; environmentId: string | null }) {
  const { provider, value } = entry;
  const detail = readDetail(value);
  const open = readOpen(value);
  const headline = detail?.title ?? value.label;
  const rows = detail?.rows ?? [];
  const more = rows.length - MAX_ROWS;
  const pill = pillColors(value.tone);
  return (
    <div className="flex flex-col" data-thread-summary-block={provider.id}>
      <div
        aria-label={provider.name}
        className="flex min-w-0 items-center"
        data-thread-summary-line=""
        role="group"
        style={{ gap: LINE_GAP, padding: `6px ${LINE_PADDING}px`, borderRadius: 10 }}
        title={provider.name}
      >
        <span
          className="inline-grid flex-none place-items-center"
          data-thread-summary-badge=""
          style={{ width: BADGE, height: BADGE, borderRadius: 8, background: glyphFill(value.tone) }}
        >
          <Glyph value={value} />
        </span>
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
          <span
            className="shrink-0 whitespace-nowrap tabular-nums"
            data-thread-summary-pill=""
            style={{
              ...pill,
              fontSize: 11,
              fontWeight: 600,
              lineHeight: "18px",
              padding: "0 8px",
              borderRadius: 999,
            }}
          >
            {value.text}
          </span>
        ) : null}
      </div>
      {rows.length > 0 ? (
        <ul
          className="flex flex-col gap-1 text-muted-foreground"
          style={{ padding: `2px ${LINE_PADDING}px 6px ${ROW_INDENT}px` }}
        >
          {rows.slice(0, MAX_ROWS).map((row, index) => (
            <Row environmentId={environmentId} key={`${index}:${row.label}`} row={row} />
          ))}
          {more > 0 ? <li className="text-muted-foreground/80">{more} more</li> : null}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * The lines, separated by space rather than rules: a heads-up display, not a
 * table. The same in the desktop card and the phone drawer.
 */
export function CardBody({
  entries,
  environmentId,
}: {
  entries: readonly CardEntry[];
  /** For file rows; `null` while the thread has no environment, which draws them as text. */
  environmentId: string | null;
}) {
  if (entries.length === 0) {
    return <p className="px-3 py-2 text-muted-foreground">Nothing to report for this thread.</p>;
  }
  return (
    <div className="flex flex-col" data-thread-summary-lines="" style={{ gap: 2 }}>
      {entries.map((entry) => (
        <Block entry={entry} environmentId={environmentId} key={entry.provider.id} />
      ))}
    </div>
  );
}
