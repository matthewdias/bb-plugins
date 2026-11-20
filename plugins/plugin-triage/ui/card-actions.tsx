import type { ReactNode } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Direction } from "../lib/gesture";

export interface DeckAction {
  label: string;
  icon: string;
  fallback?: string;
  detail?: string;
}

export type DeckActions = Record<Direction, DeckAction>;

export const DIRECTIONS = ["left", "up", "right"] as const;
export const ARROWS = { left: "←", up: "↑", right: "→" } as const;

export const QUEUE_INSTALL: DeckAction = { label: "Queue install", icon: "ListPlus", fallback: "Plus" };

export const NEW_ACTIONS: DeckActions = {
  right: QUEUE_INSTALL,
  left: { label: "Dismiss", icon: "X" },
  up: { label: "Save", icon: "Bookmark" },
};

const TONES = {
  left: "text-red-600 dark:text-red-400",
  up: "text-sky-700 dark:text-sky-400",
  right: "text-emerald-700 dark:text-emerald-400",
};

export function CardActionButton({
  action,
  direction,
  onClick,
  shortcut = false,
  disabled = false,
  detail = action.detail,
}: {
  action: DeckAction;
  direction: Direction;
  onClick: () => void;
  shortcut?: boolean;
  disabled?: boolean;
  detail?: string;
}) {
  const name = shortcut ? `${action.label} (${ARROWS[direction]})` : action.label;
  return (
    <Button
      variant={shortcut ? "outline" : "ghost"}
      size={shortcut ? "round" : "icon"}
      className={cn(
        shortcut ? "bg-card" : "size-7",
        shortcut && direction !== "up" && "size-14 [&_svg]:size-6",
        TONES[direction],
      )}
      disabled={disabled}
      onClick={onClick}
      aria-label={name}
      aria-description={detail}
      title={detail === undefined ? name : `${name}: ${detail}`}
    >
      <Icon name={action.icon} fallback={action.fallback} aria-hidden />
    </Button>
  );
}

export function CardActionHint({ actions, children }: { actions: Partial<DeckActions>; children?: ReactNode }) {
  const text = DIRECTIONS.flatMap((direction) => {
    const action = actions[direction];
    return action === undefined ? [] : [`${ARROWS[direction]} ${action.label}`];
  }).join(" · ");

  return <p className="text-center text-xs text-muted-foreground">{text}{children}</p>;
}

const STAMPS = {
  right: "left-4 top-4 -rotate-12 border-emerald-500 text-emerald-500",
  left: "right-4 top-4 rotate-12 border-red-500 text-red-500",
  up: "bottom-24 left-1/2 -translate-x-1/2 border-sky-500 text-sky-500",
};

export function SwipeStamp({ direction, label, amount }: { direction: Direction; label: string; amount: number }) {
  return (
    <span
      className={cn(
        "pointer-events-none absolute rounded-md border-2 bg-card/90 px-3 py-1 text-lg font-bold uppercase tracking-wide",
        STAMPS[direction],
      )}
      style={{ opacity: amount }}
    >
      {label}
    </span>
  );
}
