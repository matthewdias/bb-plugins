// One pending update as a card: which plugin, from which version to which,
// and anything that should give pause: a newer release bb won't take, or the
// last attempt failing.
import { Markdown, experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Changes } from "../lib/changes";
import type { UpdateCard as Card } from "../lib/updates-deck";
import { PluginIcon } from "./EntryCard";

export interface UpdateCardProps {
  card: Card;
  top: boolean;
  /** What the update changes; undefined while loading. Top card only. */
  changes?: Changes;
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

export function UpdateCard({ card, top, changes, onChanges, onDetails }: UpdateCardProps) {
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
          <p className={cn("text-sm leading-relaxed text-muted-foreground", top ? "line-clamp-2" : "line-clamp-4")}>
            {card.description}
          </p>
        )}

        {top && <ChangeList changes={changes} onMore={onChanges} />}

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

/**
 * The commits the update brings, or the release notes. Clamped rather than
 * scrolled: the card stays one surface to drag, and GitHub has the rest.
 */
function ChangeList({ changes, onMore }: { changes: Changes | undefined; onMore?: () => void }) {
  if (changes === undefined) return <p className="text-xs text-muted-foreground">Loading changes…</p>;
  if (changes.kind === "none") return null;
  if (changes.kind === "unavailable") return <p className="text-xs text-muted-foreground">{changes.reason}</p>;

  if (changes.subdirectory !== null && changes.total === 0) {
    return (
      <p className="rounded-lg border border-border bg-muted/40 p-3 text-xs" data-testid="no-changes">
        <span className="font-medium">No changes to this plugin.</span>{" "}
        {changes.repoWide === 1
          ? "The one commit in its repository changed something else."
          : `The ${changes.repoWide} commits in its repository changed other things.`}
      </p>
    );
  }

  const more = changes.total - changes.commits.length;
  return (
    <section className="space-y-2" aria-label="Changes">
      <h3 className="text-xs font-medium text-muted-foreground">
        {changes.total === 1 ? "1 change" : `${changes.total} changes`}
        {changes.subdirectory !== null && changes.repoWide > changes.total && ` · ${changes.repoWide} in the repository`}
      </h3>
      {changes.releaseNotes !== null && (
        <div className="line-clamp-4 text-xs [&_h1]:text-xs [&_h2]:text-xs [&_h3]:text-xs [&_p]:my-0">
          <Markdown content={changes.releaseNotes.body} />
        </div>
      )}
      <ul className="space-y-1">
        {changes.commits.map((commit) => (
          <li key={commit.sha} className="flex gap-2 text-xs">
            <span className="shrink-0 font-mono text-muted-foreground">{commit.sha.slice(0, 7)}</span>
            <span className="min-w-0 truncate">{commit.subject}</span>
          </li>
        ))}
      </ul>
      {more > 0 && (
        <button type="button" onClick={onMore} className="text-xs text-muted-foreground underline-offset-2 hover:underline">
          and {more} more on GitHub
        </button>
      )}
    </section>
  );
}
