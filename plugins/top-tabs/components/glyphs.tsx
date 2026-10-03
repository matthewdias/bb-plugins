// The strip's own glyphs, drawn inline so they never depend on which icon
// names a given bb build resolves. Destination icons come from bb itself,
// through `experimental_SidebarNavigationIcon`.
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

export function PlusGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" {...STROKE}>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </svg>
  );
}

/** A gear: bb's Settings, which brings no icon of its own to the strip. */
export function GearGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" {...STROKE}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
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
 * filled — so the strip says where each tab is, not just that it is open.
 * Draws nothing outside a split or for a tab that is not on screen.
 */
export function PaneMap({ screen, tab }: PaneMapProps) {
  if (screen === null || !screen.some((pane) => pane.tab === tab)) return null;
  const width = 16;
  const height = 11;
  const inset = 0.75;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="bb-top-tab-panes" aria-hidden="true">
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
