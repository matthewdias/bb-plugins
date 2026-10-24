// A form the agent asks with: several questions answered together, and items
// decided one by one, built from a fixed set of parts that Follow Up draws.
//
// Pure, like next-steps.ts: no plugin API, so every rule here is testable
// without a running bb. Keep `bb.*` calls in server.ts.
//
// A reply that ends in six numbered questions gets answered by typing six
// numbered answers. `ask_form` turns that into something to fill in: the agent
// ends its turn with a form, Follow Up keeps it the way it keeps next steps,
// and answering sends one message under the user's name. Unlike bb's own
// questions it does not hold the turn open, so it waits as long as it takes.
//
// Two rules shape everything below, the same two next steps live by.
//
// What you answer with is what you saw. The message is composed here, from the
// labels on the form and the words the user typed; the agent supplies no text
// "behind" a choice. An agent steered by something it read could otherwise
// label a choice "Close it" and have it send anything, with the user's
// authority. For the same reason nothing that is sent back may hold a
// character that draws nothing: a form carrying one is refused, not cleaned.
//
// And there is no agent HTML. A part is one of the kinds below, drawn by
// Follow Up. No images either: a local path would let an agent surface files it
// should not, and a remote one tells a server the form was opened. That is not
// a check made here on the text, which a renderer could read differently; it
// is that a form's text is drawn by form-text.ts, which can draw neither.
import { z } from "zod";
import { hasUnseen, reveal } from "./unseen.ts";

export const ASK_TITLE_MAX = 120;
export const ASK_PROMPT_MAX = 300;
export const ASK_LABEL_MAX = 120;
export const ASK_TEXT_MAX = 6_000;
export const ASK_CODE_MAX = 20_000;
export const ASK_DRAFT_MAX = 8_000;
export const ASK_PARTS_MAX = 40;
export const ASK_OPTIONS_MAX = 8;
export const ASK_PICK_MAX = 50;
export const ASK_RANK_MAX = 12;
export const ASK_CHOICES_MAX = 6;
export const ASK_BADGES_MAX = 3;
export const ASK_COLUMNS_MAX = 6;
export const ASK_ROWS_MAX = 30;
/** What a typed answer may run to; the message it goes in is the user's. */
export const ASK_ANSWER_MAX = 8_000;

export const TONES = ["neutral", "info", "success", "warning", "danger"] as const;
export type Tone = (typeof TONES)[number];

const optionSchema = z.object({ label: z.string(), description: z.string().nullable() });
export type Option = z.infer<typeof optionSchema>;

const codeSchema = z.object({
  /** A unified patch for one file, drawn with bb's diff view; otherwise plain code. */
  diff: z.boolean(),
  path: z.string().nullable(),
  text: z.string(),
});

const displayParts = [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("code"), title: z.string().nullable(), code: codeSchema }),
  z.object({ type: z.literal("table"), columns: z.array(z.string()), rows: z.array(z.array(z.string())) }),
  z.object({ type: z.literal("link"), label: z.string(), url: z.string() }),
] as const;

const questionParts = [
  z.object({
    type: z.literal("choice"),
    id: z.string(),
    prompt: z.string(),
    options: z.array(optionSchema),
    multiple: z.boolean(),
    /** Picked when the form opens, so agreeing with the agent is one press. */
    recommended: z.array(z.string()),
    allowOther: z.boolean(),
    optional: z.boolean(),
  }),
  z.object({
    type: z.literal("pick"),
    id: z.string(),
    prompt: z.string(),
    items: z.array(optionSchema),
    picked: z.array(z.string()),
  }),
  z.object({ type: z.literal("rank"), id: z.string(), prompt: z.string(), options: z.array(optionSchema) }),
  z.object({
    type: z.literal("answer"),
    id: z.string(),
    prompt: z.string(),
    long: z.boolean(),
    draft: z.string(),
    placeholder: z.string().nullable(),
    optional: z.boolean(),
  }),
] as const;

const itemSchema = z.object({
  type: z.literal("item"),
  id: z.string(),
  title: z.string(),
  url: z.string().nullable(),
  badges: z.array(z.object({ label: z.string(), tone: z.enum(TONES) })),
  summary: z.string().nullable(),
  code: codeSchema.nullable(),
  /** Text to edit before it is used: a comment to post, a task for a thread. */
  draft: z.object({ label: z.string(), text: z.string(), long: z.boolean() }).nullable(),
  choices: z.array(optionSchema),
  recommended: z.string().nullable(),
});

export const partSchema = z.discriminatedUnion("type", [...displayParts, ...questionParts, itemSchema]);
export type Part = z.infer<typeof partSchema>;
export type QuestionPart = Extract<Part, { type: "choice" | "pick" | "rank" | "answer" }>;
export type ItemPart = Extract<Part, { type: "item" }>;

export const formSchema = z.object({
  /**
   * When it was asked, and the form's identity. An answer names the form it
   * was looking at, so one that lands after the agent asked again cannot
   * answer the new form's parts by id.
   */
  askedAt: z.string(),
  title: z.string(),
  parts: z.array(partSchema),
  /**
   * What has been answered, by part id: a line saying how. The questions are
   * answered together, once; items one by one, so a form outlives its first
   * answer for as long as an item is undecided.
   */
  done: z.record(z.string(), z.string()),
  /**
   * Set while the turn its own answer started is the next to begin, so that
   * turn does not clear the items still open. Any other turn clears the form.
   */
  keepThrough: z.boolean(),
});
export type Form = z.infer<typeof formSchema>;

// --- what the agent sends ---------------------------------------------------------

const optionInput = z.object({
  label: z.string().max(ASK_LABEL_MAX).describe("What the user sees and what comes back as the answer."),
  description: z.string().max(ASK_PROMPT_MAX).optional().describe("A line under the label."),
});

const codeInput = z.object({
  text: z.string().max(ASK_CODE_MAX).describe("The code, or with `diff: true` a unified patch for one file."),
  path: z.string().max(400).optional().describe("The file it is from. Required for a diff."),
  diff: z.boolean().optional().describe("True when `text` is a unified patch; it is drawn as a diff."),
});

/**
 * The tool's `parts`. Loose in what it accepts (every flag optional) and
 * described for the model; `makeForm` checks the rest and fills the defaults.
 * No transforms, so it still converts to the JSON Schema a provider is handed.
 */
export const partInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().max(ASK_TEXT_MAX).describe("Context, not a question. Lightly formatted: paragraphs, lists, **bold**, *italic*, `code`, fenced code and [links](https://…). Images and HTML are shown as text.") }),
  z.object({ type: z.literal("code"), title: z.string().max(ASK_LABEL_MAX).optional(), code: codeInput }),
  z.object({
    type: z.literal("table"),
    columns: z.array(z.string().max(ASK_LABEL_MAX)).min(1).max(ASK_COLUMNS_MAX),
    rows: z.array(z.array(z.string().max(ASK_PROMPT_MAX))).min(1).max(ASK_ROWS_MAX),
  }),
  z.object({ type: z.literal("link"), label: z.string().max(ASK_LABEL_MAX), url: z.string().max(2_000) }),
  z.object({
    type: z.literal("choice"),
    id: z.string().max(80).describe("Stable and unique in the form: 'retry'. Answers come back keyed by it."),
    prompt: z.string().max(ASK_PROMPT_MAX),
    options: z.array(optionInput).min(1).max(ASK_OPTIONS_MAX),
    multiple: z.boolean().optional().describe("Several may be chosen."),
    recommended: z.array(z.string()).optional().describe("Labels to pick in advance: what you would choose."),
    allow_other: z.boolean().optional().describe("Add a field for an answer in the user's own words."),
    optional: z.boolean().optional().describe("May be left unanswered."),
  }),
  z.object({
    type: z.literal("pick"),
    id: z.string().max(80),
    prompt: z.string().max(ASK_PROMPT_MAX),
    items: z.array(optionInput).min(1).max(ASK_PICK_MAX).describe("A longer list to tick from: findings to fix, files to include."),
    picked: z.array(z.string()).optional().describe("Labels ticked in advance."),
  }),
  z.object({
    type: z.literal("rank"),
    id: z.string().max(80),
    prompt: z.string().max(ASK_PROMPT_MAX),
    options: z.array(optionInput).min(2).max(ASK_RANK_MAX).describe("In the order you would put them; the user reorders."),
  }),
  z.object({
    type: z.literal("answer"),
    id: z.string().max(80),
    prompt: z.string().max(ASK_PROMPT_MAX),
    long: z.boolean().optional().describe("Several lines rather than one."),
    draft: z.string().max(ASK_DRAFT_MAX).optional().describe("Text to start from, which the user edits."),
    placeholder: z.string().max(ASK_LABEL_MAX).optional(),
    optional: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("item"),
    id: z.string().max(80).describe("Stable and unique in the form: 'issue-101'."),
    title: z.string().max(ASK_TITLE_MAX),
    url: z.string().max(2_000).optional().describe("What the item is about on the web; the title links to it."),
    badges: z
      .array(z.object({ label: z.string().max(40), tone: z.enum(TONES).optional() }))
      .max(ASK_BADGES_MAX)
      .optional(),
    summary: z.string().max(ASK_TEXT_MAX).optional().describe("Shown under the title, formatted as a text part is."),
    code: codeInput.optional(),
    draft: z
      .object({
        label: z.string().max(ASK_LABEL_MAX).describe("What the text is: 'Comment to post'."),
        text: z.string().max(ASK_DRAFT_MAX),
        long: z.boolean().optional(),
      })
      .optional()
      .describe("Text the user edits before it is used. It comes back as they left it."),
    choices: z.array(optionInput).min(1).max(ASK_CHOICES_MAX).describe("What can be decided about this item."),
    recommended: z.string().optional().describe("The label of the choice you would make."),
  }),
]);
export type PartInput = z.infer<typeof partInput>;

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Line ends as one character, so a Windows line end is not read as a control character. */
function unixLines(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

function isWebUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export type Made = { ok: true; form: Form } | { ok: false; problem: string };

/**
 * The form as stored, or what is wrong with it, said so the agent can fix it.
 *
 * Refused rather than repaired: a label that repeats, a recommendation that
 * names no option, or text that would come back in the user's message holding
 * a character that does not show. Text that is only ever shown (a summary, a
 * table cell, code) is kept, with any such character shown as its code.
 */
export function makeForm(title: string, parts: readonly PartInput[], askedAt: string): Made {
  const problem = (text: string): Made => ({ ok: false, problem: text });
  const formTitle = oneLine(title);
  if (formTitle === "" || formTitle.length > ASK_TITLE_MAX) return problem("The form needs a title of at most 120 characters.");
  if (hasUnseen(formTitle)) return problem("The title holds a character that does not show on screen.");
  if (parts.length === 0) return problem("The form has no parts.");
  if (parts.length > ASK_PARTS_MAX) return problem(`The form has more than ${ASK_PARTS_MAX} parts.`);

  const ids = new Set<string>();
  const out: Part[] = [];

  /** Text that comes back in the answer: one line, and all of it visible. */
  const sent = (value: string, what: string): string | Made => {
    const text = oneLine(value);
    if (text === "") return problem(`${what} is empty.`);
    if (hasUnseen(text)) return problem(`${what} holds a character that does not show on screen.`);
    return text;
  };
  const shown = (value: string | undefined): string | null => {
    if (value === undefined || value.trim() === "") return null;
    return reveal(unixLines(value).trim());
  };
  const options = (list: readonly { label: string; description?: string | undefined }[], what: string): Option[] | Made => {
    const seen = new Set<string>();
    const kept: Option[] = [];
    for (const entry of list) {
      const label = sent(entry.label, `A label in ${what}`);
      if (typeof label !== "string") return label;
      if (seen.has(label)) return problem(`${what} has the label "${label}" twice.`);
      seen.add(label);
      const description = entry.description === undefined || entry.description.trim() === "" ? null : reveal(oneLine(entry.description));
      kept.push({ label, description });
    }
    return kept;
  };
  const code = (input: z.infer<typeof codeInput>, what: string): z.infer<typeof codeSchema> | Made => {
    if (input.text.trim() === "") return problem(`${what} has no text.`);
    const path = input.path === undefined || input.path.trim() === "" ? null : reveal(input.path.trim());
    if (input.diff === true && path === null) return problem(`${what} is a diff, so it needs the path of the file it changes.`);
    return { diff: input.diff === true, path, text: reveal(unixLines(input.text)) };
  };
  const identity = (raw: string, what: string): string | Made => {
    const id = raw.trim();
    if (id === "" || hasUnseen(id) || /\s/.test(id)) return problem(`${what} needs an id with no spaces: "retry", "issue-101".`);
    if (ids.has(id)) return problem(`The id "${id}" is used twice.`);
    ids.add(id);
    return id;
  };
  const isMade = (value: unknown): value is Made => typeof value === "object" && value !== null && "ok" in value;

  for (const part of parts) {
    switch (part.type) {
      case "text": {
        const text = shown(part.text);
        if (text === null) return problem("A text part is empty.");
        out.push({ type: "text", text });
        break;
      }
      case "code": {
        const made = code(part.code, "A code part");
        if (isMade(made)) return made;
        out.push({ type: "code", title: part.title === undefined || part.title.trim() === "" ? null : reveal(oneLine(part.title)), code: made });
        break;
      }
      case "table": {
        if (part.rows.some((row) => row.length !== part.columns.length)) {
          return problem("A table row does not have one cell per column.");
        }
        out.push({ type: "table", columns: part.columns.map((cell) => reveal(oneLine(cell))), rows: part.rows.map((row) => row.map((cell) => reveal(oneLine(cell)))) });
        break;
      }
      case "link": {
        const label = sent(part.label, "A link's label");
        if (typeof label !== "string") return label;
        if (!isWebUrl(part.url) || hasUnseen(part.url)) return problem(`The link "${label}" needs an http or https address.`);
        out.push({ type: "link", label, url: part.url });
        break;
      }
      case "choice": {
        const id = identity(part.id, "A choice");
        if (typeof id !== "string") return id;
        const prompt = sent(part.prompt, `The question "${id}"`);
        if (typeof prompt !== "string") return prompt;
        const list = options(part.options, `the question "${id}"`);
        if (isMade(list)) return list;
        const allowOther = part.allow_other === true;
        if (list.length < 2 && !allowOther) return problem(`The question "${id}" needs at least two options, or allow_other.`);
        const recommended = (part.recommended ?? []).map(oneLine);
        if (recommended.some((label) => !list.some((option) => option.label === label))) {
          return problem(`The question "${id}" recommends a label that is not one of its options.`);
        }
        if (part.multiple !== true && recommended.length > 1) {
          return problem(`The question "${id}" takes one answer but recommends several.`);
        }
        out.push({ type: "choice", id, prompt, options: list, multiple: part.multiple === true, recommended, allowOther, optional: part.optional === true });
        break;
      }
      case "pick": {
        const id = identity(part.id, "A pick list");
        if (typeof id !== "string") return id;
        const prompt = sent(part.prompt, `The list "${id}"`);
        if (typeof prompt !== "string") return prompt;
        const list = options(part.items, `the list "${id}"`);
        if (isMade(list)) return list;
        const picked = (part.picked ?? []).map(oneLine);
        if (picked.some((label) => !list.some((option) => option.label === label))) {
          return problem(`The list "${id}" ticks a label that is not one of its items.`);
        }
        out.push({ type: "pick", id, prompt, items: list, picked });
        break;
      }
      case "rank": {
        const id = identity(part.id, "A ranking");
        if (typeof id !== "string") return id;
        const prompt = sent(part.prompt, `The ranking "${id}"`);
        if (typeof prompt !== "string") return prompt;
        const list = options(part.options, `the ranking "${id}"`);
        if (isMade(list)) return list;
        out.push({ type: "rank", id, prompt, options: list });
        break;
      }
      case "answer": {
        const id = identity(part.id, "An answer");
        if (typeof id !== "string") return id;
        const prompt = sent(part.prompt, `The question "${id}"`);
        if (typeof prompt !== "string") return prompt;
        const draft = unixLines(part.draft ?? "");
        if (hasUnseen(draft)) return problem(`The draft for "${id}" holds a character that does not show on screen.`);
        const placeholder = part.placeholder === undefined || part.placeholder.trim() === "" ? null : reveal(oneLine(part.placeholder));
        out.push({ type: "answer", id, prompt, long: part.long === true, draft, placeholder, optional: part.optional === true });
        break;
      }
      case "item": {
        const id = identity(part.id, "An item");
        if (typeof id !== "string") return id;
        const itemTitle = sent(part.title, `The item "${id}"'s title`);
        if (typeof itemTitle !== "string") return itemTitle;
        const url = part.url === undefined || part.url.trim() === "" ? null : part.url.trim();
        if (url !== null && (!isWebUrl(url) || hasUnseen(url))) return problem(`The item "${id}" needs an http or https address, or none.`);
        const badges: ItemPart["badges"] = [];
        for (const badge of part.badges ?? []) {
          const label = oneLine(badge.label);
          if (label !== "") badges.push({ label: reveal(label), tone: badge.tone ?? "neutral" });
        }
        const summary = shown(part.summary);
        const itemCode = part.code === undefined ? null : code(part.code, `The item "${id}"'s code`);
        if (isMade(itemCode)) return itemCode;
        let draft: ItemPart["draft"] = null;
        if (part.draft !== undefined) {
          const label = sent(part.draft.label, `The item "${id}"'s draft label`);
          if (typeof label !== "string") return label;
          const text = unixLines(part.draft.text);
          if (hasUnseen(text)) return problem(`The item "${id}"'s draft holds a character that does not show on screen.`);
          draft = { label, text, long: part.draft.long !== false };
        }
        const choices = options(part.choices, `the item "${id}"`);
        if (isMade(choices)) return choices;
        const recommended = part.recommended === undefined ? null : oneLine(part.recommended);
        if (recommended !== null && !choices.some((option) => option.label === recommended)) {
          return problem(`The item "${id}" recommends a label that is not one of its choices.`);
        }
        out.push({ type: "item", id, title: itemTitle, url, badges, summary, code: itemCode, draft, choices, recommended });
        break;
      }
    }
  }
  if (!out.some(isAnswerable)) return problem("The form asks nothing: it needs a choice, a pick list, a ranking, an answer or an item.");
  return { ok: true, form: { askedAt, title: formTitle, parts: out, done: {}, keepThrough: false } };
}

/** The form as stored, or null for anything that is not one. */
export function parseForm(value: unknown): Form | null {
  const parsed = formSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function isQuestion(part: Part): part is QuestionPart {
  return part.type === "choice" || part.type === "pick" || part.type === "rank" || part.type === "answer";
}

export function isAnswerable(part: Part): part is QuestionPart | ItemPart {
  return isQuestion(part) || part.type === "item";
}

/** The questions still to answer, which are answered together. */
export function openQuestions(form: Form): QuestionPart[] {
  return form.parts.filter(isQuestion).filter((part) => !(part.id in form.done));
}

/** The items still to decide. */
export function openItems(form: Form): ItemPart[] {
  return form.parts.filter((part): part is ItemPart => part.type === "item").filter((part) => !(part.id in form.done));
}

/** Nothing left to answer: the form has done its job and goes. */
export function isSpent(form: Form): boolean {
  return openQuestions(form).length === 0 && openItems(form).length === 0;
}

// --- answering ----------------------------------------------------------------

export const answerSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("choice"),
    selected: z.array(z.string().max(ASK_LABEL_MAX)).max(ASK_OPTIONS_MAX),
    other: z.string().max(ASK_ANSWER_MAX).optional(),
  }),
  z.object({ type: z.literal("pick"), picked: z.array(z.string().max(ASK_LABEL_MAX)).max(ASK_PICK_MAX) }),
  z.object({ type: z.literal("rank"), order: z.array(z.string().max(ASK_LABEL_MAX)).max(ASK_RANK_MAX) }),
  z.object({ type: z.literal("answer"), text: z.string().max(ASK_ANSWER_MAX) }),
  z.object({ type: z.literal("item"), choice: z.string().max(ASK_LABEL_MAX), draft: z.string().max(ASK_DRAFT_MAX).optional() }),
]);
export type Answer = z.infer<typeof answerSchema>;
export type Answers = Record<string, Answer>;

/** The answers a form opens with: what the agent recommended, ticked or drafted. */
export function startingAnswers(form: Form): Answers {
  const answers: Answers = {};
  for (const part of openQuestions(form)) {
    if (part.type === "choice") answers[part.id] = { type: "choice", selected: [...part.recommended] };
    else if (part.type === "pick") answers[part.id] = { type: "pick", picked: [...part.picked] };
    else if (part.type === "rank") answers[part.id] = { type: "rank", order: part.options.map((option) => option.label) };
    else answers[part.id] = { type: "answer", text: part.draft };
  }
  return answers;
}

function isOptional(part: QuestionPart): boolean {
  return (part.type === "choice" || part.type === "answer") && part.optional;
}

function isAnswered(part: QuestionPart, answer: Answer | undefined): boolean {
  if (answer === undefined || answer.type !== part.type) return false;
  switch (answer.type) {
    case "choice":
      return answer.selected.length > 0 || (answer.other ?? "").trim() !== "";
    case "answer":
      return answer.text.trim() !== "";
    // An empty tick list and an untouched order are answers too.
    case "pick":
    case "rank":
      return true;
    default:
      return false;
  }
}

/**
 * What is wrong with a set of answers, or null when it can be sent.
 *
 * The questions go together and first: while any is open, a send has to
 * answer every one that is not optional. Items come as they are decided. And
 * an answer can only name what is on the form: a label that is not an option
 * of its part is refused, never passed through.
 */
export function answerProblem(form: Form, answers: Answers): string | null {
  const parts = new Map(form.parts.filter(isAnswerable).map((part) => [part.id, part]));
  if (Object.keys(answers).length === 0) return "There is nothing to send yet.";
  for (const [id, answer] of Object.entries(answers)) {
    const part = parts.get(id);
    if (part === undefined) return "That answers something the form does not ask.";
    if (id in form.done) return "That was already answered.";
    if (part.type !== answer.type) return "That answer does not fit its question.";
    const within = (labels: readonly string[], list: readonly Option[]) =>
      new Set(labels).size === labels.length && labels.every((label) => list.some((option) => option.label === label));
    if (part.type === "choice" && answer.type === "choice") {
      if (!within(answer.selected, part.options)) return "That answer names an option the question does not have.";
      const own = (answer.other ?? "").trim() !== "";
      if (own && !part.allowOther) return "That question does not take an answer of your own.";
      if (!part.multiple && answer.selected.length + (own ? 1 : 0) > 1) return "That question takes one answer.";
    } else if (part.type === "pick" && answer.type === "pick") {
      if (!within(answer.picked, part.items)) return "That ticks something the list does not have.";
    } else if (part.type === "rank" && answer.type === "rank") {
      if (answer.order.length !== part.options.length || !within(answer.order, part.options)) {
        return "A ranking has to place every option once.";
      }
    } else if (part.type === "item" && answer.type === "item") {
      if (!part.choices.some((option) => option.label === answer.choice)) return "That is not one of the item's choices.";
      if (answer.draft !== undefined && part.draft === null) return "That item has no draft to edit.";
    }
  }
  // The questions lead: the first message answers them all, and only then do
  // items go one by one.
  const missing = openQuestions(form).find((part) => !isAnswered(part, answers[part.id]) && !isOptional(part));
  return missing === undefined ? null : `Still to answer: ${missing.prompt}`;
}

function indent(text: string, by: string): string {
  return text
    .split("\n")
    .map((line) => `${by}${line}`)
    .join("\n");
}

/** How one answer reads, on the form once it is done and in the message. */
function answerLine(part: QuestionPart | ItemPart, answer: Answer): string {
  if (part.type === "choice" && answer.type === "choice") {
    const other = (answer.other ?? "").trim();
    return [...answer.selected, ...(other === "" ? [] : [other])].join(", ");
  }
  if (part.type === "pick" && answer.type === "pick") return answer.picked.length === 0 ? "None" : answer.picked.join(", ");
  if (part.type === "rank" && answer.type === "rank") return answer.order.map((label, index) => `${index + 1}. ${label}`).join("  ");
  if (part.type === "answer" && answer.type === "answer") return answer.text.trim();
  if (part.type === "item" && answer.type === "item") return answer.choice;
  return "";
}

export interface Composed {
  /** The message as the user reads it before it goes, and as it is sent. */
  text: string;
  /** The same answers keyed by part id, for the agent alone. */
  exact: string;
  /** The form after this answer: what it has done, and whether anything is left. */
  form: Form;
}

/**
 * The message an answer sends, and the form it leaves. Call `answerProblem`
 * first; this assumes the answers fit.
 *
 * Everything in `text` is either a label or prompt from the form, which the
 * user was looking at, or something they typed. The agent gets the same in
 * `exact`, keyed by id, so it need not parse prose.
 */
export function composeAnswer(form: Form, answers: Answers): Composed {
  const questions = openQuestions(form);
  const lines: string[] = [questions.length > 0 ? `My answers to “${form.title}”:` : `On “${form.title}”:`];
  const exact: { form: string; askedAt: string; answers: Record<string, unknown>; items: Record<string, unknown>; undecided: string[] } = {
    form: form.title,
    askedAt: form.askedAt,
    answers: {},
    items: {},
    undecided: [],
  };
  const done = { ...form.done };

  if (questions.length > 0) lines.push("");
  questions.forEach((part, index) => {
    // An optional question left blank is said so, and is done with all the same.
    const answer = answers[part.id];
    const line = answer !== undefined && isAnswered(part, answer) ? answerLine(part, answer) : "";
    lines.push(`${index + 1}. ${part.prompt}`);
    lines.push(indent(line === "" ? "(no answer)" : line, "   "));
    done[part.id] = line === "" ? "No answer" : line;
    if (answer === undefined || line === "") exact.answers[part.id] = null;
    else if (answer.type === "choice") exact.answers[part.id] = { selected: answer.selected, ...((answer.other ?? "").trim() === "" ? {} : { other: (answer.other ?? "").trim() }) };
    else if (answer.type === "pick") exact.answers[part.id] = { picked: answer.picked };
    else if (answer.type === "rank") exact.answers[part.id] = { order: answer.order };
    else if (answer.type === "answer") exact.answers[part.id] = { text: answer.text.trim() };
  });
  const items = openItems(form).filter((part) => part.id in answers);
  if (items.length > 0 && questions.length > 0) lines.push("", "And my decisions:");
  else if (items.length > 0) lines.push("");
  for (const part of items) {
    const answer = answers[part.id]!;
    if (answer.type !== "item") continue;
    lines.push(`- ${part.title}: ${answer.choice}`);
    done[part.id] = answer.choice;
    const entry: Record<string, unknown> = { choice: answer.choice };
    if (part.draft !== null) {
      const text = answer.draft ?? part.draft.text;
      const edited = text !== part.draft.text;
      entry.draft = text;
      entry.draftEdited = edited;
      if (edited) lines.push(`  ${part.draft.label}, as I edited it:`, indent(text.trim() === "" ? "(empty)" : text.trim(), "  > "));
      else lines.push(`  ${part.draft.label}: as you drafted it.`);
    }
    exact.items[part.id] = entry;
  }
  const next: Form = { ...form, done, keepThrough: false };
  exact.undecided = openItems(next).map((part) => part.id);
  if (exact.undecided.length > 0) {
    lines.push("", `${exact.undecided.length === 1 ? "1 item is" : `${exact.undecided.length} items are`} still undecided.`);
  }
  return {
    text: lines.join("\n"),
    exact: `[Follow Up: the same answers, keyed by id, for you alone]\n${JSON.stringify(exact)}`,
    // The turn this message starts must not clear the items still open.
    form: { ...next, keepThrough: !isSpent(next) },
  };
}
