// Where a filed row went, for every list that shows Done.
//
// One component for the banner and the panel, so the two cannot come to say
// different things about the same row. A filed row is tracked somewhere else,
// so the link back to it is the point: a URL opens through bb's own link
// handling, and anything else (a key like ENG-1482) is shown as it was given.
import { UrlLink } from "@get-bb/plugin-sdk/app";
import type { FollowUp } from "../lib/followups.ts";

/** A ref that is a web address, which can be opened rather than just read. */
export function linkableRef(ref: string | null | undefined): string | null {
  if (ref === null || ref === undefined) return null;
  return /^https?:\/\/\S+$/.test(ref) ? ref : null;
}

/** The last path segment of a URL, which is usually the part worth reading. */
function shortRef(ref: string): string {
  const url = linkableRef(ref);
  if (url === null) return ref;
  const tail = url.replace(/\/+$/, "").split("/").pop() ?? url;
  return tail === "" ? url : tail;
}

export function FiledBadge({ row }: { row: FollowUp }) {
  if (row.filedTo === null || row.filedTo === undefined) return null;
  const ref = row.filedRef ?? null;
  const url = linkableRef(ref);
  return (
    <span className="inline-flex min-w-0 shrink-0 items-baseline gap-1 text-[11px] text-muted-foreground">
      <span>→ {row.filedTo.name}</span>
      {ref !== null &&
        (url !== null ? (
          <UrlLink
            href={url}
            className="underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground"
            aria-label={`Open ${row.filedTo.name}: ${url}`}
          >
            {shortRef(url)}
          </UrlLink>
        ) : (
          <span className="font-mono">{ref}</span>
        ))}
    </span>
  );
}
