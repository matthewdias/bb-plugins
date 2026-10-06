// Where a swiped thread row sits, and what letting go of it does.
//
// A row moves by `offset` px: positive slides it right to uncover the leading
// action (read/unread), negative slides it left to uncover the trailing
// buttons (pin, archive). Short of a threshold a row springs back. Past
// `revealWidth / 2` to the left it stays open on its buttons. Past `fullPx`
// it archives on release, as Mail does.
//
// Pure: the controller feeds it distances and renders what it returns.

export const ROW = {
  /** Width of one trailing button. */
  actionWidthPx: 72,
  /** Rightward travel that arms the leading action. */
  leadingArmPx: 80,
  /** A full swipe needs at least this much beyond the open buttons… */
  fullExtraPx: 40,
  /** …and at least this share of the row. */
  fullRatio: 0.6,
  /** But never closer than this to the far edge, or a narrow row can't arm it. */
  fullEdgeMarginPx: 24,
  /** A fling settles open or commits from as little as this. */
  flingMinPx: 24,
  /** Drag past the open buttons moves the row this much per px when there is no full swipe. */
  overdragResistance: 0.25,
} as const;

export interface RowLayout {
  /** The row's width in px. */
  width: number;
  /** How many trailing buttons there are. */
  trailingActions: number;
  /** Whether a rightward swipe does anything. */
  leading: boolean;
  /** Whether a leftward swipe does anything. */
  trailing: boolean;
  /** Whether a long leftward swipe archives on release. */
  full: boolean;
}

export type RowArm = "leading" | "full" | null;
export type RowRelease = "close" | "open" | "leading" | "full";

export function revealWidth(layout: RowLayout): number {
  return layout.trailingActions * ROW.actionWidthPx;
}

export function fullPx(layout: RowLayout): number {
  const wanted = Math.max(revealWidth(layout) + ROW.fullExtraPx, layout.width * ROW.fullRatio);
  return Math.min(wanted, layout.width - ROW.fullEdgeMarginPx);
}

/** Bound a raw drag distance to where the row may actually go. */
export function clampOffset(raw: number, layout: RowLayout): number {
  if (raw > 0) return layout.leading ? Math.min(raw, layout.width) : 0;
  if (raw < 0) {
    if (!layout.trailing) return 0;
    const reveal = revealWidth(layout);
    const travel = -raw;
    if (layout.full) return -Math.min(travel, layout.width);
    if (travel <= reveal) return raw;
    return -(reveal + (travel - reveal) * ROW.overdragResistance);
  }
  return 0;
}

/** Which action letting go here would take. Haptics tick when this changes. */
export function armOf(offset: number, layout: RowLayout): RowArm {
  if (layout.leading && offset >= ROW.leadingArmPx) return "leading";
  if (layout.trailing && layout.full && -offset >= fullPx(layout)) return "full";
  return null;
}

/** What releasing at `offset` does. `fling` is the release flick's direction. */
export function releaseOf(offset: number, fling: -1 | 0 | 1, layout: RowLayout): RowRelease {
  const arm = armOf(offset, layout);
  if (arm === "leading" && fling !== -1) return "leading";
  if (arm === "full" && fling !== 1) return "full";
  if (offset > 0) {
    const flungOpen = fling === 1 && offset >= Math.max(ROW.flingMinPx, ROW.leadingArmPx / 2);
    return layout.leading && flungOpen ? "leading" : "close";
  }
  if (offset < 0 && layout.trailing) {
    if (fling === 1) return "close";
    const travel = -offset;
    if (travel >= revealWidth(layout) / 2) return "open";
    if (fling === -1 && travel >= ROW.flingMinPx) return "open";
  }
  return "close";
}
