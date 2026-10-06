// The Saved tab: plugins kept for later, drawn as bb draws its own plugin
// lists, so it reads as part of the Plugins screen. The card opens bb's own
// detail pane for the entry; its footer names the author on the left and
// carries one compact action on the right, with the rest in a ⋯ menu.
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { NewCard } from "../lib/new-deck";

export interface SavedListProps {
  cards: readonly NewCard[];
  onDetails: (card: NewCard) => void;
  onInstall: (card: NewCard) => void;
  onRemove: (card: NewCard) => void;
  onOpen: (card: NewCard) => void;
  onVet: (card: NewCard) => void;
}

export function SavedList({ cards, onDetails, onInstall, onRemove, onOpen, onVet }: SavedListProps) {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-4">
      <p className="text-sm leading-5 text-muted-foreground">
        Plugins you saved for later, most recent first. Open one for its full listing, or install it from here.
      </p>
      {cards.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          Nothing saved. Drag a card up, or press ↑, to keep it here.
        </p>
      ) : (
        <ul className="grid w-full grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] gap-2">
          {cards.map((card) => (
            <SavedCard
              key={card.key}
              card={card}
              onDetails={onDetails}
              onInstall={onInstall}
              onRemove={onRemove}
              onOpen={onOpen}
              onVet={onVet}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function SmallIcon({ card }: { card: NewCard }) {
  return (
    <span className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-muted/40 text-muted-foreground">
      {card.iconUrl !== null ? (
        <img src={card.iconUrl} alt="" className="size-4 object-contain" />
      ) : (
        <Icon name={card.icon ?? "Puzzle"} fallback="Puzzle" className="size-4" aria-hidden />
      )}
    </span>
  );
}

function Byline({ card }: { card: NewCard }) {
  const github = card.author?.github ?? null;
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {github !== null && (
        <img
          src={`https://github.com/${encodeURIComponent(github)}.png?size=40`}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="size-5 shrink-0 rounded-full border border-border bg-muted"
        />
      )}
      <span className="min-w-0 truncate">{card.author?.name ?? card.marketplaceDisplayName}</span>
    </span>
  );
}

type CardProps = Omit<SavedListProps, "cards"> & { card: NewCard };

function SavedCard({ card, onDetails, onInstall, onRemove, onOpen, onVet }: CardProps) {
  return (
    <li className="group relative grid h-full min-h-36 grid-rows-[auto_1fr_auto] gap-y-2 rounded-xl border border-border bg-card p-3 text-left transition-[border-color,box-shadow] duration-150 hover:border-foreground/30 hover:shadow-sm">
      {/* The whole card is the button, as on bb's own cards; the footer's
          controls sit above it. */}
      <button
        type="button"
        aria-label={`${card.displayName} details`}
        onClick={() => onDetails(card)}
        className="absolute inset-0 cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      <span className="pointer-events-none relative flex min-w-0 items-center gap-3">
        <SmallIcon card={card} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{card.displayName}</span>
      </span>
      <p className="pointer-events-none relative line-clamp-2 min-h-[2lh] self-center text-xs leading-snug text-muted-foreground">
        {card.description}
      </p>
      <div className="relative flex min-w-0 items-center justify-between gap-2 border-t border-border/60 pt-2 text-xs text-muted-foreground">
        <span className="pointer-events-none min-w-0">
          <Byline card={card} />
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => onInstall(card)}
            disabled={!card.compatible}
            title={card.compatible ? undefined : (card.incompatibleReason ?? "Not compatible with this bb")}
          >
            Install
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-6" aria-label={`More for ${card.displayName}`}>
                <Icon name="MoreHorizontal" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onVet(card)}>
                <Icon name="SecurityCheck" className="size-4" aria-hidden />
                Vet with an agent
              </DropdownMenuItem>
              {card.link !== null && (
                <DropdownMenuItem onSelect={() => onOpen(card)}>
                  <Icon name="ExternalLink" className="size-4" aria-hidden />
                  {card.marketplace === "bb-community" ? "Open on getbb.app" : "Open repository"}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onSelect={() => onRemove(card)}>
                <Icon name="Trash2" className="size-4" aria-hidden />
                Remove from Saved
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </div>
    </li>
  );
}
