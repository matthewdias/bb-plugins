// One card per thread on the Follow Up page, answered where it is.
//
// The card's lead ask (lib/page.ts) decides what it leads with; whatever else
// the thread holds rides along underneath — a pull request under an offer, the
// agent's steps under a wrap-up — so nothing about the thread is a second
// card to find.
//
// Every message a card sends is shown before it goes. A next step sends its
// own words, as its chip does in the thread; a pull request's prefilled ask
// and a review thread's prompt open in a box you can edit, and the box's text
// is exactly what is sent.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useBbNavigate, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "../../server";
import {
  MERGE_METHODS,
  prFixMessage,
  prMergedMessage,
  prRebaseMessage,
  reviewPrompt,
  type Card,
  type MergeMethod,
  type PendingAsk,
  type PrSummary,
  type Question,
} from "../../lib/page.ts";
import { REFUSAL_DETAIL } from "../record-draft.ts";
import { Chip } from "../next-steps.tsx";
import { SEND_FAILED, takeStep } from "../use-next-steps.ts";
import { WrapUp } from "../wrap-up.tsx";
import { setRows } from "../store.ts";
import { isChangeSignal } from "../use-follow-ups.ts";
import type { FollowUpRpc } from "../rpc.ts";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

type Rpc = FollowUpRpc;

const LEAD: Record<Card["lead"], { label: string; icon: IconName }> = {
  question: { label: "Question", icon: "MessageQuestion" },
  approval: { label: "Approval", icon: "SecurityCheck" },
  form: { label: "Form", icon: "ListTodo" },
  stopped: { label: "Stopped", icon: "AlertTriangle" },
  "wrap-up": { label: "Wrap up", icon: "Archive" },
  next: { label: "Next", icon: "ArrowRight" },
  page: { label: "Page", icon: "Browser" },
  pr: { label: "PR", icon: "GitPullRequest" },
  finished: { label: "Finished", icon: "Check" },
};

/** "2m", "3h", "4d": how long ago, short enough for a card's corner. */
export function ago(since: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - since) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function accent(card: Card): string {
  if (card.lead === "stopped") return "border-l-destructive";
  if (card.tier === "blocked") return "border-l-amber-500";
  if (card.tier === "turn") return "border-l-sky-500";
  return "border-l-border";
}

export function PageCard({
  card,
  projectName,
  now,
}: {
  card: Card;
  projectName: string | null;
  now: number;
}) {
  const navigate = useBbNavigate();
  const rpc = useRpc<typeof rpcContract>();
  const lead = LEAD[card.lead];
  const age = ago(card.since, now);
  const when =
    card.tier === "blocked"
      ? age === "now" ? "just asked" : `waiting ${age}`
      : age === "now" ? "just now" : `${age} ago`;

  const hide = async () => {
    try {
      await rpc.call("page_hide", { threadId: card.threadId, at: card.since });
    } catch {
      toast.error("It could not be hidden. Try again.");
    }
  };

  return (
    <article
      aria-label={`${lead.label}: ${card.title}`}
      className={cn("rounded-lg border border-l-[3px] border-border bg-card px-3 py-2.5", accent(card))}
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
        <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          <Icon name={lead.icon} className="size-3" aria-hidden />
          {lead.label}
        </span>
        <button
          type="button"
          className="min-w-0 max-w-full truncate text-left text-sm font-medium text-foreground hover:underline"
          onClick={() => navigate.toThread(card.threadId)}
        >
          {card.title}
        </button>
        {card.parentTitle !== null && <span className="text-muted-foreground">in {card.parentTitle}</span>}
        {projectName !== null && <span className="text-muted-foreground">{projectName}</span>}
        <span
          className={cn(
            "ml-auto whitespace-nowrap tabular-nums",
            card.tier === "blocked" ? "font-medium text-amber-600 dark:text-amber-400" : "text-muted-foreground",
          )}
        >
          {when}
        </span>
      </header>
      <div className="mt-2 flex flex-col gap-2 text-sm">
        <CardBody card={card} rpc={rpc} />
      </div>
      <footer className="mt-2 flex flex-wrap items-center gap-1 text-xs">
        {card.openFollowUps > 0 && card.lead !== "wrap-up" && (
          <span className="mr-1 text-muted-foreground">
            {card.openFollowUps === 1 ? "1 follow-up open" : `${card.openFollowUps} follow-ups open`}
          </span>
        )}
        <span className="flex-1" />
        {card.tier !== "blocked" && (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground" onClick={() => void hide()}>
            <Icon name="EyeOff" className="size-3.5" aria-hidden />
            Not now
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-muted-foreground"
          onClick={() => navigate.toThread(card.threadId)}
        >
          Open thread
          <Icon name="ArrowUpRight" className="size-3.5" aria-hidden />
        </Button>
      </footer>
    </article>
  );
}

function CardBody({ card, rpc }: { card: Card; rpc: Rpc }) {
  const first = card.asks[0];
  const more = card.asks.length - 1;
  let main: ReactNode;
  switch (card.lead) {
    case "question":
      main =
        first?.kind === "question" ? <QuestionForm card={card} ask={first} rpc={rpc} /> : null;
      break;
    case "approval":
    case "form":
      main = first === undefined ? null : <OpenToAnswer card={card} ask={first} />;
      break;
    case "stopped":
      main = <Stopped card={card} rpc={rpc} />;
      break;
    case "wrap-up":
      main = (
        <>
          {card.offer !== null && card.offer.steps.length > 0 && <NextStepsRow card={card} rpc={rpc} />}
          <WrapUpInline card={card} rpc={rpc} />
        </>
      );
      break;
    case "next":
      main = (
        <>
          <Excerpt text={card.excerpt} />
          <NextStepsRow card={card} rpc={rpc} />
        </>
      );
      break;
    case "page":
      main = (
        <>
          <Excerpt text={card.excerpt} />
          {card.pageUrl !== null && <PageLink url={card.pageUrl} primary />}
        </>
      );
      break;
    case "pr":
      main = <PullRequest card={card} rpc={rpc} />;
      break;
    case "finished":
      main = (
        <>
          <Excerpt text={card.excerpt} />
          <Finished card={card} rpc={rpc} />
        </>
      );
      break;
  }
  return (
    <>
      {main}
      {card.pageUrl !== null && card.lead !== "page" && card.tier !== "blocked" && (
        <PageLink url={card.pageUrl} primary={false} />
      )}
      {more > 0 && (
        <p className="text-xs text-muted-foreground">
          {more === 1 ? "1 more ask is waiting in the thread." : `${more} more asks are waiting in the thread.`}
        </p>
      )}
      {card.lead !== "pr" && card.pr !== null && card.tier !== "blocked" && (
        <div className="border-t border-border pt-2">
          <PullRequest card={card} rpc={rpc} />
        </div>
      )}
    </>
  );
}

/** The thread's Thread Page, which its last reply pointed to. */
function PageLink({ url, primary }: { url: string; primary: boolean }) {
  const navigate = useBbNavigate();
  // A path on this bb's own origin (see pageLinkIn): never a URL a reply wrote.
  const href = new URL(url, window.location.origin).toString();
  return (
    <div>
      {/* Through bb rather than a plain link, so it opens where your browser
          preference says. A plain link is routed into bb's own browser. */}
      <Button size="sm" variant={primary ? "default" : "outline"} onClick={() => navigate.openUrl(href)}>
        Open its Thread Page
        <Icon name="ArrowUpRight" aria-hidden />
      </Button>
    </div>
  );
}

function Excerpt({ text }: { text: string | null }) {
  if (text === null) return null;
  return (
    <p className="break-words border-l-2 border-border pl-2.5 text-[13px] leading-relaxed text-muted-foreground">
      {text}
    </p>
  );
}

/**
 * A box holding exactly what will be sent, editable first. Used wherever the
 * page would otherwise put words in a thread you did not see.
 */
export function MessageBox({
  initial,
  sendLabel,
  placeholder,
  onSend,
  onCancel,
}: {
  initial: string;
  sendLabel: string;
  placeholder?: string;
  /** Resolves true when it went, which closes the box. */
  onSend: (text: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      if (await onSend(text.trim())) onCancel();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-1.5">
      <textarea
        value={text}
        rows={3}
        autoFocus
        placeholder={placeholder}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && text.trim() !== "") {
            event.preventDefault();
            void send();
          }
          if (event.key === "Escape") onCancel();
        }}
        className="w-full resize-y rounded-md border border-border bg-background px-2.5 py-1.5 text-sm leading-snug outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" disabled={busy || text.trim() === ""} onClick={() => void send()}>
          {busy && <Icon name="Spinner" className="animate-spin" aria-hidden />}
          {sendLabel}
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <span className="text-xs text-muted-foreground">Sends exactly this, as you.</span>
      </div>
    </div>
  );
}

async function reply(rpc: Rpc, threadId: string, text: string): Promise<boolean> {
  try {
    const result = await rpc.call("page_reply", { threadId, text });
    if (result.outcome === "failed") {
      toast.error(SEND_FAILED);
      return false;
    }
    if (result.outcome === "queued") toast("Queued behind the current turn.");
    return true;
  } catch {
    toast.error(SEND_FAILED);
    return false;
  }
}

// --- question ----------------------------------------------------------------

function QuestionForm({
  card,
  ask,
  rpc,
}: {
  card: Card;
  ask: Extract<PendingAsk, { kind: "question" }>;
  rpc: Rpc;
}) {
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const toggle = (question: Question, value: string) =>
    setPicked((previous) => {
      const current = previous[question.id] ?? [];
      const next = question.multiSelect
        ? current.includes(value)
          ? current.filter((entry) => entry !== value)
          : [...current, value]
        : current.includes(value)
          ? []
          : [value];
      return { ...previous, [question.id]: next };
    });

  const answered = ask.questions.every(
    (question) => (picked[question.id]?.length ?? 0) > 0 || (other[question.id] ?? "").trim() !== "",
  );

  const send = async () => {
    setBusy(true);
    try {
      const answers = Object.fromEntries(
        ask.questions.map((question) => {
          const freeText = (other[question.id] ?? "").trim();
          return [
            question.id,
            { selected: picked[question.id] ?? [], ...(freeText === "" ? {} : { freeText }) },
          ];
        }),
      );
      const result = await rpc.call("page_answer", {
        threadId: card.threadId,
        interactionId: ask.interactionId,
        answers,
      });
      if (result.outcome === "stale") toast.error("That question was already answered, or withdrawn.");
      else if (result.outcome === "failed") toast.error("The answer did not go through. Try again.");
    } catch {
      toast.error("The answer did not go through. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {ask.questions.map((question) => (
        <fieldset key={question.id} className="flex min-w-0 flex-col gap-1.5">
          <legend className="mb-1.5 text-sm font-medium leading-snug text-foreground">{question.prompt}</legend>
          {question.multiSelect && <span className="-mt-1 text-xs text-muted-foreground">Choose any.</span>}
          <div role={question.multiSelect ? "group" : "radiogroup"} className="flex flex-col gap-1">
            {question.options.map((option) => {
              const on = (picked[question.id] ?? []).includes(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  role={question.multiSelect ? "checkbox" : "radio"}
                  aria-checked={on}
                  onClick={() => toggle(question, option.value)}
                  className={cn(
                    "flex w-full flex-col items-start rounded-md border px-2.5 py-1.5 text-left transition-colors",
                    on ? "border-sky-500 bg-sky-500/10" : "border-border hover:bg-state-hover",
                  )}
                >
                  <span className="text-sm font-medium text-foreground">{option.label}</span>
                  {option.description !== null && (
                    <span className="text-xs leading-snug text-muted-foreground">{option.description}</span>
                  )}
                </button>
              );
            })}
          </div>
          {question.allowFreeText && (
            <textarea
              rows={1}
              value={other[question.id] ?? ""}
              placeholder={question.options.length === 0 ? "Your answer" : "Other…"}
              aria-label={`Your own answer to: ${question.prompt}`}
              onChange={(event) => setOther((previous) => ({ ...previous, [question.id]: event.target.value }))}
              className="w-full resize-y rounded-md border border-dashed border-border bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:border-solid focus-visible:ring-1 focus-visible:ring-ring"
            />
          )}
        </fieldset>
      ))}
      <div>
        <Button size="sm" disabled={busy || !answered} onClick={() => void send()}>
          {busy && <Icon name="Spinner" className="animate-spin" aria-hidden />}
          Send answer
        </Button>
      </div>
    </div>
  );
}

// --- approvals and forms: answered in the thread for now ------------------------

function OpenToAnswer({ card, ask }: { card: Card; ask: PendingAsk }) {
  const navigate = useBbNavigate();
  const what =
    ask.kind === "approval" ? ask.summary : ask.kind === "form" ? ask.title : "A question";
  return (
    <div className="flex flex-col gap-2">
      <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/50 px-2.5 py-1.5 font-mono text-xs text-foreground">
        {what}
      </pre>
      <div>
        <Button size="sm" onClick={() => navigate.toThread(card.threadId)}>
          Answer in the thread
          <Icon name="ArrowUpRight" aria-hidden />
        </Button>
      </div>
    </div>
  );
}

// --- stopped -----------------------------------------------------------------

function Stopped({ card, rpc }: { card: Card; rpc: Rpc }) {
  const [busy, setBusy] = useState(false);
  const retry = async () => {
    setBusy(true);
    try {
      const result = await rpc.call("page_retry", { threadId: card.threadId });
      if (result.outcome === "failed") toast.error("It could not be retried. Open the thread to see why.");
    } catch {
      toast.error("It could not be retried. Open the thread to see why.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[13px] text-muted-foreground">The last turn ended in an error.</p>
      <Excerpt text={card.excerpt} />
      <div>
        <Button size="sm" disabled={busy} onClick={() => void retry()}>
          <Icon name="RotateCcw" aria-hidden />
          Retry
        </Button>
      </div>
    </div>
  );
}

// --- next steps --------------------------------------------------------------

function NextStepsRow({ card, rpc }: { card: Card; rpc: Rpc }) {
  const offer = card.offer;
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (offer === null || offer.steps.length === 0) return null;

  const take = async (index: number) => {
    setBusy(true);
    try {
      const outcome = await takeStep(rpc, card.threadId, offer, index);
      if (outcome === "queued") toast("Queued behind the current turn.");
    } finally {
      setBusy(false);
    }
  };
  const keep = async (index: number) => {
    setBusy(true);
    try {
      const result = await rpc.call("followups_next_keep", {
        threadId: card.threadId,
        offeredAt: offer.offeredAt,
        index,
      });
      if (result.outcome === "added") toast.success("Kept as a follow-up.");
      else if (result.outcome === "stale") toast.error("That offer was replaced by a newer one.");
      else toast.error(REFUSAL_DETAIL[result.outcome]);
    } catch {
      toast.error(REFUSAL_DETAIL.failed);
    } finally {
      setBusy(false);
    }
  };

  if (editing !== null) {
    return (
      <MessageBox
        initial={editing}
        sendLabel="Send"
        onSend={(text) => reply(rpc, card.threadId, text)}
        onCancel={() => setEditing(null)}
      />
    );
  }
  return (
    <div className="flex min-w-0 items-start gap-1">
      <div role="group" aria-label="Next steps" className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        {offer.steps.map((step, index) => (
          <Chip
            key={`${offer.offeredAt}-${step}`}
            label={step}
            hint="⌥-click to edit it first."
            ariaLabel={`Send "${step}"`}
            primary={index === 0}
            disabled={busy}
            onSend={() => void take(index)}
            onEdit={() => setEditing(step)}
          />
        ))}
      </div>
      {/* The same ⋯ as the Next row's: keeping a step is the rarer choice,
          and a line of "Keep … for later" per step crowded the card. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 text-muted-foreground"
            disabled={busy}
            aria-label="More next-step actions"
          >
            <Icon name="MoreHorizontal" className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-w-[min(20rem,calc(100vw-2rem))]">
          {offer.steps.map((step, index) => (
            <DropdownMenuItem
              key={`keep-${step}`}
              className="items-start"
              onSelect={() => void keep(index)}
              aria-label={`Keep "${step}" as a follow-up`}
            >
              <Icon name="ListTodo" className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span className="flex min-w-0 flex-col">
                <span>Keep for later</span>
                <span className="whitespace-normal break-words text-xs text-muted-foreground">{step}</span>
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// --- wrap up -----------------------------------------------------------------

/**
 * The composer's Wrap up sheet, mounted in the card. It reads its rows from
 * the store the banner fills, so the card fills it for this thread instead —
 * there is no banner here.
 */
function WrapUpInline({ card, rpc }: { card: Card; rpc: Rpc }) {
  const threadId = card.threadId;
  const load = useCallback(async () => {
    try {
      const result = await rpc.call("followups_list", { threadId });
      setRows(threadId, result.followUps, result.done);
    } catch {
      // The sheet shows "nothing open" until the next signal; nothing to say.
    }
  }, [rpc, threadId]);
  useEffect(() => {
    void load();
  }, [load]);
  useRealtime("followups-changed", (payload) => {
    if (isChangeSignal(payload) && payload.threadId === threadId) void load();
  });
  return (
    <div className="overflow-hidden rounded-md border border-border bg-background">
      <WrapUp threadId={threadId} running={false} onClose={() => void load()} />
    </div>
  );
}

// --- pull request ------------------------------------------------------------

const METHOD_LABEL: Record<MergeMethod, string> = {
  merge: "Merge commit",
  squash: "Squash",
  rebase: "Rebase",
};

function PullRequest({ card, rpc }: { card: Card; rpc: Rpc }) {
  const navigate = useBbNavigate();
  const pr = card.pr;
  const [box, setBox] = useState<{ kind: "message" | "review"; text: string; label: string } | null>(null);
  const [askMethod, setAskMethod] = useState(false);
  // On by default: the thread that opened the PR is usually waiting to hear.
  const [tell, setTell] = useState(true);
  const [busy, setBusy] = useState(false);
  if (pr === null) return null;

  const merge = async (method?: MergeMethod) => {
    setBusy(true);
    try {
      const result = await rpc.call("page_pr_merge", {
        threadId: card.threadId,
        ...(method ? { method } : {}),
        ...(tell ? { tell: prMergedMessage(pr) } : {}),
      });
      if (result.outcome === "needs-method") setAskMethod(true);
      else if (result.outcome === "merged") {
        setAskMethod(false);
        if (result.told === "failed") toast.error(`Merged #${pr.number}, but the thread could not be told. Tell it yourself.`);
        else toast.success(result.told === null ? `Merged #${pr.number}.` : `Merged #${pr.number} and told the thread.`);
      } else toast.error(result.message ?? "It could not be merged. Try again.");
    } catch {
      toast.error("It could not be merged. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const startReview = async (prompt: string): Promise<boolean> => {
    try {
      const result = await rpc.call("page_pr_review", { threadId: card.threadId, prompt });
      if (result.outcome === "spawned") {
        toast.success("Review thread started.");
        return true;
      }
    } catch {
      // Falls through to the error below.
    }
    toast.error("The review thread did not start. Try again.");
    return false;
  };

  const checks =
    pr.checks.failed > 0
      ? `✕ ${pr.checks.failed} of ${pr.checks.total} checks failed`
      : pr.checks.pending > 0
        ? `${pr.checks.pending} ${pr.checks.pending === 1 ? "check" : "checks"} running`
        : pr.checks.total > 0
          ? `✓ ${pr.checks.passed} ${pr.checks.passed === 1 ? "check" : "checks"}`
          : "No checks";
  const status: Record<string, string> = {
    merge: "Ready to merge",
    review: "Wants review",
    fix: pr.attention === "changes_requested" ? "Changes requested" : "Checks failed",
    rebase: "Has conflicts",
    merged: "Merged",
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">
          #{pr.number} {pr.title}
        </span>
        <span>{status[pr.action]}</span>
        <span className={cn(pr.checks.failed > 0 ? "text-destructive" : pr.checks.total > 0 && pr.checks.pending === 0 ? "text-emerald-600 dark:text-emerald-400" : "")}>
          {checks}
        </span>
        {pr.headRefName !== "" && (
          <span className="font-mono">
            {pr.headRefName} → {pr.baseRefName}
          </span>
        )}
      </div>
      {box !== null ? (
        <MessageBox
          initial={box.text}
          sendLabel={box.label}
          onSend={(text) => (box.kind === "review" ? startReview(text) : reply(rpc, card.threadId, text))}
          onCancel={() => setBox(null)}
        />
      ) : askMethod ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">
            How does this project merge? Asked once, then used for every merge here.
          </span>
          <div className="flex flex-wrap gap-1.5">
            {MERGE_METHODS.map((method) => (
              <Button key={method} size="sm" variant={method === "merge" ? "default" : "outline"} disabled={busy} onClick={() => void merge(method)}>
                {METHOD_LABEL[method]}
              </Button>
            ))}
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setAskMethod(false)}>
              Cancel
            </Button>
          </div>
          <TellToggle pr={pr} on={tell} onChange={setTell} />
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          {pr.action === "merge" && (
            <Button size="sm" disabled={busy} onClick={() => void merge()}>
              <Icon name="GitMerge" aria-hidden />
              Merge
            </Button>
          )}
          {pr.action === "fix" && (
            <Button size="sm" onClick={() => setBox({ kind: "message", text: prFixMessage(pr), label: "Send to the thread" })}>
              Ask the thread to fix
            </Button>
          )}
          {pr.action === "rebase" && (
            <Button size="sm" onClick={() => setBox({ kind: "message", text: prRebaseMessage(pr), label: "Send to the thread" })}>
              Ask the thread to rebase
            </Button>
          )}
          {(pr.action === "merge" || pr.action === "review") && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setBox({ kind: "message", text: "", label: "Send to the thread" })}
            >
              Request changes…
            </Button>
          )}
          {pr.action !== "merged" &&
            (card.reviewThreadId !== null ? (
              <Button size="sm" variant="outline" onClick={() => navigate.toThread(card.reviewThreadId as string)}>
                Review thread
                <Icon name="ArrowUpRight" aria-hidden />
              </Button>
            ) : (
              <Button
                size="sm"
                variant={pr.action === "review" ? "default" : "outline"}
                onClick={() => setBox({ kind: "review", text: reviewPrompt(pr), label: "Start the review thread" })}
              >
                Start a review thread
              </Button>
            ))}
          {pr.action === "merged" && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setBox({ kind: "message", text: prMergedMessage(pr), label: "Send to the thread" })}
              >
                Tell the thread it merged
              </Button>
              <MergedActions card={card} rpc={rpc} />
            </>
          )}
          <span className="flex-1" />
          <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => navigate.openUrl(pr.url)}>
            GitHub
            <Icon name="ArrowUpRight" aria-hidden />
          </Button>
          {pr.action === "merge" && <TellToggle pr={pr} on={tell} onChange={setTell} />}
        </div>
      )}
    </div>
  );
}

/**
 * Whether Merge also tells the thread, with the words it will send in view:
 * pressing Merge sends nothing you could not read beside it.
 */
function TellToggle({ pr, on, onChange }: { pr: PrSummary; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="flex w-full cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
      <input type="checkbox" checked={on} onChange={(event) => onChange(event.target.checked)} className="accent-current" />
      Then tell the thread: “{prMergedMessage(pr)}”
    </label>
  );
}

function MergedActions({ card, rpc }: { card: Card; rpc: Rpc }) {
  const [busy, setBusy] = useState(false);
  const archive = async () => {
    setBusy(true);
    try {
      const result = await rpc.call("page_archive", { threadId: card.threadId });
      if (result.outcome === "failed") toast.error("It could not be archived. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button size="sm" variant="outline" disabled={busy} onClick={() => void archive()}>
      <Icon name="Archive" aria-hidden />
      Archive thread
    </Button>
  );
}

// --- finished ----------------------------------------------------------------

function Finished({ card, rpc }: { card: Card; rpc: Rpc }) {
  const [replying, setReplying] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async (method: "page_mark_read" | "page_archive", failure: string) => {
    setBusy(true);
    try {
      const result = await rpc.call(method, { threadId: card.threadId });
      if (result.outcome === "failed") toast.error(failure);
    } catch {
      toast.error(failure);
    } finally {
      setBusy(false);
    }
  };
  if (replying) {
    return (
      <MessageBox
        initial=""
        placeholder="Reply…"
        sendLabel="Send"
        onSend={(text) => reply(rpc, card.threadId, text)}
        onCancel={() => setReplying(false)}
      />
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      <Button size="sm" variant="outline" onClick={() => setReplying(true)}>
        Reply…
      </Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void run("page_mark_read", "It could not be marked read.")}>
        <Icon name="Check" aria-hidden />
        Mark read
      </Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void run("page_archive", "It could not be archived.")}>
        <Icon name="Archive" aria-hidden />
        Archive
      </Button>
    </div>
  );
}
