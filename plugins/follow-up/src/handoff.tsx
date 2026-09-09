// Send a row somewhere else.
//
// This used to be a hand-rolled picker in a 320px popover: a filter input, a
// skills list fetched on every open, and per-project recents to order it. All of
// that is gone. bb's own composer has a `/` menu over the same skills with
// better matching than ours — scored exact/prefix tiers, namespace-suffix
// matching so `foo:bar` matches on `bar`, argument hints, a Skills heading — so
// the picker was a worse reimplementation of a host surface, and the recents
// existed only to prop it up. What is left is one button that opens the
// compose view.
//
// The two destinations still exist; they moved into that view, beside the
// draft, because "does this thread still own the work" is a decision about what
// you have just written rather than a mode to set before writing it.
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeftRightIcon } from "@hugeicons/core-free-icons";
import type { FollowUp } from "../lib/followups.ts";
import { Button } from "@/components/ui/button";
import { dismissKeyboard } from "./keyboard.ts";

/** The panel tab the compose view renders in. */
export const HANDOFF_PANEL_ACTION = "handoff";

export function HandoffAction({ row }: { row: FollowUp }) {
  const navigate = useBbNavigate();

  return (
    <span title="Hand off — compose it in a new thread" className="inline-flex">
      <Button
        variant="ghost"
        size="icon"
        className="size-6 shrink-0 text-muted-foreground"
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          event.stopPropagation();
          // The panel takes the screen; the keyboard should not fight it.
          dismissKeyboard();
          navigate.openThreadPanel({
            actionId: HANDOFF_PANEL_ACTION,
            params: { id: row.id },
          });
        }}
        aria-label={`Hand off "${row.text}" in a new thread`}
      >
        {/* Rendered straight from the icon package rather than through `Icon`.
            bb's vendored registry does not carry ArrowLeftRight, and adding it
            there meant editing two files pulled from the @bb shadcn registry —
            a re-sync would drop the entry silently and the button would fall
            back to the generic plugin glyph with no error. Both hugeicons
            packages are direct dependencies of this plugin, and `Icon` is itself
            a thin wrapper over `HugeiconsIcon`, so this is the same render with
            one fewer thing to keep in step. */}
        <HugeiconsIcon icon={ArrowLeftRightIcon} className="size-3.5" />
      </Button>
    </span>
  );
}
