// A value's glyph: the provider's icon in its tone, or, for a gauge, the ring
// Thread Badges draws (badges/ring.tsx), so Follow Up's progress looks the
// same here as on a sidebar row.
import { useEffect } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import type { ComplicationValue } from "../lib/complications";
import { RUNNING_ATTRIBUTE, toneColor } from "../lib/tone";

const SIZE = 14;
const RADIUS = 5;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function Ring({ fraction, color }: { fraction: number; color: string }) {
  return (
    <svg aria-hidden height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} xmlns="http://www.w3.org/2000/svg">
      <circle cx={SIZE / 2} cy={SIZE / 2} fill="none" r={RADIUS} stroke="var(--border)" strokeWidth={2} />
      <circle
        cx={SIZE / 2}
        cy={SIZE / 2}
        fill="none"
        r={RADIUS}
        stroke={color}
        strokeDasharray={`${fraction * CIRCUMFERENCE} ${CIRCUMFERENCE}`}
        // Butt, not round: at 27 of 28 a rounded cap closes the last gap and
        // the ring reads as finished when it is not.
        strokeLinecap="butt"
        strokeWidth={2}
        // Start the arc at twelve o'clock rather than three.
        transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
      />
    </svg>
  );
}

export function Glyph({ value }: { value: ComplicationValue }) {
  const color = toneColor(value.tone);
  return (
    <span
      aria-hidden
      {...(value.tone === "running" ? { [RUNNING_ATTRIBUTE]: "" } : {})}
      style={{ display: "inline-flex", flex: "none", alignItems: "center" }}
    >
      {value.fraction !== undefined ? (
        <Ring color={color} fraction={value.fraction} />
      ) : (
        <Icon aria-hidden fallback="Circle" name={value.icon} style={{ color, height: SIZE, width: SIZE }} />
      )}
    </span>
  );
}

const STYLE_ID = "thread-summary-running";
let styleUsers = 0;

/**
 * The `running` tone pulses. A keyframe cannot be an inline style, so one
 * rule goes in the document while any header is mounted, and only where the
 * reader has not asked their system for less motion.
 */
export function useRunningStyle(): void {
  useEffect(() => {
    styleUsers += 1;
    if (document.getElementById(STYLE_ID) === null) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = [
        "@keyframes thread-summary-running { 50% { opacity: 0.4; } }",
        "@media (prefers-reduced-motion: no-preference) {",
        `  [${RUNNING_ATTRIBUTE}] { animation: thread-summary-running 1.6s ease-in-out infinite; }`,
        "}",
      ].join("\n");
      document.head.append(style);
    }
    return () => {
      styleUsers -= 1;
      if (styleUsers === 0) document.getElementById(STYLE_ID)?.remove();
    };
  }, []);
}
