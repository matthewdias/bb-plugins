// The one tap that stands between an agent and your tracker.
//
// An agent's file_follow_ups waits on this before anything is filed, unless
// the user switched the question off. Filing writes outside bb — an issue it
// opens cannot be closed from here — and an agent steered by something it
// read could otherwise file things nobody asked for. So the card names where
// the rows are going and lists them, and either button settles it.
import { useState } from "react";
import type { PluginPendingInteractionProps } from "@get-bb/plugin-sdk/app";
import { confirmFilingPayloadSchema } from "../lib/destinations.ts";
import { Button } from "@/components/ui/button";

export function ConfirmFiling({ interaction, submit }: PluginPendingInteractionProps) {
  const [busy, setBusy] = useState(false);
  const parsed = confirmFilingPayloadSchema.safeParse(interaction.payload);
  const answer = async (file: boolean) => {
    setBusy(true);
    try {
      await submit({ file });
    } finally {
      setBusy(false);
    }
  };

  // A payload this build cannot read is declined rather than guessed at.
  if (!parsed.success) {
    return (
      <div className="flex flex-col gap-2 p-3 text-sm">
        <p>An agent asked to file follow-ups, but the request could not be read.</p>
        <div>
          <Button variant="secondary" size="sm" className="h-7 px-2 text-xs" disabled={busy} onClick={() => void answer(false)}>
            Don&rsquo;t file
          </Button>
        </div>
      </div>
    );
  }

  const { destination, kind, rows } = parsed.data;
  return (
    <div className="flex flex-col gap-2 p-3 text-sm">
      <p>
        The agent wants to file {rows.length === 1 ? "this follow-up" : `these ${rows.length} follow-ups`} to{" "}
        <b>{destination}</b>
        {kind === "agent" ? ", by a helper following your recipe" : ""}. Filed follow-ups leave
        this thread&rsquo;s list and are tracked there.
      </p>
      <ul className="flex max-h-40 flex-col gap-0.5 overflow-y-auto pl-4 text-xs text-muted-foreground">
        {rows.map((row) => (
          <li key={row.id} className="list-disc break-words">
            {row.text}
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-1.5">
        <Button
          variant="default"
          size="sm"
          className="h-7 px-3 text-xs"
          disabled={busy}
          onClick={() => void answer(true)}
        >
          File {rows.length === 1 ? "it" : `all ${rows.length}`}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={busy}
          onClick={() => void answer(false)}
        >
          Don&rsquo;t file
        </Button>
      </div>
    </div>
  );
}
