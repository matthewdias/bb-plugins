// Focus: the threads that need you, one at a time.
//
// It deals the page's blocked and your-turn cards, in the page's order, and
// stays live: a card answered anywhere leaves, and a new ask joins. Keys and
// taps answer (deck-keys.tsx hands 1–9 and Enter to the card's question or
// next steps); a key or a swipe otherwise only moves through the deck (skip,
// back, put away) and never answers. Approvals, merges and wrap-ups are click
// only. The swipes and haptics are Plugin Triage's, vendored.
import { useEffect, useMemo, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "../../server";
import type { Card } from "../../lib/page.ts";
import { armed, leaning, progress, release, type Direction } from "../../lib/gesture.ts";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { bringBack, Kbd, PageCard, putAwayCard } from "./cards.tsx";
import { DeckKeysProvider, useDeckKeySlot } from "./deck-keys.tsx";
import { haptic } from "./haptics.ts";
import type { PageSnapshot } from "./use-page.ts";

/** Focus's address under the page, so Back leaves it. */
export const FOCUS_SUBPATH = "focus";

/** How long a swiped card takes to leave. */
const FLY_MS = 200;

/** How far a press travels before it is a drag rather than a tap. */
const SLOP = 6;

type Undo =
  | { kind: "skip"; threadId: string; index: number }
  | { kind: "away"; threadId: string; threadIds: string[]; index: number };

/** Where the deck is: the card shown, and its place, kept for when that card leaves. */
interface At {
  id: string | null;
  index: number;
  /** Brought back with Undo and not yet back in the deck: keep it shown meanwhile. */
  returning?: boolean;
}

interface Drag {
  pointerId: number;
  startX: number;
  startY: number;
  dx: number;
  dy: number;
  lastX: number;
  lastT: number;
  velocity: number;
  moving: boolean;
}

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/** Keys meant for a field are the field's. */
function typingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/** What a card showed when it was put away: its own attention, its family's, its PR's state. */
function awayMark(card: Card): string {
  return `${card.attentionAt}:${card.since}:${card.prKey ?? ""}`;
}

function withoutKey<V>(map: ReadonlyMap<string, V>, key: string): Map<string, V> {
  const next = new Map(map);
  next.delete(key);
  return next;
}

/** Focus swipes only left (skip) and up (put away); right is not a move. */
function deckMove(direction: Direction | null): "left" | "up" | null {
  return direction === "left" || direction === "up" ? direction : null;
}

export function Focus({
  snapshot,
  now,
  onLeave,
}: {
  snapshot: PageSnapshot;
  now: number;
  onLeave: () => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  // Put away here, out of the deck at once rather than at the next snapshot:
  // each with the mark it was put away at. As on the server, the card stays
  // out only while it still shows that mark, so something new on its thread
  // brings it straight back, whenever the snapshot catches up.
  const [away, setAway] = useState<ReadonlyMap<string, string>>(new Map());
  const deck = useMemo(
    () => snapshot.cards.filter((card) => card.tier !== "finished" && away.get(card.threadId) !== awayMark(card)),
    [snapshot.cards, away],
  );
  const names = useMemo(() => new Map(snapshot.projects.map((project) => [project.id, project.name])), [snapshot.projects]);
  const [at, setAt] = useState<At>({ id: null, index: 0 });
  const [undos, setUndos] = useState<Undo[]>([]);
  const slot = useDeckKeySlot();

  const found = at.id === null ? -1 : deck.findIndex((card) => card.threadId === at.id);
  // The shown card left (answered, here or anywhere): the one after it has
  // taken its place, or the pass is over.
  const index = found !== -1 ? found : Math.min(at.index, deck.length);
  const returning =
    at.returning === true && found === -1 ? (snapshot.putAway.find((card) => card.threadId === at.id) ?? null) : null;
  const top: Card | null = returning ?? deck[index] ?? null;
  const next = returning === null ? (deck[index + 1] ?? null) : (deck[index] ?? null);

  useEffect(() => {
    if (returning !== null) return;
    const id = top?.threadId ?? null;
    if (id !== at.id || index !== at.index || at.returning === true) setAt({ id, index });
  }, [returning, top?.threadId, index, at.id, at.index, at.returning]);

  // Forget a mark once the server has the card put away, out of the
  // snapshot: brought back from the page's fold, it may return showing the
  // same mark, and then it belongs in the deck.
  useEffect(() => {
    if (away.size === 0) return;
    const present = new Set(snapshot.cards.map((card) => card.threadId));
    const kept = [...away].filter(([id]) => present.has(id));
    if (kept.length !== away.size) setAway(new Map(kept));
  }, [snapshot.cards, away]);

  const move = (to: number) => setAt({ id: deck[to]?.threadId ?? null, index: Math.max(0, Math.min(to, deck.length)) });

  const skip = () => {
    if (top === null || returning !== null) return;
    setUndos((list) => [...list, { kind: "skip", threadId: top.threadId, index }]);
    move(index + 1);
  };

  const back = () => {
    if (index > 0 && returning === null) move(index - 1);
  };

  const putAway = async () => {
    if (top === null || returning !== null) return;
    if (top.tier === "blocked") {
      haptic("warning");
      toast("A blocked thread waits on its answer. Skip it instead.");
      return;
    }
    const card = top;
    const entry: Undo = {
      kind: "away",
      threadId: card.threadId,
      threadIds: [card.threadId, ...card.workers.map((worker) => worker.threadId)],
      index,
    };
    setAway((previous) => new Map([...previous, [card.threadId, awayMark(card)]]));
    setUndos((list) => [...list, entry]);
    setAt({ id: deck[index + 1]?.threadId ?? null, index });
    try {
      await putAwayCard(rpc, card);
      // The toast's Undo is for this card, which may not be the last thing done.
      toast("Put away until something new happens.", { action: { label: "Undo", onClick: () => undoEntry(entry) } });
    } catch {
      setAway((previous) => withoutKey(previous, card.threadId));
      setUndos((list) => list.filter((candidate) => candidate !== entry));
      toast.error("It could not be put away. Try again.");
    }
  };

  const restore = (entry: Undo) => {
    if (entry.kind === "skip") {
      setAt({ id: entry.threadId, index: entry.index });
      return;
    }
    setAway((previous) => withoutKey(previous, entry.threadId));
    setAt({ id: entry.threadId, index: entry.index, returning: true });
    void bringBack(rpc, entry.threadIds);
  };

  const undoEntry = (entry: Undo) => {
    setUndos((list) => list.filter((candidate) => candidate !== entry));
    restore(entry);
  };

  const undo = () => {
    const last = undos.at(-1);
    if (last !== undefined) undoEntry(last);
  };

  // Keys. Re-bound each render, so they always act on the card shown.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || typingTarget(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key;
      if (/^[1-9]$/.test(key)) {
        slot.current?.handler.pick(Number(key));
      } else if (key === "Enter") {
        // Enter on a focused button or link is that control's.
        if (event.target instanceof HTMLButtonElement || event.target instanceof HTMLAnchorElement) return;
        slot.current?.handler.send();
      } else if (key === "j" || key === "J" || key === "ArrowRight") skip();
      else if (key === "k" || key === "K" || key === "ArrowLeft") back();
      else if (key === "s" || key === "S" || key === "ArrowUp") void putAway();
      else if (key === "z" || key === "Z") undo();
      else if (key === "Escape") {
        // An open menu or dialog takes Escape first.
        if (document.querySelector('[role="menu"], [role="dialog"]') !== null) return;
        onLeave();
      } else return;
      event.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // --- swipes ---------------------------------------------------------------

  const scroller = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [flying, setFlying] = useState<"left" | "up" | null>(null);
  const arming = useRef<"left" | "up" | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);

  // A card taller than the screen scrolls, and then up means scroll, not
  // put away: only a sideways drag moves the card.
  const scrolls = () => {
    const element = scroller.current;
    return element !== null && element.scrollHeight > element.clientHeight + 1;
  };

  const decide = (direction: "left" | "up") => {
    setDrag(null);
    arming.current = null;
    if (direction === "up" && top?.tier === "blocked") {
      void putAway();
      return;
    }
    haptic("impact-light");
    const act = direction === "left" ? skip : () => void putAway();
    if (reducedMotion()) {
      act();
      return;
    }
    setFlying(direction);
    timer.current = setTimeout(() => {
      timer.current = null;
      setFlying(null);
      act();
    }, FLY_MS);
  };

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    // A phone's gesture. A mouse drags to select text, and has the keys.
    if (event.pointerType === "mouse" || event.button !== 0 || flying !== null || top === null) return;
    // Controls keep their clicks; text keeps its selection.
    if ((event.target as HTMLElement).closest("a, button, input, textarea, select, [role=menu], pre, code")) return;
    arming.current = null;
    setDrag({
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      dx: 0,
      dy: 0,
      lastX: event.clientX,
      lastT: event.timeStamp,
      velocity: 0,
      moving: false,
    });
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (drag === null || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = scrolls() ? 0 : event.clientY - drag.startY;
    let moving = drag.moving;
    if (!moving) {
      if (Math.hypot(dx, event.clientY - drag.startY) < SLOP) return;
      // Setting off up or down a card that scrolls is a scroll: let it go.
      if (scrolls() && Math.abs(event.clientY - drag.startY) > Math.abs(dx)) {
        setDrag(null);
        return;
      }
      event.currentTarget.setPointerCapture?.(event.pointerId);
      moving = true;
    }
    // A tick as the card crosses into a move, and again if it swings to the other.
    const now = deckMove(armed(dx, dy));
    if (now !== arming.current) {
      if (now !== null) haptic("selection");
      arming.current = now;
    }
    const dt = Math.max(1, event.timeStamp - drag.lastT);
    setDrag({ ...drag, dx, dy, lastX: event.clientX, lastT: event.timeStamp, velocity: Math.abs(event.clientX - drag.lastX) / dt, moving });
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (drag === null || event.pointerId !== drag.pointerId) return;
    const decided = deckMove(release(drag.dx, drag.dy, drag.velocity));
    if (decided === null) setDrag(null);
    else decide(decided);
  }

  let transform = "";
  let transition = "transform 180ms ease-out";
  let lean: "left" | "up" | null = null;
  let amount = 0;
  if (flying !== null) {
    transform = flying === "left" ? "translate(-140%, 0) rotate(-12deg)" : "translate(0, -120%)";
    transition = `transform ${FLY_MS}ms ease-in, opacity ${FLY_MS}ms ease-in`;
    lean = flying;
    amount = 1;
  } else if (drag !== null && drag.moving) {
    transform = `translate(${Math.min(drag.dx, 24)}px, ${Math.min(drag.dy, 0)}px) rotate(${Math.min(drag.dx, 24) / 24}deg)`;
    transition = "none";
    lean = deckMove(leaning(drag.dx, drag.dy));
    amount = lean === null ? 0 : progress(drag.dx, drag.dy);
  }

  const skipped = undos.filter((entry) => entry.kind === "skip").length;
  const position = top === null ? null : returning !== null ? "back" : `${index + 1} of ${deck.length}`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2 sm:px-6">
        <Button variant="ghost" size="sm" className="-ml-1 text-muted-foreground" onClick={onLeave}>
          <Icon name="ChevronLeft" aria-hidden />
          All of them
        </Button>
        <span className="text-sm font-medium text-foreground">Focus</span>
        {position !== null && <span className="text-xs tabular-nums text-muted-foreground">{position}</span>}
      </header>
      <div ref={scroller} data-scroll="focus" className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 px-3 py-4 sm:px-6">
          {top === null ? (
            <PassOver
              waiting={deck.length}
              skipped={skipped}
              onRestart={() => {
                setUndos([]);
                move(0);
              }}
              onLeave={onLeave}
            />
          ) : (
            // bb opens its sidebar on a rightward swipe and its side panel on
            // a leftward one, from anywhere on a phone; both skip a touch that
            // starts inside these markers, so the card keeps its drags.
            <div
              className={cn("relative", scrolls() ? "touch-pan-y" : "touch-none")}
              style={{ transform, transition, opacity: flying !== null ? 0 : 1 }}
              data-no-sidebar-swipe=""
              data-no-secondary-panel-swipe=""
              data-testid="focus-card"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={() => setDrag(null)}
            >
              <DeckKeysProvider slot={slot}>
                <PageCard
                  key={top.threadId}
                  card={top}
                  projectName={names.get(top.projectId) ?? null}
                  now={now}
                  onHide={() => void putAway()}
                />
              </DeckKeysProvider>
              {lean !== null && (
                <span
                  className={cn(
                    "pointer-events-none absolute rounded-md border-2 bg-card/90 px-3 py-1 text-base font-bold uppercase tracking-wide",
                    lean === "left" ? "right-4 top-4 rotate-6 border-muted-foreground text-muted-foreground" : "left-1/2 top-4 -translate-x-1/2 border-sky-500 text-sky-500",
                  )}
                  style={{ opacity: amount }}
                >
                  {lean === "left" ? "Skip" : top.tier === "blocked" ? "Can't put away" : "Put away"}
                </span>
              )}
            </div>
          )}
          {next !== null && top !== null && (
            <p className="truncate text-xs text-muted-foreground">
              Next: <span className="text-foreground">{next.title}</span>
            </p>
          )}
        </div>
      </div>
      <div
        role="toolbar"
        aria-label="Move through Focus"
        className="flex shrink-0 items-center justify-center gap-1.5 border-t border-border px-3 py-2"
      >
        <Button variant="ghost" size="icon" className="size-9 text-muted-foreground" onClick={undo} disabled={undos.length === 0} aria-label="Undo (Z)">
          <Icon name="RotateCcw" aria-hidden />
        </Button>
        <Button variant="outline" size="sm" onClick={back} disabled={index === 0 || returning !== null} aria-label="Back (K)">
          <Icon name="ChevronLeft" aria-hidden />
          Back
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void putAway()}
          disabled={top === null || top.tier === "blocked" || returning !== null}
          aria-label="Put away (S)"
        >
          <Icon name="EyeOff" aria-hidden />
          Not now
        </Button>
        <Button variant="outline" size="sm" onClick={skip} disabled={top === null || returning !== null} aria-label="Skip (J)">
          Skip
          <Icon name="ChevronRight" aria-hidden />
        </Button>
      </div>
      {/* Keys mean nothing on a touchscreen. */}
      <p className="hidden shrink-0 flex-wrap justify-center gap-x-3 gap-y-1 pb-2 text-[11px] text-muted-foreground [@media(hover:hover)_and_(pointer:fine)]:flex">
        <span><Kbd>1–9</Kbd>pick</span>
        <span><Kbd>⏎</Kbd>send</span>
        <span><Kbd>J</Kbd>skip</span>
        <span><Kbd>K</Kbd>back</span>
        <span><Kbd>S</Kbd>not now</span>
        <span><Kbd>Z</Kbd>undo</span>
        <span><Kbd>Esc</Kbd>leave</span>
        <span>Approvals, merges and wrap-ups are click only.</span>
      </p>
    </div>
  );
}

function PassOver({
  waiting,
  skipped,
  onRestart,
  onLeave,
}: {
  waiting: number;
  skipped: number;
  onRestart: () => void;
  onLeave: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
      {waiting === 0 ? (
        <p className="font-medium text-foreground">Nothing needs you.</p>
      ) : (
        <p>
          <span className="font-medium text-foreground">That's all of them.</span>{" "}
          {skipped > 0 ? `${waiting} still waiting, ${skipped} skipped.` : `${waiting} still waiting.`}
        </p>
      )}
      <div className="flex gap-2">
        {waiting > 0 && (
          <Button size="sm" onClick={onRestart}>
            Start over
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={onLeave}>
          Back to the page
        </Button>
      </div>
    </div>
  );
}
