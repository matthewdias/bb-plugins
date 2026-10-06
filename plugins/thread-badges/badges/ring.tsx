// A gauge, drawn as the ring the follow-ups badge always drew: empty at
// nothing, a visible notch at "one left", full at done.

const SIZE = 14;
const RADIUS = 5;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function Ring({ fraction, color }: { fraction: number; color: string }) {
  return (
    <svg
      aria-hidden
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      width={SIZE}
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle
        cx={SIZE / 2}
        cy={SIZE / 2}
        fill="none"
        r={RADIUS}
        stroke="var(--border)"
        strokeWidth={2}
      />
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
