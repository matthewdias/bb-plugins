// One catalog entry as a card: who made it, what it does, where its code
// comes from. The top card can open its details: the long overview, every
// screenshot, and the agent review.
import { useEffect, useRef, useState } from "react";
import { Markdown, experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { NewCard } from "../lib/new-deck";
import type { Plan } from "./decisions";
import { Gallery } from "./Gallery";
import { haptic } from "./haptics";

export function PluginIcon({ card, className }: { card: Pick<NewCard, "icon" | "iconUrl" | "displayName">; className?: string }) {
  if (card.iconUrl !== null) {
    return <img src={card.iconUrl} alt="" className={cn("size-12 shrink-0 rounded-lg object-contain", className)} />;
  }
  return (
    <span className={cn("flex size-12 shrink-0 items-center justify-center rounded-lg bg-muted", className)}>
      <Icon name={card.icon ?? "Puzzle"} fallback="Puzzle" className="size-6" aria-hidden />
    </span>
  );
}

const DAY = 24 * 60 * 60 * 1000;

export function ago(iso: string | null, now = Date.now()): string | null {
  if (iso === null) return null;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  const days = Math.floor((now - at) / DAY);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function Chip({ children, tone }: { children: React.ReactNode; tone?: "warn" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground",
        tone === "warn" && "border-amber-500/40 text-amber-600 dark:text-amber-400",
      )}
    >
      {children}
    </span>
  );
}

export interface EntryCardProps {
  card: NewCard;
  /** Only the top card loads its plan and can expand. */
  top: boolean;
  plan: Plan | null;
  planError: string | null;
  expanded: boolean;
  onToggleDetails?: () => void;
  onVet?: () => void;
  onOpen?: () => void;
}

export function EntryCard({ card, top, plan, planError, expanded, onToggleDetails, onVet, onOpen }: EntryCardProps) {
  const [shot, setShot] = useState(0);
  const [gallery, setGallery] = useState<number | null>(null);
  useEffect(() => {
    setShot(0);
    setGallery(null);
  }, [card.key]);
  // Expanding swaps the screenshot for the overview; start it from the top.
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (body.current !== null) body.current.scrollTop = 0;
  }, [expanded]);
  const published = ago(card.publishedAt);
  const shots = card.screenshots;
  const screenshot = shots[shot] ?? null;
  const hero = screenshot !== null && !expanded;

  return (
    <article
      className="flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-xl"
      aria-label={card.displayName}
    >
      {hero && (
        // The first thing on the card, as a store listing leads with its
        // screenshot. A tap opens the gallery; a drag still moves the card.
        <button
          type="button"
          className="group/hero relative block aspect-[16/10] max-h-[45%] w-full shrink-0 cursor-zoom-in overflow-hidden border-b border-border bg-muted"
          onClick={() => {
            if (!top) return;
            haptic("selection");
            setGallery(shot);
          }}
          aria-label={shots.length > 1 ? `Open ${shots.length} screenshots` : "Open screenshot"}
          tabIndex={top ? 0 : -1}
          data-tap
        >
          <img src={screenshot} alt="" className="size-full object-cover object-top" draggable={false} />
          <span
            className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-black/55 px-2 py-1 text-[11px] font-medium text-white opacity-90 transition-opacity group-hover/hero:opacity-100"
            aria-hidden
          >
            <Icon name="ZoomIn" className="size-3" />
            {shots.length > 1 && <span className="tabular-nums">{shots.length}</span>}
          </span>
          {shots.length > 1 && (
            <span className="absolute inset-x-0 bottom-2 flex justify-center gap-1.5" aria-hidden>
              {shots.map((_, index) => (
                <span
                  key={index}
                  className={cn("size-1.5 rounded-full shadow-sm", index === shot ? "bg-white" : "bg-white/45")}
                />
              ))}
            </span>
          )}
        </button>
      )}

      <header className="flex items-center gap-3 px-4 pb-2 pt-4">
        <PluginIcon card={card} className={hero ? "size-10" : undefined} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold leading-tight">{card.displayName}</h2>
          <p className="truncate text-xs text-muted-foreground">
            {card.author === null ? card.marketplaceDisplayName : `${card.author.name} · ${card.marketplaceDisplayName}`}
          </p>
        </div>
      </header>

      <div className="flex flex-wrap gap-1.5 px-4">
        {card.category !== null && <Chip>{card.category}</Chip>}
        {card.installs !== null && <Chip>{card.installs.toLocaleString()} installs</Chip>}
        {published !== null && <Chip>{published === "today" || published === "yesterday" ? `New ${published}` : `Published ${published}`}</Chip>}
        {card.resurfaced && <Chip>Updated since you dismissed it</Chip>}
        {!card.compatible && <Chip tone="warn">{card.incompatibleReason ?? "Not compatible with this bb"}</Chip>}
        {card.lastFailure !== null && <Chip tone="warn">Last install failed</Chip>}
      </div>

      <div className="relative min-h-0 flex-1">
        <div
          ref={body}
          className={cn(
            "h-full px-4 pt-3",
            expanded
              ? "touch-pan-y overflow-y-auto overscroll-contain pb-4"
              : // Whatever doesn't fit fades out rather than stopping mid-line,
                // and a tap anywhere on it opens the details.
                cn(
                  "overflow-hidden [mask-image:linear-gradient(to_bottom,black_70%,transparent)]",
                  top && "cursor-pointer",
                ),
          )}
          onClick={() => {
            if (!top || expanded) return;
            haptic("selection");
            onToggleDetails?.();
          }}
          data-scroll={expanded ? "" : undefined}
          data-testid="card-body"
        >
          <p className="text-sm leading-relaxed">{card.description}</p>

          {card.lastFailure !== null && (
            <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">Last attempt: {card.lastFailure}</p>
          )}

          {expanded && (
            <div className="mt-4 space-y-4">
              {card.overview !== null && <Markdown content={card.overview} className="text-sm" />}
              {shots.map((url, index) => (
                <button
                  key={url}
                  type="button"
                  className="block w-full cursor-zoom-in overflow-hidden rounded-lg border border-border"
                  onClick={() => {
                    haptic("selection");
                    setGallery(index);
                  }}
                  aria-label={`Open screenshot ${index + 1}`}
                  data-tap
                >
                  <img src={url} alt="" className="w-full" draggable={false} loading="lazy" />
                </button>
              ))}
            </div>
          )}
        </div>
        {top && !expanded && (card.overview !== null || shots.length > 0) && (
          // Sits over the fade, outside the masked body, as the hint that
          // there is more to read.
          <span className="pointer-events-none absolute bottom-1.5 right-3 rounded-full border border-border bg-card px-2 py-0.5 text-[11px] font-medium text-muted-foreground shadow-sm">
            More
          </span>
        )}
      </div>

      <Gallery
        title={card.displayName}
        shots={shots}
        index={gallery}
        onIndex={(index) => {
          // A tick per screenshot paged to; closing is silent.
          if (index !== null && index !== gallery) haptic("selection");
          setGallery(index);
          if (index !== null) setShot(index);
        }}
      />

      {top && (
        <footer className="border-t border-border px-2 pb-2 pt-1.5">
          <p
            className="truncate px-2 pb-1 font-mono text-[11px] text-muted-foreground"
            title={plan?.summary?.label ?? card.source}
          >
            {plan?.summary?.label ?? (planError === null ? card.source : `${card.source} (couldn't resolve: ${planError})`)}
          </p>
          <div className={cn("grid gap-1", card.link === null ? "grid-cols-2" : "grid-cols-3")}>
            <Button variant="ghost" size="sm" onClick={onToggleDetails} aria-pressed={expanded}>
              <Icon name="Info" aria-hidden /> {expanded ? "Less" : "Details"}
            </Button>
            <Button variant="ghost" size="sm" onClick={onVet} aria-label="Vet with an agent">
              <Icon name="SecurityCheck" aria-hidden /> Vet
            </Button>
            {card.link !== null && (
              <Button variant="ghost" size="sm" onClick={onOpen} aria-label="Open its page">
                <Icon name="ExternalLink" aria-hidden /> Open
              </Button>
            )}
          </div>
        </footer>
      )}
    </article>
  );
}
