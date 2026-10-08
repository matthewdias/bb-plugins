// Tones: what colour a value draws in, and which one is worst.
//
// The palette is Thread Badges' (badges/complication-view.ts), so a failing
// check looks the same on a sidebar row and on this card. The vocabulary is
// open: a tone this file does not know draws, and ranks, as `default`.

export const TONE_COLORS: Readonly<Record<string, string>> = {
  default: "var(--muted-foreground)",
  info: "light-dark(#0969da, #4493f8)",
  success: "light-dark(#1a7f37, #3fb950)",
  warning: "light-dark(#9a6700, #d29922)",
  error: "var(--destructive)",
  running: "light-dark(#9a6700, #d29922)",
};

/** Worst first. The header's chips and its dot both read this order. */
export const SEVERITY = ["error", "warning", "running", "info", "success", "default"] as const;

function known(tone: string | undefined): tone is keyof typeof TONE_COLORS {
  return tone !== undefined && Object.prototype.hasOwnProperty.call(TONE_COLORS, tone);
}

export function toneColor(tone: string | undefined): string {
  return known(tone) ? TONE_COLORS[tone] : TONE_COLORS.default;
}

/** 0 for the worst; an unknown tone ranks as `default`. */
export function severityOf(tone: string | undefined): number {
  const index = (SEVERITY as readonly string[]).indexOf(known(tone) ? tone : "default");
  return index === -1 ? SEVERITY.length - 1 : index;
}

/** How much of a tone a tint carries: the glyph's square, a value's pill. */
export const TINT = 15;
/** The default tone's tint, in the muted colour, a touch lighter. */
export const MUTED_TINT = 14;

function isQuiet(tone: string | undefined): boolean {
  return toneColor(tone) === TONE_COLORS.default;
}

/**
 * A tone, mixed thin into transparency: the fill behind a glyph or a value.
 * Derived from `toneColor`, so it follows the theme and needs nothing per
 * provider; a quiet tone uses bb's muted colour.
 */
export function toneTint(tone: string | undefined): string {
  return isQuiet(tone)
    ? `color-mix(in srgb, ${TONE_COLORS.default} ${MUTED_TINT}%, transparent)`
    : `color-mix(in srgb, ${toneColor(tone)} ${TINT}%, transparent)`;
}

/** The square a glyph sits in. */
export function glyphFill(tone: string | undefined): string {
  return toneTint(tone);
}

/** A value's pill: its tone's tint, and text in the tone — or, quiet, in the foreground. */
export function pillColors(tone: string | undefined): { background: string; color: string } {
  return { background: toneTint(tone), color: isQuiet(tone) ? "var(--foreground)" : toneColor(tone) };
}

/** Marks a glyph that pulses while its value says work is running. */
export const RUNNING_ATTRIBUTE = "data-thread-summary-running";
