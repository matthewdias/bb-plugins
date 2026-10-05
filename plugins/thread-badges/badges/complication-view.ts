// What a complication's value looks like on a row, decided without React.
//
// The value is data another plugin published; this turns it into the one
// thing a row draws, or nothing. A fraction is a gauge, drawn as the ring the
// follow-ups badge has always drawn. Anything else is the provider's own icon,
// coloured by its tone. Text rides beside either, when you asked for it.
import type { ComplicationValue } from "../lib/complications";
import type { ComplicationPrefs } from "./complication-prefs";

/**
 * The palette the built-in badges already use, so a provider's error looks
 * like a failed check. Unknown tones — the vocabulary is open — draw as
 * default rather than guessing.
 */
export const TONE_COLORS: Readonly<Record<string, string>> = {
  default: "var(--muted-foreground)",
  info: "light-dark(#0969da, #4493f8)",
  success: "light-dark(#1a7f37, #3fb950)",
  warning: "light-dark(#9a6700, #d29922)",
  error: "var(--destructive)",
  running: "light-dark(#9a6700, #d29922)",
};

export function toneColor(tone: string | undefined): string {
  return tone !== undefined && Object.prototype.hasOwnProperty.call(TONE_COLORS, tone)
    ? TONE_COLORS[tone]
    : TONE_COLORS.default;
}

interface ViewBase {
  label: string;
  color: string;
  /** Animated where motion is allowed: bb's `running` tone is work in progress. */
  running: boolean;
  /** Beside the glyph, or null. */
  text: string | null;
}

export type ComplicationView =
  | (ViewBase & { kind: "ring"; fraction: number })
  | (ViewBase & { kind: "glyph"; icon: string });

export function complicationView(
  value: ComplicationValue | null | undefined,
  prefs: Pick<ComplicationPrefs, "showText" | "hideWhenComplete">,
): ComplicationView | null {
  // Unanswered and "nothing to say" both draw nothing, and take no slot.
  if (value == null) return null;
  const base: ViewBase = {
    label: value.label,
    color: toneColor(value.tone),
    running: value.tone === "running",
    text: prefs.showText && value.text !== undefined ? value.text : null,
  };
  if (value.fraction !== undefined) {
    if (prefs.hideWhenComplete && value.fraction >= 1) return null;
    return { ...base, kind: "ring", fraction: value.fraction };
  }
  return { ...base, kind: "glyph", icon: value.icon };
}
