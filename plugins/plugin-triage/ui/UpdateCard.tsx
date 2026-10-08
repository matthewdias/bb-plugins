// One pending update as a card: which plugin, from which version to which,
// and anything that should give pause: a newer release bb won't take, or the
// last attempt failing. The top card opens its details as a New card does:
// the whole description, release notes and change list, scrolled in place.
import { useEffect, useRef } from "react";
import { Markdown, experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { COMMITS_SHOWN, type Changes } from "../lib/changes";
import type { UpdateCard as Card } from "../lib/updates-deck";
import { PluginIcon } from "./EntryCard";
import { haptic } from "./haptics";

export interface UpdateCardProps {
  card: Card;
  top: boolean;
  /** What the update changes; undefined while loading. Top card only. */
  changes?: Changes;
  /** Fetch the changes even though GitHub's limit is nearly spent. */
  onLoadChanges?: () => void;
  onChanges?: () => void;
  /** Its details are open. Top card only. */
  expanded?: boolean;
  onToggleDetails?: () => void;
  /** Opens the plugin in bb's detail pane. */
  onOpen?: () => void;
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

export function UpdateCard({
  card,
  top,
  changes,
  onLoadChanges,
  onChanges,
  expanded = false,
  onToggleDetails,
  onOpen,
}: UpdateCardProps) {
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (body.current !== null) body.current.scrollTop = 0;
  }, [expanded]);

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

      <div className="relative min-h-0 flex-1">
        <div
          ref={body}
          className={cn(
            "h-full space-y-4 px-4 pt-4",
            expanded
              ? "touch-pan-y overflow-y-auto overscroll-contain pb-4"
              : // As on a New card: what doesn't fit fades out, and a tap
                // anywhere on it, short of a control, opens the details.
                cn("overflow-hidden [mask-image:linear-gradient(to_bottom,black_70%,transparent)]", top && "cursor-pointer"),
          )}
          onClick={(event) => {
            if (!top || expanded || (event.target as HTMLElement).closest("button, a") !== null) return;
            haptic("selection");
            onToggleDetails?.();
          }}
          data-scroll={expanded ? "" : undefined}
          data-testid="card-body"
        >
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
            <p className={cn("text-sm leading-relaxed text-muted-foreground", expanded ? undefined : top ? "line-clamp-2" : "line-clamp-4")}>
              {card.description}
            </p>
          )}

          {top && <ChangeList changes={changes} expanded={expanded} onMore={onChanges} onLoad={onLoadChanges} />}

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
        {top && !expanded && (
          <span className="pointer-events-none absolute bottom-1.5 right-3 rounded-full border border-border bg-card px-2 py-0.5 text-[11px] font-medium text-muted-foreground shadow-sm">
            More
          </span>
        )}
      </div>

      {top && (
        <footer className="grid grid-cols-3 gap-1 border-t border-border p-2">
          <Button variant="ghost" size="sm" onClick={onToggleDetails} aria-pressed={expanded}>
            <Icon name="Info" aria-hidden /> {expanded ? "Less" : "Details"}
          </Button>
          <Button variant="ghost" size="sm" onClick={onChanges} disabled={card.compareUrl === null} title={card.compareUrl === null ? "Not a GitHub commit range" : undefined}>
            <Icon name="ExternalLink" aria-hidden /> Changes
          </Button>
          <Button variant="ghost" size="sm" onClick={onOpen} aria-label="Open in bb's plugin details">
            <Icon name="ArrowUpRight" aria-hidden /> Open
          </Button>
        </footer>
      )}
    </article>
  );
}

/**
 * The commits the update brings, or the release notes. Clamped until the
 * details open, so the closed card stays one surface to drag: the commits it
 * hides are a tap away, and GitHub has whatever the server didn't fetch.
 */
function ChangeList({
  changes,
  expanded,
  onMore,
  onLoad,
}: {
  changes: Changes | undefined;
  expanded: boolean;
  onMore?: () => void;
  onLoad?: () => void;
}) {
  if (changes === undefined) return <p className="text-xs text-muted-foreground">Loading changes…</p>;
  if (changes.kind === "none") return null;
  if (changes.kind === "unavailable") return <p className="text-xs text-muted-foreground">{changes.reason}</p>;
  if (changes.kind === "deferred") {
    const at = changes.resetAt === null ? null : new Date(changes.resetAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground" data-no-drag>
        <span className="min-w-0 flex-1">
          Saving GitHub's hourly limit: {changes.remaining} left{at === null ? "" : `, back at ${at}`}.
        </span>
        <Button variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={onLoad}>
          Load changes
        </Button>
      </div>
    );
  }

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

  const shown = expanded ? changes.commits : changes.commits.slice(0, COMMITS_SHOWN);
  const more = changes.total - shown.length;
  // Only the ones the server never had are worth leaving for.
  const onGitHub = shown.length === changes.commits.length;
  return (
    <section className="space-y-2" aria-label="Changes">
      <h3 className="text-xs font-medium text-muted-foreground">
        {changes.total === 1 ? "1 change" : `${changes.total} changes`}
        {changes.subdirectory !== null && changes.repoWide > changes.total && ` · ${changes.repoWide} in the repository`}
      </h3>
      {changes.releaseNotes !== null && (
        <div className={cn("text-xs [&_h1]:text-xs [&_h2]:text-xs [&_h3]:text-xs [&_p]:my-0", !expanded && "line-clamp-4")}>
          <Markdown content={changes.releaseNotes.body} />
        </div>
      )}
      <ul className="space-y-1">
        {shown.map((commit) => (
          <li key={commit.sha} className="flex gap-2 text-xs">
            <span className="shrink-0 font-mono text-muted-foreground">{commit.sha.slice(0, 7)}</span>
            <span className={cn("min-w-0", !expanded && "truncate")}>{commit.subject}</span>
          </li>
        ))}
      </ul>
      {more > 0 &&
        (onGitHub ? (
          <button type="button" onClick={onMore} className="text-xs text-muted-foreground underline-offset-2 hover:underline">
            and {more} more on GitHub
          </button>
        ) : (
          // Not a control: a tap falls through to the card and opens its details.
          <p className="text-xs text-muted-foreground">and {more} more</p>
        ))}
    </section>
  );
}
