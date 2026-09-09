// "Put this in the composer", for surfaces that are not the composer.
//
// The banner lives inside a composer slot, so it can call useComposer freely.
// The side panel is a thread panel slot, and neither the SDK types nor any
// installed plugin establishes whether a composer is resolvable there — the
// types describe which composer useComposer writes to, not which slots may ask.
//
// So the hook call is isolated in a child behind an error boundary: if a panel
// has no composer, the action quietly does not appear instead of taking the
// panel down with it.
import { Component, type ReactNode } from "react";
import { useComposer, useComposerView } from "@get-bb/plugin-sdk/app";
import { pillLabel } from "./banner.tsx";
import type { FollowUp } from "../lib/followups.ts";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

class HideOnError extends Component<{ children: ReactNode }, { failed: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

function InsertButton({
  row,
  threadId,
  onInserted,
}: {
  row: FollowUp;
  threadId: string;
  /** Runs only after a successful insert, so the caller can move the row. */
  onInserted?: () => void;
}) {
  const composer = useComposer();
  const view = useComposerView();
  const inserted = view.draft.text.includes(pillLabel(row.text));

  return (
    <span
      title={
        inserted
          ? "Already in the composer — send to hand it to the agent"
          : "Put this in the composer"
      }
      className="inline-flex"
    >
      <Button
        variant="ghost"
        size="icon"
        className="size-6 shrink-0 text-muted-foreground"
        disabled={inserted}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          composer.insertMention({
            provider: "follow-up",
            id: `${threadId}.${row.id}`,
            label: pillLabel(row.text),
          });
          composer.focus();
          onInserted?.();
        }}
        aria-label={
          inserted
            ? `"${row.text}" is already in the composer`
            : `Put "${row.text}" in the composer`
        }
      >
        <Icon name="MessageSquarePlus" className="size-3.5" />
      </Button>
    </span>
  );
}

/**
 * "This row is in the composer right now" — the banner's `EditFile` glyph, for
 * the panel.
 *
 * It has to sit behind the same boundary as the button rather than the panel
 * reading the draft once and passing it down: the whole reason that boundary
 * exists is that a panel is not guaranteed a composer, and lifting the hook out
 * would trade a missing glyph for a dead panel.
 */
function InsertedMark({ row }: { row: FollowUp }) {
  const view = useComposerView();
  if (!view.draft.text.includes(pillLabel(row.text))) return null;
  return (
    <span title="In the composer" className="mt-1 inline-flex shrink-0 text-foreground">
      <span className="sr-only">In the composer</span>
      <Icon name="EditFile" className="size-3" aria-hidden />
    </span>
  );
}

export function ComposerInsertedMark({ row }: { row: FollowUp }) {
  return (
    <HideOnError>
      <InsertedMark row={row} />
    </HideOnError>
  );
}

export function ComposerInsert({
  row,
  threadId,
  onInserted,
}: {
  row: FollowUp;
  threadId: string;
  onInserted?: () => void;
}) {
  return (
    <HideOnError>
      <InsertButton row={row} threadId={threadId} onInserted={onInserted} />
    </HideOnError>
  );
}
