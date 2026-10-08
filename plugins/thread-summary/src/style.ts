// The rules a style attribute cannot state: a keyframe, a hover, and the
// glass panel's fallbacks. One stylesheet in the document while any header is
// mounted, keyed by data attributes, so it reaches the card wherever it is
// portaled — and depends on no utility being in bb's stylesheet.
import { useEffect } from "react";
import { RUNNING_ATTRIBUTE } from "../lib/tone";

export const STYLE_ID = "thread-summary-style";
export const CARD_ATTRIBUTE = "data-thread-summary-card";
export const LINE_ATTRIBUTE = "data-thread-summary-line";

/**
 * The card is a glass panel: bb's popover colour at 70% over a blur of what
 * is behind it. Where `backdrop-filter` is not supported, or the reader asks
 * for less transparency, it is the opaque popover instead — so the solid
 * look is the default and the glass is the enhancement.
 */
export const STYLESHEET = [
  "@keyframes thread-summary-running { 50% { opacity: 0.4; } }",
  "@media (prefers-reduced-motion: no-preference) {",
  `  [${RUNNING_ATTRIBUTE}] { animation: thread-summary-running 1.6s ease-in-out infinite; }`,
  "}",
  `[${CARD_ATTRIBUTE}] {`,
  "  border-radius: 16px;",
  "  padding: 6px;",
  "  background: var(--popover);",
  "  border: 1px solid color-mix(in srgb, var(--foreground) 9%, transparent);",
  "  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.18), 0 1px 0 rgba(255, 255, 255, 0.06) inset;",
  "}",
  "@supports (backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)) {",
  `  [${CARD_ATTRIBUTE}] {`,
  "    background: color-mix(in srgb, var(--popover) 70%, transparent);",
  "    -webkit-backdrop-filter: blur(18px) saturate(1.5);",
  "    backdrop-filter: blur(18px) saturate(1.5);",
  "  }",
  "}",
  "@media (prefers-reduced-transparency: reduce) {",
  `  [${CARD_ATTRIBUTE}] { background: var(--popover); -webkit-backdrop-filter: none; backdrop-filter: none; }`,
  "}",
  `[${LINE_ATTRIBUTE}]:hover { background: color-mix(in srgb, var(--foreground) 5%, transparent); }`,
].join("\n");

let users = 0;

export function useSummaryStyle(): void {
  useEffect(() => {
    users += 1;
    if (document.getElementById(STYLE_ID) === null) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = STYLESHEET;
      document.head.append(style);
    }
    return () => {
      users -= 1;
      if (users === 0) document.getElementById(STYLE_ID)?.remove();
    };
  }, []);
}
