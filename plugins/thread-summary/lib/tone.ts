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

/** Marks a glyph that pulses while its value says work is running. */
export const RUNNING_ATTRIBUTE = "data-thread-summary-running";
