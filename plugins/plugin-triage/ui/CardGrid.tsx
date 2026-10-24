// Every card at once, laid out as bb's own plugin store lays out its
// listings: the same grid, and cards with the same shape (icon and name, two
// lines of description, a byline over a rule). Where the store's card has its
// Install button, these carry the deck's three decisions, so a card can be
// decided without dealing the rest first. A tap on a card previews it: the
// deck's own card, opened in full, over the grid, with the deck's decisions
// under it; deciding moves the preview on to the next card in the grid.
import { Fragment, useEffect, useRef, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePortalScopeProps } from "@/lib/portal-scope";
import { cn } from "@/lib/utils";
import { arrange, defaultDirection, type Arrangement, type Facts, type Grouping, type SortKey } from "../lib/arrange";
import { keyCommand, type Direction } from "../lib/gesture";
import { typingTarget, type DeckActions } from "./CardStack";
import { haptic } from "./haptics";
import { setArrangement, useArrangement } from "./layout";

/** Each decision's colour, as on the deck's buttons, shown on hover. */
const TONES: Record<Direction, string> = {
  left: "hover:text-red-500",
  up: "hover:text-sky-500",
  right: "hover:text-emerald-500",
};

/** The orders, named as bb's store names them, and each way round. */
const SORT_LABELS: Record<SortKey, { label: string; asc: string; desc: string }> = {
  deal: { label: "Deck order", asc: "", desc: "" },
  name: { label: "Name", asc: "A–Z", desc: "Z–A" },
  published: { label: "Published", asc: "Oldest first", desc: "Newest first" },
  installs: { label: "Installs", asc: "Fewest first", desc: "Most first" },
};

const GROUP_LABELS: Record<Grouping, string> = { none: "None", category: "Category", source: "Source" };

function sortSummary({ sort, direction }: Arrangement): string {
  return sort === "deal" ? SORT_LABELS.deal.label : `${SORT_LABELS[sort].label} · ${SORT_LABELS[sort][direction]}`;
}

export interface CardGridProps<T extends { key: string }> {
  cards: readonly T[];
  /** What each card says about itself, to sort and group by. */
  facts: (card: T) => Facts;
  /** The orders this tab offers besides the deck's own. */
  sorts: readonly Exclude<SortKey, "deal">[];
  /** What the cards are, one and many: ["update", "updates"]. */
  noun: readonly [string, string];
  render: (card: T) => ReactNode;
  /** What → ← ↑ do for this card, and doing it. */
  actions: (card: T) => DeckActions;
  onDecide: (card: T, direction: Direction) => void;
  /** The card previewed, by key; null when none is. */
  previewKey: string | null;
  onPreview: (key: string | null) => void;
  /** The previewed card's body; `close` for its controls that leave the page. */
  renderPreview: (card: T, close: () => void) => ReactNode;
  onUndo: () => void;
  /** False while another surface owns the keyboard. */
  keyboard?: boolean;
}

export function CardGrid<T extends { key: string }>({
  cards,
  facts,
  sorts,
  noun,
  render,
  actions,
  onDecide,
  previewKey,
  onPreview,
  renderPreview,
  onUndo,
  keyboard = true,
}: CardGridProps<T>) {
  const stored = useArrangement();
  // A sort this tab doesn't offer (Published, chosen on New, seen on
  // Cleanup) reads as the deck's order here and stays chosen for the others.
  const how: Arrangement = sorts.includes(stored.sort as Exclude<SortKey, "deal">) ? stored : { ...stored, sort: "deal" };
  const groups = arrange(cards, how, facts, ["deal", ...sorts]);
  const order = groups.flatMap((group) => group.cards);
  // A card decided or taken elsewhere closes its preview.
  const previewed = previewKey === null ? null : (order.find((card) => card.key === previewKey) ?? null);

  /** Decide on the previewed card and move on to the one after it, as the deck deals the next. */
  function decidePreviewed(direction: Direction) {
    if (previewed === null) return;
    const at = order.indexOf(previewed);
    const next = order[at + 1] ?? order[at - 1] ?? null;
    haptic(direction === "right" ? "impact-medium" : "impact-light");
    onDecide(previewed, direction);
    onPreview(next?.key ?? null);
  }

  // The deck's arrow keys need a card on top, and a grid has none; Z still
  // takes back the last decision.
  useEffect(() => {
    if (!keyboard) return;
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || typingTarget(event.target) || keyCommand(event) !== "undo") return;
      event.preventDefault();
      onUndo();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keyboard, onUndo]);

  function chooseSort(sort: SortKey) {
    // Choosing the order already in force turns it round, as bb's store does.
    const direction = sort === how.sort ? (how.direction === "asc" ? "desc" : "asc") : defaultDirection(sort);
    setArrangement({ ...stored, sort, direction });
  }

  return (
    <div className="mx-auto w-full max-w-[80rem] space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="mr-auto text-xs text-muted-foreground">
          {cards.length} {cards.length === 1 ? noun[0] : noun[1]}
        </p>
        <div className="flex items-center gap-0.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground"
                aria-label={`Group: ${GROUP_LABELS[how.group]}`}
              >
                <Icon name="ListView" fallback="Layers" aria-hidden />
                {how.group === "none" ? "Group" : GROUP_LABELS[how.group]}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Group by</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={how.group}>
                {(Object.keys(GROUP_LABELS) as Grouping[]).map((group) => (
                  <DropdownMenuRadioItem key={group} value={group} onSelect={() => setArrangement({ ...stored, group })}>
                    {GROUP_LABELS[group]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground" aria-label={`Sort: ${sortSummary(how)}`}>
                <Icon name="ArrowUpDown" aria-hidden />
                {how.sort === "deal" ? "Sort" : sortSummary(how)}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Sort by</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={how.sort}>
                {(["deal", ...sorts] as SortKey[]).map((sort) => (
                  <DropdownMenuRadioItem
                    key={sort}
                    value={sort}
                    onSelect={() => chooseSort(sort)}
                    trailing={sort === how.sort && sort !== "deal" ? SORT_LABELS[sort][how.direction] : undefined}
                  >
                    {SORT_LABELS[sort].label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground" onClick={onUndo} aria-label="Undo (Z)">
            <Icon name="RotateCcw" aria-hidden /> Undo
          </Button>
        </div>
      </div>
      {groups.map((group) => (
        <section key={group.label ?? "all"} className="space-y-2" aria-label={group.label ?? undefined}>
          {group.label !== null && (
            <h3 className="flex items-baseline gap-1.5 px-0.5 pt-2 text-xs font-medium text-muted-foreground">
              {group.label}
              <span className="tabular-nums opacity-70">{group.cards.length}</span>
            </h3>
          )}
          {/* bb's grid stretches a short row across; grouped, every group
              keeps the same columns, so a group of one lines up with the rest. */}
          <div
            className={cn(
              "grid gap-2.5",
              group.label === null
                ? "grid-cols-[repeat(auto-fit,minmax(min(100%,23rem),1fr))]"
                : "grid-cols-[repeat(auto-fill,minmax(min(100%,23rem),1fr))]",
            )}
            role="list"
          >
            {group.cards.map((card) => (
              <Fragment key={card.key}>{render(card)}</Fragment>
            ))}
          </div>
        </section>
      ))}
      {previewed !== null && (
        <Preview
          title={facts(previewed).name}
          actions={actions(previewed)}
          keyboard={keyboard}
          onDecide={decidePreviewed}
          onClose={() => onPreview(null)}
        >
          {renderPreview(previewed, () => onPreview(null))}
        </Preview>
      )}
    </div>
  );
}

/** Every key the deck decides with, and Escape. */
const PREVIEW_KEYS: Record<string, Direction | "close"> = {
  ArrowRight: "right",
  ArrowLeft: "left",
  ArrowUp: "up",
  Escape: "close",
};

/**
 * The previewed card over the grid, with the deck's decisions under it. Its
 * keys are the deck's: the arrows decide, Escape closes. bb binds Escape on
 * the Plugins screen too, and does not check whether it was handled, so the
 * preview takes its keys at the window's capture phase and stops them there,
 * as the deck does; a gallery opened from the card keeps its own.
 */
function Preview({
  title,
  actions,
  keyboard,
  onDecide,
  onClose,
  children,
}: {
  title: string;
  actions: DeckActions;
  keyboard: boolean;
  onDecide: (direction: Direction) => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const portalProps = usePortalScopeProps();
  const latest = useRef({ onDecide, onClose });
  latest.current = { onDecide, onClose };

  useEffect(() => {
    if (!keyboard) return;
    function onKey(event: KeyboardEvent) {
      const command = PREVIEW_KEYS[event.key];
      if (command === undefined || event.metaKey || event.ctrlKey || event.altKey || typingTarget(event.target)) return;
      if (document.querySelector("[data-triage-gallery]") !== null) return;
      event.preventDefault();
      event.stopPropagation();
      if (command === "close") latest.current.onClose();
      else latest.current.onDecide(command);
    }
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [keyboard]);

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay {...portalProps} className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-[2px]" />
        <Dialog.Content
          {...portalProps}
          aria-describedby={undefined}
          data-no-sidebar-swipe=""
          data-no-secondary-panel-swipe=""
          data-triage-preview=""
          // The keys are handled above, at the window, before Radix sees them.
          onEscapeKeyDown={(event) => event.preventDefault()}
          className="fixed inset-x-0 bottom-0 top-0 z-[61] sm:bottom-6 sm:top-6 mx-auto flex w-full max-w-md flex-col gap-3 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] outline-none"
          onClick={(event) => {
            // A tap on the backdrop around the card closes it.
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <Dialog.Title className="sr-only">Preview of {title}</Dialog.Title>
          <div className="flex shrink-0 justify-end">
            <Dialog.Close asChild>
              <Button variant="ghost" size="sm" className="h-8 bg-card/90 text-xs shadow-sm">
                Close
              </Button>
            </Dialog.Close>
          </div>
          <div className="relative min-h-0 flex-1">{children}</div>
          <div className="flex shrink-0 items-center justify-center gap-4" role="toolbar" aria-label="Decide">
            <Button
              variant="outline"
              size="round"
              className="size-14 bg-card text-red-500"
              onClick={() => onDecide("left")}
              aria-label={`${actions.left.name} (←)`}
            >
              <Icon name={actions.left.icon} className="size-6" aria-hidden />
            </Button>
            <Button
              variant="outline"
              size="round"
              className="bg-card text-sky-500"
              onClick={() => onDecide("up")}
              aria-label={`${actions.up.name} (↑)`}
            >
              <Icon name={actions.up.icon} aria-hidden />
            </Button>
            <Button
              variant="outline"
              size="round"
              className="size-14 bg-card text-emerald-500"
              onClick={() => onDecide("right")}
              aria-label={`${actions.right.name} (→)`}
            >
              <Icon name={actions.right.icon} className="size-6" aria-hidden />
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export interface GridCardProps {
  title: string;
  leading: ReactNode;
  description: ReactNode;
  /** A line that should give pause: a failed attempt, why it's in Cleanup. */
  note?: { text: string; tone?: "warn" } | null;
  /** Under the note: what a decision would cost, such as an uninstall. */
  footnote?: string;
  byline: ReactNode;
  actions: DeckActions;
  /** More on a decision's button, after its name: what it would do here. */
  hints?: Partial<Record<Direction, string>>;
  onDecide: (direction: Direction) => void;
  openLabel: string;
  onOpen: () => void;
}

export function GridCard({
  title,
  leading,
  description,
  note,
  footnote,
  byline,
  actions,
  hints,
  onDecide,
  openLabel,
  onOpen,
}: GridCardProps) {
  function decide(direction: Direction) {
    // As the deck does: a firmer thud for the decision that changes something.
    haptic(direction === "right" ? "impact-medium" : "impact-light");
    onDecide(direction);
  }
  return (
    <article
      role="listitem"
      aria-label={title}
      className="group relative grid h-full min-h-36 w-full grid-cols-[minmax(0,1fr)] grid-rows-[auto_1fr_auto] gap-y-2 rounded-xl border border-border bg-card p-3 text-left transition-[border-color,box-shadow,background-color] duration-150 hover:border-foreground/30 hover:bg-[color-mix(in_oklab,var(--ink)_2.5%,transparent)] hover:shadow-sm"
    >
      {/* The whole card opens it; everything drawn over this lets the press
          through, except the decisions. */}
      <button
        type="button"
        aria-label={openLabel}
        onClick={onOpen}
        className="absolute inset-0 cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      <span className="pointer-events-none relative flex min-w-0 items-center">
        <span className="flex size-6 shrink-0 items-center justify-center">{leading}</span>
        <span className="ml-3 line-clamp-2 min-w-0 flex-1 text-sm font-medium text-foreground">{title}</span>
      </span>
      <span className="pointer-events-none relative space-y-1 text-xs leading-snug text-muted-foreground">
        <span className="line-clamp-2 min-h-[2lh]">{description}</span>
        {note != null && (
          <span
            className={cn("block truncate", note.tone === "warn" && "text-amber-600 dark:text-amber-400")}
            title={note.text}
          >
            {note.text}
          </span>
        )}
        {footnote !== undefined && <span className="line-clamp-2" title={footnote}>{footnote}</span>}
      </span>
      <div className="pointer-events-none relative flex min-w-0 items-center justify-between gap-2 border-t border-border/60 pt-2 text-xs text-subtle-foreground">
        <span className="min-w-0 truncate">{byline}</span>
        <span className="pointer-events-auto flex shrink-0 items-center gap-0.5" role="group" aria-label={`Decide on ${title}`}>
          {(["left", "up", "right"] as const).map((direction) => (
            <Button
              key={direction}
              variant="ghost"
              size="sm"
              className={cn("h-7 min-w-7 gap-1.5 px-2 text-xs font-normal text-subtle-foreground shadow-none", TONES[direction])}
              onClick={() => decide(direction)}
              aria-label={actions[direction].name}
              aria-description={hints?.[direction]}
              title={hints?.[direction] === undefined ? actions[direction].name : `${actions[direction].name}: ${hints[direction]}`}
            >
              <Icon name={actions[direction].icon} className="size-3.5" aria-hidden />
              {/* The deciding one names itself, as the store's Install does. */}
              {direction === "right" && actions.right.label}
            </Button>
          ))}
        </span>
      </div>
    </article>
  );
}
