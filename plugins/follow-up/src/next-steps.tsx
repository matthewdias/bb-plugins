// The Next row: what to do after the reply above it, one press each.
//
// Two sources, never mixed. When the agent offered steps (`offer_next_steps`),
// they are the row — they answer the reply directly above. When it offered
// none, the row offers the top of the follow-up list instead, as "Do". The list
// sits right below with its own buttons, so a "Do" chip beside three offers
// would be a fourth thing to read that says the same as a row you can see.
//
// A press sends at once: removing the typing is the whole point. ⌥-click, or a
// long press on touch, puts the step in the composer instead, so a step that
// is nearly right can be edited before it goes.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { useComposer, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "../server";
import type { FollowUp } from "../lib/followups.ts";
import { shortLabel, visibleText, type NextOffer } from "../lib/next-steps.ts";
import { setRows } from "./store.ts";
import { SEND_FAILED, setOffer, STALE_OFFER, takeStep } from "./use-next-steps.ts";
import { REFUSAL_DETAIL } from "./record-draft.ts";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";
import { cn } from "@/lib/utils";

/** How long a touch has to rest on a chip before it means "edit first". */
const LONG_PRESS_MS = 500;

/**
 * Press, or press-and-hold. A held touch fires `onHold` and swallows the click
 * that follows it, so holding to edit never also sends. Mouse and pen keep
 * their plain click; ⌥ is their way to the same place.
 */
function useHold(onHold: () => void) {
  const timer = useRef<number | null>(null);
  const held = useRef(false);
  const cancel = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);
  return {
    handlers: {
      onPointerDown: (event: PointerEvent) => {
        held.current = false;
        if (event.pointerType !== "touch") return;
        cancel();
        timer.current = window.setTimeout(() => {
          held.current = true;
          onHold();
        }, LONG_PRESS_MS);
      },
      onPointerUp: cancel,
      onPointerLeave: cancel,
      onPointerCancel: cancel,
      // The OS's own long-press menu would open on top of the composer.
      onContextMenu: (event: MouseEvent) => {
        if (held.current) event.preventDefault();
      },
    },
    /** True once, for the click a hold already answered. */
    consumeHeld: () => {
      const was = held.current;
      held.current = false;
      return was;
    },
  };
}

function Chip({
  label,
  hint,
  ariaLabel,
  emphasis,
  disabled,
  onSend,
  onEdit,
  onHover,
}: {
  /**
   * Drawn whole, never truncated by CSS. An agent's step is sent word for word
   * as the user's message, so all of it has to be on screen — a cut-off button
   * would send words nobody saw. A label that does stand for something longer
   * (Do's) is cut before it gets here, and says so with "…". The row scrolls
   * sideways instead.
   */
  label: ReactNode;
  /** Hover text. Desktop only: a phone has no hover. */
  hint: string | null;
  ariaLabel: string;
  emphasis: boolean;
  disabled: boolean;
  onSend: () => void;
  onEdit: () => void;
  /** Pointer or focus arriving (true) and leaving (false). */
  onHover?: (on: boolean) => void;
}) {
  const hold = useHold(onEdit);
  return (
    <span
      title={hint ?? undefined}
      className="inline-flex min-w-0 shrink-0"
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
    >
      <Button
        variant={emphasis ? "secondary" : "ghost"}
        size="sm"
        className="h-7 gap-1.5 px-2 text-xs"
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onFocus={() => onHover?.(true)}
        onBlur={() => onHover?.(false)}
        {...hold.handlers}
        onClick={(event) => {
          if (hold.consumeHeld()) return;
          if (event.altKey) onEdit();
          else onSend();
        }}
        aria-label={ariaLabel}
      >
        <span>{label}</span>
      </Button>
    </span>
  );
}

export function NextSteps({
  threadId,
  offer,
  candidate,
  onInsertRow,
  onHighlightCandidate,
}: {
  threadId: string;
  offer: NextOffer | null;
  /** The top follow-up, offered as "Do" when the agent offered nothing. */
  candidate: FollowUp | null;
  /** The list's own "put in composer", for editing a "Do" before sending. */
  onInsertRow: (row: FollowUp) => void;
  /**
   * The "Do" chip is being pointed at or focused, so the list can mark the row
   * it stands for — the chip shows the row's start, the list shows all of it.
   */
  onHighlightCandidate?: (on: boolean) => void;
}) {
  const composer = useComposer();
  const rpc = useRpc<typeof rpcContract>();
  const isCompact = useIsCompactViewport();
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState(false);

  // A queued note belongs to the press that caused it, not to whatever the row
  // shows next.
  const offeredAt = offer?.offeredAt ?? null;
  useEffect(() => setQueued(false), [offeredAt, candidate?.id]);

  const steps = offer?.steps ?? [];
  const showDo = steps.length === 0 && candidate !== null;

  const edit = useCallback(
    (text: string) => {
      composer.insert(text, { at: "end", block: true });
      composer.focus();
    },
    [composer],
  );

  const take = useCallback(
    async (index: number) => {
      if (offer === null) return;
      setBusy(true);
      try {
        setQueued((await takeStep(rpc, threadId, offer, index)) === "queued");
      } finally {
        setBusy(false);
      }
    },
    [offer, rpc, threadId],
  );

  const keep = useCallback(
    async (index: number) => {
      if (offer === null) return;
      setBusy(true);
      try {
        const result = await rpc.call("followups_next_keep", {
          threadId,
          offeredAt: offer.offeredAt,
          index,
        });
        setOffer(threadId, result.offer);
        setRows(threadId, result.followUps, result.done);
        if (result.outcome === "stale") toast.error(STALE_OFFER);
        else if (result.outcome !== "added") toast.error(REFUSAL_DETAIL[result.outcome]);
      } catch {
        toast.error(REFUSAL_DETAIL.failed);
      } finally {
        setBusy(false);
      }
    },
    [offer, rpc, threadId],
  );

  const clear = useCallback(async () => {
    setBusy(true);
    try {
      await rpc.call("followups_next_clear", { threadId });
      setOffer(threadId, null);
    } catch {
      // Leave it showing; a failed clear is not worth an error for a row the
      // next turn will clear anyway.
    } finally {
      setBusy(false);
    }
  }, [rpc, threadId]);

  const doRow = useCallback(
    async (row: FollowUp) => {
      setBusy(true);
      try {
        const result = await rpc.call("followups_next_do", { threadId, id: row.id });
        if (result.outcome === "queued") setQueued(true);
        else if (result.outcome === "gone") toast.error("That follow-up is no longer open.");
        else if (result.outcome === "failed") toast.error(SEND_FAILED);
      } catch {
        toast.error(SEND_FAILED);
      } finally {
        setBusy(false);
      }
    },
    [rpc, threadId],
  );

  // Hover text, so desktop only: a phone has no hover, and holds to edit.
  const hint = isCompact ? null : "⌥-click to edit it in the composer first.";

  return (
    <div className="flex min-w-0 items-center gap-1">
      {/* Scrolls rather than wraps: a second line of chips pushes the
          composer down by a row on every turn that offers three. */}
      <div
        role="group"
        aria-label="Next steps"
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overscroll-x-contain [scrollbar-width:none]"
      >
        <span className="shrink-0 px-1 text-xs font-medium text-foreground">Next</span>
        {steps.map((step, index) => (
          <Chip
            key={`${offer?.offeredAt}-${step}`}
            label={step}
            hint={hint}
            ariaLabel={`Send "${step}"`}
            emphasis={index === 0}
            disabled={busy}
            onSend={() => void take(index)}
            onEdit={() => edit(step)}
          />
        ))}
        {showDo && candidate !== null && (
          <Chip
            label={
              <>
                <span className="text-muted-foreground">Do:</span>{" "}
                {shortLabel(candidate.text)}
              </>
            }
            // The whole row, since the label is usually only its start. A
            // phone has no hover, but it has the row itself, right below.
            hint={
              isCompact
                ? null
                : `${visibleText(candidate.text)}\n\nSends this follow-up to the agent now. ⌥-click to put it in the composer first.`
            }
            ariaLabel={`Do "${candidate.text}" now`}
            emphasis
            disabled={busy}
            onSend={() => void doRow(candidate)}
            onEdit={() => onInsertRow(candidate)}
            onHover={onHighlightCandidate}
          />
        )}
        {queued && (
          <span className="shrink-0 text-[11px] text-muted-foreground">
            Queued behind the current turn.
          </span>
        )}
      </div>
      {steps.length > 0 && (
        <DropdownMenu modal={false}>
          <span title="More" className="inline-flex shrink-0">
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 text-muted-foreground"
                disabled={busy}
                onMouseDown={(event) => event.preventDefault()}
                aria-label="More next-step actions"
              >
                <Icon name="MoreHorizontal" className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
          </span>
          <DropdownMenuContent align="end">
            {steps.map((step, index) => (
              <DropdownMenuItem
                key={`keep-${step}`}
                onSelect={() => void keep(index)}
                aria-label={`Keep "${step}" as a follow-up`}
              >
                <Icon name="ListTodo" className="size-3.5" aria-hidden />
                <span className="max-w-[16rem] truncate">Keep &ldquo;{step}&rdquo; for later</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void clear()} aria-label="Clear these next steps">
              <Icon name="CircleX" className="size-3.5" aria-hidden />
              Clear these
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
