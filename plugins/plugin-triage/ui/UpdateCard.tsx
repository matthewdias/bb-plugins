// One pending update as a card: which plugin, from which version to which,
// and anything that should give pause: a newer release bb won't take, or the
// last attempt failing.
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { UpdateCard as Card } from "../lib/updates-deck";
import { PluginIcon } from "./EntryCard";

export interface UpdateCardProps {
  card: Card;
  top: boolean;
  onChanges?: () => void;
  onDetails?: () => void;
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

export function UpdateCard({ card, top, onChanges, onDetails }: UpdateCardProps) {
  return (
    <article
      className="flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-xl"
      aria-label={`${card.displayName} update`}
    >
      <header className="flex items-center gap-3 px-4 pb-2 pt-4">
        <PluginIcon card={card} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold leading-tight">{card.displayName}</h2>
          <p className="truncate text-xs text-muted-foreground">Update available</p>
        </div>
      </header>

      <div className="flex flex-wrap gap-1.5 px-4">
        {!card.enabled && <Chip>Disabled</Chip>}
        {card.isSelf && <Chip>Updates last; this page reloads</Chip>}
        {card.lastFailure !== null && <Chip tone="warn">Last update failed</Chip>}
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-hidden px-4 pt-4">
        <dl className="space-y-2 rounded-lg border border-border p-3 font-mono text-xs">
          <div className="flex gap-2">
            <dt className="w-12 shrink-0 text-muted-foreground">Now</dt>
            <dd className="min-w-0 break-all" title={card.from.display}>
              {card.from.short}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-12 shrink-0 text-muted-foreground">Next</dt>
            <dd className="min-w-0 break-all font-semibold" title={card.to.display}>
              {card.to.short}
            </dd>
          </div>
        </dl>

        {card.description !== null && (
          <p className="line-clamp-4 text-sm leading-relaxed text-muted-foreground">{card.description}</p>
        )}

        {card.blocked !== null && (
          <p className="text-xs text-muted-foreground">
            A newer release, <span className="font-mono">{card.blocked.version}</span>, needs more:{" "}
            {card.blocked.reasons.join("; ")}.
          </p>
        )}

        {card.lastFailure !== null && (
          <p className="text-xs text-amber-600 dark:text-amber-400">Last attempt: {card.lastFailure}</p>
        )}
      </div>

      {top && (
        <footer className="grid grid-cols-2 gap-1 border-t border-border p-2">
          <Button variant="ghost" size="sm" onClick={onChanges} disabled={card.compareUrl === null} title={card.compareUrl === null ? "Not a GitHub commit range" : undefined}>
            <Icon name="ExternalLink" aria-hidden /> Changes
          </Button>
          <Button variant="ghost" size="sm" onClick={onDetails}>
            <Icon name="Info" aria-hidden /> Details
          </Button>
        </footer>
      )}
    </article>
  );
}
