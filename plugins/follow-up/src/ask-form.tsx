// The form an agent asked with (`ask_form`), drawn from its parts.
//
// One component for every place a form shows: the Follow Up page's card,
// Focus, and the banner above the thread's composer. The rules are in
// lib/ask.ts and are the server's too: what may be answered, and the message
// an answer sends. That message is composed from the form and what was
// picked or typed, and shown in the box above Send exactly as it will go.
import { useMemo, useState, type ReactNode } from "react";
import { experimental_Diff as Diff, useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "../server";
import {
  answerProblem,
  composeAnswer,
  openItems,
  openQuestions,
  startingAnswers,
  type Answer,
  type Answers,
  type Form,
  type ItemPart,
  type Option,
  type Part,
  type QuestionPart,
  type Tone,
} from "../lib/ask.ts";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { FormText } from "./form-text.tsx";
import { useDeckKeys } from "./page/deck-keys.tsx";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  info: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  success: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  warning: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  danger: "bg-destructive/10 text-destructive",
};

/** A key's number beside what it picks, in Focus. */
function Key({ children }: { children: ReactNode }) {
  return (
    <kbd className="mr-1.5 inline-flex min-w-4 items-center justify-center rounded border border-border bg-background px-1 font-mono text-[10px] font-medium text-muted-foreground">
      {children}
    </kbd>
  );
}

export function AskForm({
  threadId,
  form,
  onDismiss,
}: {
  threadId: string;
  form: Form;
  /** Drop the form unanswered. The thread's banner offers it; the page has Not now. */
  onDismiss?: () => void;
}) {
  // A new form is a new set of answers: nothing picked on the last one carries over.
  return <Fields key={form.askedAt} threadId={threadId} form={form} onDismiss={onDismiss} />;
}

function Fields({ threadId, form, onDismiss }: { threadId: string; form: Form; onDismiss?: (() => void) | undefined }) {
  const rpc = useRpc<typeof rpcContract>();
  const [answers, setAnswers] = useState<Answers>(() => startingAnswers(form));
  /** Drafts as edited, by item id; they go with the item's choice. */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  /** What Focus's number keys pick for: an index into `targets`. */
  const [cursor, setCursor] = useState(0);

  const questions = openQuestions(form);
  const items = openItems(form);
  const open = useMemo(() => new Set([...questions, ...items].map((part) => part.id)), [questions, items]);

  // What would be sent now: only what is still open, each item with its draft.
  const sending = useMemo(() => {
    const out: Answers = {};
    for (const [id, answer] of Object.entries(answers)) {
      if (!open.has(id)) continue;
      out[id] = answer.type === "item" && drafts[id] !== undefined ? { ...answer, draft: drafts[id] } : answer;
    }
    return out;
  }, [answers, drafts, open]);
  const problem = answerProblem(form, sending);
  const preview = problem === null ? composeAnswer(form, sending).text : null;
  const decided = items.filter((part) => part.id in sending).length;

  const set = (id: string, answer: Answer | null) =>
    setAnswers((previous) => {
      const next = { ...previous };
      if (answer === null) delete next[id];
      else next[id] = answer;
      return next;
    });

  const send = async () => {
    if (problem !== null || busy) return;
    setBusy(true);
    try {
      const result = await rpc.call("ask_answer", { threadId, askedAt: form.askedAt, answers: sending });
      if (result.outcome === "queued") toast("Queued behind the current turn.");
      else if (result.outcome === "stale") toast.error("That form was replaced or withdrawn. Nothing was sent.");
      else if (result.outcome === "invalid") toast.error(result.problem ?? "That answer does not fit the form.");
      else if (result.outcome === "failed") toast.error("It was not sent. Try again.");
    } catch {
      toast.error("It was not sent. Try again.");
    } finally {
      setBusy(false);
    }
  };

  // Focus's keys go to single choices and items, in the form's order.
  const targets = [...questions.filter((part) => part.type === "choice"), ...items];
  const target = targets[Math.min(cursor, targets.length - 1)];
  const keyed = useDeckKeys({
    pick: (n) => {
      if (target === undefined) return;
      if (target.type === "item") {
        const choice = target.choices[n - 1];
        if (choice === undefined) return;
        set(target.id, { type: "item", choice: choice.label });
      } else if (target.type === "choice") {
        const option = target.options[n - 1];
        if (option === undefined) return;
        if (target.multiple) {
          const current = answers[target.id];
          const selected = current?.type === "choice" ? current.selected : [];
          set(target.id, { type: "choice", selected: selected.includes(option.label) ? selected.filter((label) => label !== option.label) : [...selected, option.label] });
          return;
        }
        set(target.id, { type: "choice", selected: [option.label] });
      }
      setCursor((index) => Math.min(index + 1, targets.length - 1));
    },
    send: () => void send(),
  });
  const keysFor = (id: string) => keyed && target?.id === id;

  const takeRecommended = () =>
    setAnswers((previous) => {
      const next = { ...previous };
      for (const part of items) if (part.recommended !== null && !(part.id in next)) next[part.id] = { type: "item", choice: part.recommended };
      return next;
    });
  const recommendable = items.filter((part) => part.recommended !== null && !(part.id in sending)).length;
  const answered = Object.keys(form.done).length;

  const sendLabel =
    questions.length > 0 && decided > 0
      ? `Send answers and ${decided === 1 ? "1 decision" : `${decided} decisions`}`
      : questions.length > 0
        ? "Send answers"
        : decided === 1
          ? "Send 1 decision"
          : `Send ${decided} decisions`;

  return (
    <section aria-label={`Form: ${form.title}`} className="flex min-w-0 flex-col gap-3">
      <header className="flex items-start gap-2">
        <h3 className="min-w-0 flex-1 text-sm font-semibold leading-snug text-foreground">{form.title}</h3>
        {items.length + answered > 1 && items.length > 0 && (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {items.length} of {form.parts.filter((part) => part.type === "item").length} to decide
          </span>
        )}
        {onDismiss !== undefined && (
          <Button variant="ghost" size="icon" className="-mr-1 -mt-1 size-6 shrink-0 text-muted-foreground" onClick={onDismiss} aria-label="Dismiss the form and answer in chat">
            <Icon name="X" className="size-3.5" aria-hidden />
          </Button>
        )}
      </header>
      {form.parts.map((part, index) => (
        <PartView
          key={"id" in part ? part.id : `part-${index}`}
          part={part}
          done={"id" in part ? (form.done[part.id] ?? null) : null}
          answer={"id" in part ? answers[part.id] : undefined}
          draft={"id" in part ? drafts[part.id] : undefined}
          keys={"id" in part && keysFor(part.id)}
          onAnswer={(answer) => "id" in part && set(part.id, answer)}
          onDraft={(text) => "id" in part && setDrafts((previous) => ({ ...previous, [part.id]: text }))}
        />
      ))}
      <footer className="flex flex-col gap-2">
        {recommendable > 0 && (
          <div>
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={takeRecommended}>
              Take the {recommendable === 1 ? "recommendation" : `${recommendable} recommendations`}
            </Button>
          </div>
        )}
        {preview !== null ? (
          <div className="rounded-md border border-border bg-muted/40 px-2.5 py-1.5" aria-label="What will be sent">
            <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Sends, as you</div>
            <pre className="whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-foreground">{preview}</pre>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{problem === "There is nothing to send yet." ? "Pick what you want decided, then send." : problem}</p>
        )}
        <div>
          <Button size="sm" disabled={busy || problem !== null} onClick={() => void send()}>
            {busy && <Icon name="Spinner" className="animate-spin" aria-hidden />}
            {sendLabel}
            {keyed && <Key>⏎</Key>}
          </Button>
        </div>
      </footer>
    </section>
  );
}

function PartView({
  part,
  done,
  answer,
  draft,
  keys,
  onAnswer,
  onDraft,
}: {
  part: Part;
  done: string | null;
  answer: Answer | undefined;
  draft: string | undefined;
  keys: boolean;
  onAnswer: (answer: Answer | null) => void;
  onDraft: (text: string) => void;
}) {
  switch (part.type) {
    case "text":
      // Never bb's Markdown: a form's text draws no image and no HTML. See lib/form-text.ts.
      return <FormText text={part.text} className="text-sm text-foreground" />;
    case "code":
      return <Code title={part.title} code={part.code} />;
    case "table":
      return (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="bg-muted/50">
              <tr>
                {part.columns.map((cell, index) => (
                  <th key={index} className="px-2.5 py-1.5 font-semibold text-foreground">
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {part.rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-t border-border">
                  {row.map((cell, index) => (
                    <td key={index} className="px-2.5 py-1.5 align-top text-foreground">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "link":
      return <WebLink label={part.label} url={part.url} />;
    case "item":
      return <Item part={part} done={done} answer={answer} draft={draft} keys={keys} onAnswer={onAnswer} onDraft={onDraft} />;
    default:
      return done !== null ? <Done prompt={part.prompt} line={done} /> : <Question part={part} answer={answer} keys={keys} onAnswer={onAnswer} />;
  }
}

/** Through bb rather than a plain link, so it opens where the browser preference says. */
function WebLink({ label, url }: { label: string; url: string }) {
  const navigate = useBbNavigate();
  return (
    <div>
      <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => navigate.openUrl(url)}>
        {label}
        <Icon name="ArrowUpRight" className="size-3.5" aria-hidden />
      </Button>
    </div>
  );
}

function Code({ title, code }: { title: string | null; code: { diff: boolean; path: string | null; text: string } }) {
  const heading = title ?? code.path;
  return (
    <div className="overflow-hidden rounded-md border border-border">
      {heading !== null && <div className="bg-muted/50 px-2.5 py-1 font-mono text-xs text-foreground">{heading}</div>}
      {code.diff && code.path !== null ? (
        <div className="max-h-80 overflow-auto">
          <Diff patch={code.text} path={code.path} />
        </div>
      ) : (
        <pre className="max-h-80 overflow-auto whitespace-pre px-2.5 py-1.5 font-mono text-xs text-foreground">{code.text}</pre>
      )}
    </div>
  );
}

function Done({ prompt, line }: { prompt: string; line: string }) {
  return (
    <p className="flex min-w-0 items-baseline gap-1.5 text-xs text-muted-foreground">
      <Icon name="Check" className="size-3 shrink-0 translate-y-0.5 text-emerald-600 dark:text-emerald-400" aria-hidden />
      <span className="min-w-0">
        {prompt} <span className="whitespace-pre-wrap text-foreground">{line}</span>
      </span>
    </p>
  );
}

const optionClass = (on: boolean) =>
  cn(
    "flex w-full flex-col items-start rounded-md border px-2.5 py-1.5 text-left transition-colors",
    on ? "border-sky-500 bg-sky-500/10" : "border-border hover:bg-state-hover",
  );

function OptionLabel({ option, recommended, hint }: { option: Option; recommended: boolean; hint: number | null }) {
  return (
    <>
      <span className="text-sm font-medium text-foreground">
        {hint !== null && <Key>{hint}</Key>}
        {option.label}
        {recommended && <span className="ml-1.5 rounded-full bg-emerald-500/10 px-1.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">recommended</span>}
      </span>
      {option.description !== null && <span className="text-xs leading-snug text-muted-foreground">{option.description}</span>}
    </>
  );
}

function Question({
  part,
  answer,
  keys,
  onAnswer,
}: {
  part: QuestionPart;
  answer: Answer | undefined;
  keys: boolean;
  onAnswer: (answer: Answer | null) => void;
}) {
  const legend = (
    <legend className="mb-1.5 text-sm font-medium leading-snug text-foreground">
      {part.prompt}
      {(part.type === "choice" || part.type === "answer") && part.optional && <span className="ml-1.5 text-xs font-normal text-muted-foreground">optional</span>}
    </legend>
  );
  if (part.type === "choice") {
    const current = answer?.type === "choice" ? answer : { type: "choice" as const, selected: [] as string[] };
    const other = current.other ?? "";
    const toggle = (label: string) => {
      const on = current.selected.includes(label);
      if (part.multiple) {
        onAnswer({ ...current, selected: on ? current.selected.filter((entry) => entry !== label) : [...current.selected, label] });
      } else {
        // One answer: picking an option takes the place of one typed, and of the last pick.
        onAnswer({ type: "choice", selected: on ? [] : [label] });
      }
    };
    return (
      <fieldset className="flex min-w-0 flex-col gap-1.5" data-keys={keys ? "" : undefined}>
        {legend}
        {part.multiple && <span className="-mt-1 text-xs text-muted-foreground">Choose any.</span>}
        <div role={part.multiple ? "group" : "radiogroup"} className="flex flex-col gap-1">
          {part.options.map((option, index) => {
            const on = current.selected.includes(option.label);
            return (
              <button key={option.label} type="button" role={part.multiple ? "checkbox" : "radio"} aria-checked={on} onClick={() => toggle(option.label)} className={optionClass(on)}>
                <OptionLabel option={option} recommended={part.recommended.includes(option.label)} hint={keys && index < 9 ? index + 1 : null} />
              </button>
            );
          })}
        </div>
        {part.allowOther && (
          <textarea
            rows={1}
            value={other}
            placeholder="Something else…"
            aria-label={`Your own answer to: ${part.prompt}`}
            onChange={(event) => {
              const text = event.target.value;
              // On a single choice, an answer of your own replaces the pick.
              onAnswer(part.multiple ? { ...current, other: text } : { type: "choice", selected: text.trim() === "" ? current.selected : [], other: text });
            }}
            className="w-full resize-y rounded-md border border-dashed border-border bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:border-solid focus-visible:ring-1 focus-visible:ring-ring"
          />
        )}
      </fieldset>
    );
  }
  if (part.type === "pick") {
    const picked = answer?.type === "pick" ? answer.picked : [];
    return (
      <fieldset className="flex min-w-0 flex-col gap-1.5">
        {legend}
        <div role="group" className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {part.items.map((option) => {
            const on = picked.includes(option.label);
            return (
              <button
                key={option.label}
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => onAnswer({ type: "pick", picked: on ? picked.filter((label) => label !== option.label) : [...picked, option.label] })}
                className={cn("flex items-start gap-2 rounded-md border px-2 py-1 text-left text-[13px]", on ? "border-sky-500 bg-sky-500/10" : "border-border hover:bg-state-hover")}
              >
                <span aria-hidden className={cn("mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-sm border", on ? "border-sky-500 bg-sky-500 text-white" : "border-muted-foreground/50")}>
                  {on && <Icon name="Check" className="size-2.5" aria-hidden />}
                </span>
                <span className="min-w-0">
                  <span className="text-foreground">{option.label}</span>
                  {option.description !== null && <span className="block text-xs text-muted-foreground">{option.description}</span>}
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>
    );
  }
  if (part.type === "rank") {
    const order = answer?.type === "rank" ? answer.order : part.options.map((option) => option.label);
    const move = (index: number, by: -1 | 1) => {
      const to = index + by;
      if (to < 0 || to >= order.length) return;
      const next = [...order];
      [next[index], next[to]] = [next[to]!, next[index]!];
      onAnswer({ type: "rank", order: next });
    };
    return (
      <fieldset className="flex min-w-0 flex-col gap-1.5">
        {legend}
        <ol className="flex flex-col gap-1">
          {order.map((label, index) => (
            <li key={label} className="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-[13px]">
              <span className="w-4 shrink-0 text-right tabular-nums text-muted-foreground">{index + 1}</span>
              <span className="min-w-0 flex-1 text-foreground">{label}</span>
              <Button variant="ghost" size="icon" className="size-6" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`Move "${label}" up`}>
                <Icon name="ChevronUp" className="size-3.5" aria-hidden />
              </Button>
              <Button variant="ghost" size="icon" className="size-6" disabled={index === order.length - 1} onClick={() => move(index, 1)} aria-label={`Move "${label}" down`}>
                <Icon name="ChevronDown" className="size-3.5" aria-hidden />
              </Button>
            </li>
          ))}
        </ol>
      </fieldset>
    );
  }
  const text = answer?.type === "answer" ? answer.text : "";
  const fieldClass = "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring";
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      {legend}
      {part.long ? (
        <textarea rows={4} value={text} placeholder={part.placeholder ?? undefined} aria-label={part.prompt} onChange={(event) => onAnswer({ type: "answer", text: event.target.value })} className={cn(fieldClass, "resize-y")} />
      ) : (
        <input type="text" value={text} placeholder={part.placeholder ?? undefined} aria-label={part.prompt} onChange={(event) => onAnswer({ type: "answer", text: event.target.value })} className={fieldClass} />
      )}
    </fieldset>
  );
}

function Item({
  part,
  done,
  answer,
  draft,
  keys,
  onAnswer,
  onDraft,
}: {
  part: ItemPart;
  done: string | null;
  answer: Answer | undefined;
  draft: string | undefined;
  keys: boolean;
  onAnswer: (answer: Answer | null) => void;
  onDraft: (text: string) => void;
}) {
  const navigate = useBbNavigate();
  const title =
    part.url === null ? (
      <span className="min-w-0 text-sm font-medium text-foreground">{part.title}</span>
    ) : (
      <button type="button" className="min-w-0 text-left text-sm font-medium text-foreground hover:underline" onClick={() => navigate.openUrl(part.url!)}>
        {part.title}
      </button>
    );
  const badges = part.badges.map((badge) => (
    <span key={badge.label} className={cn("shrink-0 rounded px-1.5 text-[11px] font-medium", TONE_CLASS[badge.tone])}>
      {badge.label}
    </span>
  ));
  if (done !== null) {
    return (
      <article aria-label={`${part.title}: ${done}`} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md border border-border px-2.5 py-1.5 opacity-70">
        <Icon name="Check" className="size-3 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
        {title}
        <span className="text-xs text-muted-foreground">{done}</span>
      </article>
    );
  }
  const chosen = answer?.type === "item" ? answer.choice : null;
  const described = part.choices.some((option) => option.description !== null);
  return (
    <article aria-label={part.title} className={cn("flex min-w-0 flex-col gap-1.5 rounded-md border px-2.5 py-2", chosen !== null ? "border-sky-500/60" : "border-border")} data-keys={keys ? "" : undefined}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {title}
        {badges}
      </div>
      {part.summary !== null && <FormText text={part.summary} className="text-[13px] text-muted-foreground" />}
      {part.code !== null && <Code title={null} code={part.code} />}
      {part.draft !== null && (
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{part.draft.label}</span>
          <textarea
            rows={part.draft.long ? 3 : 1}
            value={draft ?? part.draft.text}
            onChange={(event) => onDraft(event.target.value)}
            className="w-full resize-y rounded-md border border-dashed border-border bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:border-solid focus-visible:ring-1 focus-visible:ring-ring"
          />
        </label>
      )}
      {/* Choices that explain themselves stack, so the explanation is read on a phone too. */}
      <div role="radiogroup" aria-label={`Decide: ${part.title}`} className={described ? "flex flex-col gap-1" : "flex flex-wrap gap-1.5"}>
        {part.choices.map((option, index) => {
          const on = chosen === option.label;
          // A second press takes the decision back: an item may be left for later.
          const press = () => onAnswer(on ? null : { type: "item", choice: option.label });
          const hint = keys && index < 9 ? index + 1 : null;
          if (described) {
            return (
              <button key={option.label} type="button" role="radio" aria-checked={on} onClick={press} className={optionClass(on)}>
                <OptionLabel option={option} recommended={part.recommended === option.label} hint={hint} />
              </button>
            );
          }
          return (
            <button
              key={option.label}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={press}
              className={cn("inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium text-foreground", on ? "border-sky-500 bg-sky-500/10" : "border-border hover:bg-state-hover")}
            >
              {hint !== null && <Key>{hint}</Key>}
              {option.label}
              {part.recommended === option.label && <span className="ml-1.5 rounded-full bg-emerald-500/10 px-1.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">recommended</span>}
            </button>
          );
        })}
      </div>
    </article>
  );
}
