// Tab Nav's own glyphs, drawn inline so they never depend on which icon
// names a given bb build resolves. Destination icons come from bb itself:
// bb's navigation icon component (see components/destinations).
import type { ScreenPane } from "../lib/tabs-model.ts";

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export function ThreadsGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" {...STROKE}>
      <path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z" />
      <path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1" />
    </svg>
  );
}

export function CloseGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" {...STROKE}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

/** A pen on a page: New thread, in the Threads tab. */
export function ComposeGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" {...STROKE}>
      <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z" />
    </svg>
  );
}

/**
 * The rail's width toggle: a sidebar with its rail, and an arrow pointing to
 * where the names go — out when the rail is narrow, back in when it is wide.
 */
export function NamesGlyph({ wide, className }: { wide: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" {...STROKE}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18" />
      <path d={wide ? "m16 15-3-3 3-3" : "m14 9 3 3-3 3"} />
    </svg>
  );
}

export function PlusGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" {...STROKE}>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </svg>
  );
}

/** A pin: a tab that stays. Filled when the tab is pinned. */
export function PinGlyph({ className, filled = false }: { className?: string; filled?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
      {...STROKE}
      fill={filled ? "currentColor" : "none"}
    >
      <path d="M12 17v5" />
      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
    </svg>
  );
}

/** Two panes side by side: open in a split. */
export function SplitGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" {...STROKE}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M12 4v16" />
    </svg>
  );
}

interface PaneMapProps {
  screen: readonly ScreenPane[] | null;
  tab: string;
}

/**
 * The split layout in miniature, with the panes this tab is on screen in
 * filled — so the rail says where each tab is, not just that it is open.
 * Draws nothing outside a split or for a tab that is not on screen.
 */
export function PaneMap({ screen, tab }: PaneMapProps) {
  if (screen === null || !screen.some((pane) => pane.tab === tab)) return null;
  const width = 16;
  const height = 11;
  const inset = 0.75;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="bb-tab-nav-panes" aria-hidden="true">
      {screen.map((pane) => (
        <rect
          key={pane.paneId}
          x={pane.rect.x * width + inset}
          y={pane.rect.y * height + inset}
          width={Math.max(pane.rect.width * width - inset * 2, 1)}
          height={Math.max(pane.rect.height * height - inset * 2, 1)}
          rx={1.5}
          fill={pane.tab === tab ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth={1}
        />
      ))}
    </svg>
  );
}
