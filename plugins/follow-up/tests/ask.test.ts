// ask_form's rules: what makes a form, what an answer may say, and the message
// answering sends. Pure, so every rule is checked without a running bb.
import assert from "node:assert/strict";
import test from "node:test";
import {
  answerProblem,
  ASK_PARTS_MAX,
  composeAnswer,
  isSpent,
  makeForm,
  openItems,
  openQuestions,
  parseForm,
  startingAnswers,
  type Answers,
  type Form,
  type PartInput,
} from "../lib/ask.ts";

const AT = "2026-10-09T12:00:00.000Z";

const retry: PartInput = {
  type: "choice",
  id: "retry",
  prompt: "How should a failed upload retry?",
  options: [{ label: "Back off, up to an hour", description: "Survives a long outage." }, { label: "Retry at once, 3 times" }],
  recommended: ["Back off, up to an hour"],
};
const screens: PartInput = { type: "pick", id: "screens", prompt: "Which screens get the badge?", items: [{ label: "Inbox" }, { label: "Compose" }, { label: "Settings" }], picked: ["Inbox"] };
const order: PartInput = { type: "rank", id: "order", prompt: "What first?", options: [{ label: "Queue" }, { label: "Badge" }, { label: "Docs" }] };
const more: PartInput = { type: "answer", id: "more", prompt: "Anything else?", optional: true };
const issue = (n: number, extra: Partial<Extract<PartInput, { type: "item" }>> = {}): PartInput => ({
  type: "item",
  id: `issue-${n}`,
  title: `#${n} An issue`,
  choices: [{ label: "Close it" }, { label: "Leave open" }],
  ...extra,
});

function form(parts: PartInput[], title = "Offline queue"): Form {
  const made = makeForm(title, parts, AT);
  if (!made.ok) throw new Error(made.problem);
  return made.form;
}

const problemOf = (parts: PartInput[], title = "T") => {
  const made = makeForm(title, parts, AT);
  return made.ok ? null : made.problem;
};

// --- making a form ----------------------------------------------------------------

test("makeForm: fills the defaults, and keeps the parts in order", () => {
  const made = form([{ type: "text", text: " Two things. " }, retry, more, issue(101)]);
  assert.deepEqual(
    made.parts.map((part) => part.type),
    ["text", "choice", "answer", "item"],
  );
  assert.deepEqual(made.parts[1], {
    type: "choice",
    id: "retry",
    prompt: "How should a failed upload retry?",
    options: [
      { label: "Back off, up to an hour", description: "Survives a long outage." },
      { label: "Retry at once, 3 times", description: null },
    ],
    multiple: false,
    recommended: ["Back off, up to an hour"],
    allowOther: false,
    optional: false,
  });
  assert.deepEqual(made.parts[3], { type: "item", id: "issue-101", title: "#101 An issue", url: null, badges: [], summary: null, code: null, draft: null, choices: [{ label: "Close it", description: null }, { label: "Leave open", description: null }], recommended: null });
  assert.deepEqual({ askedAt: made.askedAt, title: made.title, done: made.done, keepThrough: made.keepThrough }, { askedAt: AT, title: "Offline queue", done: {}, keepThrough: false });
  assert.deepEqual(parseForm(JSON.parse(JSON.stringify(made))), made, "it survives being stored");
  assert.equal(parseForm({ title: "x" }), null);
});

test("makeForm: a form has to ask something, and not too much", () => {
  assert.match(problemOf([{ type: "text", text: "Just so you know." }]) ?? "", /asks nothing/);
  assert.match(problemOf([]) ?? "", /no parts/);
  assert.match(problemOf(Array.from({ length: ASK_PARTS_MAX + 1 }, (_, n) => issue(n))) ?? "", /more than 40 parts/);
  assert.equal(problemOf(Array.from({ length: ASK_PARTS_MAX }, (_, n) => issue(n))), null);
  assert.match(problemOf([retry], "  ") ?? "", /needs a title/);
});

test("makeForm: ids are unique, and labels within a part are too", () => {
  assert.match(problemOf([retry, { ...more, id: "retry" }]) ?? "", /"retry" is used twice/);
  assert.match(problemOf([{ ...retry, id: "has space" }]) ?? "", /id with no spaces/);
  assert.match(problemOf([{ ...retry, options: [{ label: "Yes" }, { label: " Yes " }], recommended: [] }]) ?? "", /"Yes" twice/);
  assert.match(problemOf([issue(1, { choices: [{ label: "A" }, { label: "A" }] })]) ?? "", /"A" twice/);
});

test("makeForm: a recommendation has to name what is there", () => {
  assert.match(problemOf([{ ...retry, recommended: ["Never"] }]) ?? "", /recommends a label that is not one of its options/);
  assert.match(problemOf([{ ...retry, recommended: ["Back off, up to an hour", "Retry at once, 3 times"] }]) ?? "", /takes one answer but recommends several/);
  assert.equal(problemOf([{ ...retry, multiple: true, recommended: ["Back off, up to an hour", "Retry at once, 3 times"] }]), null);
  assert.match(problemOf([{ ...screens, picked: ["Nowhere"] }]) ?? "", /ticks a label that is not one of its items/);
  assert.match(problemOf([issue(1, { recommended: "Burn it" })]) ?? "", /recommends a label that is not one of its choices/);
  assert.equal(problemOf([issue(1, { recommended: "Close it" })]), null);
});

test("makeForm: one option is a question only with an answer of your own", () => {
  assert.match(problemOf([{ ...retry, options: [{ label: "Yes" }], recommended: [] }]) ?? "", /at least two options, or allow_other/);
  assert.equal(problemOf([{ ...retry, options: [{ label: "Yes" }], recommended: [], allow_other: true }]), null);
});

test("makeForm: nothing that comes back in the answer may hold a character that does not show", () => {
  const z = "​";
  const hidden = /does not show on screen/;
  assert.match(problemOf([retry], `Queue${z}`) ?? "", hidden);
  assert.match(problemOf([{ ...retry, prompt: `How${z}?` }]) ?? "", hidden);
  assert.match(problemOf([{ ...retry, options: [{ label: `Yes${z}` }, { label: "No" }], recommended: [] }]) ?? "", hidden);
  assert.match(problemOf([{ ...more, draft: `start${z}` }]) ?? "", hidden);
  assert.match(problemOf([issue(1, { title: `#1${z}` })]) ?? "", hidden);
  assert.match(problemOf([issue(1, { draft: { label: "Comment", text: `Hi‮` } })]) ?? "", hidden);
  assert.match(problemOf([issue(1, { draft: { label: `Comment${z}`, text: "Hi" } })]) ?? "", hidden);
  assert.match(problemOf([retry, { type: "link", label: `Docs${z}`, url: "https://example.com" }]) ?? "", hidden);
  // A draft keeps its line breaks, Windows ones included, and emoji are fine.
  const made = form([{ ...more, draft: "one\r\ntwo ✅" }, issue(1, { draft: { label: "Comment", text: "a\r\nb" } })]);
  assert.equal(made.parts[0]?.type === "answer" ? made.parts[0].draft : null, "one\ntwo ✅");
  assert.equal(made.parts[1]?.type === "item" ? made.parts[1].draft?.text : null, "a\nb");
});

test("makeForm: text that is only shown is kept, with unseen characters shown as their code", () => {
  const made = form([
    { type: "text", text: "Read​ this" },
    { type: "code", title: "The​ guard", code: { text: "if (admin‮) {" } },
    { type: "table", columns: ["A​"], rows: [["b​"]] },
    { ...retry, options: [{ label: "Yes", description: "Safe​" }, { label: "No" }], recommended: [] },
    issue(1, { summary: "Twice​ reported", badges: [{ label: "Hot​", tone: "warning" }, { label: " " }], code: { text: "+x​", path: "a.ts", diff: true } }),
  ]);
  assert.equal(made.parts[0]?.type === "text" ? made.parts[0].text : null, "Read⟦U+200B⟧ this");
  assert.deepEqual(made.parts[1], { type: "code", title: "The⟦U+200B⟧ guard", code: { diff: false, path: null, text: "if (admin⟦U+202E⟧) {" } });
  assert.deepEqual(made.parts[2], { type: "table", columns: ["A⟦U+200B⟧"], rows: [["b⟦U+200B⟧"]] });
  assert.equal(made.parts[3]?.type === "choice" ? made.parts[3].options[0]?.description : null, "Safe⟦U+200B⟧");
  const item = made.parts[4];
  assert.equal(item?.type, "item");
  if (item?.type !== "item") return;
  assert.equal(item.summary, "Twice⟦U+200B⟧ reported");
  assert.deepEqual(item.badges, [{ label: "Hot⟦U+200B⟧", tone: "warning" }], "an empty badge is dropped");
  assert.deepEqual(item.code, { diff: true, path: "a.ts", text: "+x⟦U+200B⟧" });
});

test("makeForm: no images, and links go to the web", () => {
  for (const text of ["See ![shot](https://x.test/a.png)", "See ![shot][ref]", 'See <img src="/etc/passwd">']) {
    assert.match(problemOf([{ type: "text", text }, retry]) ?? "", /holds an image/, text);
    assert.match(problemOf([issue(1, { summary: text })]) ?? "", /holds an image/, text);
  }
  assert.equal(problemOf([{ type: "text", text: "A [link](https://x.test) and an exclamation!" }, retry]), null);
  for (const url of ["javascript:alert(1)", "file:///etc/passwd", "not a url", "https://x.test/​"]) {
    assert.match(problemOf([retry, { type: "link", label: "Docs", url }]) ?? "", /http or https address/, url);
    assert.match(problemOf([issue(1, { url })]) ?? "", /http or https address/, url);
  }
  assert.equal(problemOf([retry, { type: "link", label: "Docs", url: "https://x.test/a" }, issue(1, { url: "http://x.test" })]), null);
});

test("makeForm: a diff names its file, and a table is square", () => {
  assert.match(problemOf([retry, { type: "code", code: { text: "+x", diff: true } }]) ?? "", /needs the path/);
  assert.match(problemOf([retry, { type: "code", code: { text: "  " } }]) ?? "", /has no text/);
  assert.match(problemOf([retry, { type: "table", columns: ["A", "B"], rows: [["1"]] }]) ?? "", /one cell per column/);
});

// --- answering ----------------------------------------------------------------------

test("startingAnswers: what the agent recommended is picked, ticked, ordered and drafted", () => {
  const made = form([retry, screens, order, { ...more, draft: "Start" }, issue(1, { recommended: "Close it" })]);
  assert.deepEqual(startingAnswers(made), {
    retry: { type: "choice", selected: ["Back off, up to an hour"] },
    screens: { type: "pick", picked: ["Inbox"] },
    order: { type: "rank", order: ["Queue", "Badge", "Docs"] },
    more: { type: "answer", text: "Start" },
  });
  assert.equal(answerProblem(made, startingAnswers(made)), null, "agreeing with every recommendation is one press");
});

test("answerProblem: the questions go together, and first", () => {
  const made = form([{ ...retry, recommended: [] }, { ...more, optional: false }, more2(), issue(1)]);
  assert.equal(answerProblem(made, {}), "There is nothing to send yet.");
  assert.equal(answerProblem(made, { "issue-1": { type: "item", choice: "Close it" } }), "Still to answer: How should a failed upload retry?", "an item cannot go ahead of the questions");
  assert.equal(answerProblem(made, { retry: { type: "choice", selected: ["Retry at once, 3 times"] } }), "Still to answer: Anything else?");
  const all: Answers = { retry: { type: "choice", selected: ["Retry at once, 3 times"] }, more: { type: "answer", text: "No" } };
  assert.equal(answerProblem(made, all), null, "an optional question may be left out");
  assert.equal(answerProblem(made, { ...all, more: { type: "answer", text: "   " } }), "Still to answer: Anything else?");
});
function more2(): PartInput {
  return { type: "answer", id: "aside", prompt: "An aside?", optional: true };
}

test("answerProblem: an answer can only name what is on the form", () => {
  const made = form([retry, { ...retry, id: "many", multiple: true, allow_other: true, recommended: [] }, screens, order, issue(1, { draft: { label: "Comment", text: "Hi" } }), issue(2)]);
  const base = startingAnswers(made);
  const bad = (answers: Answers) => answerProblem(made, { ...base, many: { type: "choice", selected: ["Back off, up to an hour"] }, ...answers });
  assert.equal(bad({}), null);
  assert.equal(bad({ nope: { type: "answer", text: "x" } }), "That answers something the form does not ask.");
  assert.equal(bad({ retry: { type: "answer", text: "x" } }), "That answer does not fit its question.");
  assert.equal(bad({ retry: { type: "choice", selected: ["Never"] } }), "That answer names an option the question does not have.");
  assert.equal(bad({ retry: { type: "choice", selected: ["Back off, up to an hour", "Retry at once, 3 times"] } }), "That question takes one answer.");
  assert.equal(bad({ retry: { type: "choice", selected: [], other: "My way" } }), "That question does not take an answer of your own.");
  assert.equal(bad({ many: { type: "choice", selected: ["Back off, up to an hour", "Retry at once, 3 times"], other: "And this" } }), null);
  assert.equal(bad({ many: { type: "choice", selected: ["Back off, up to an hour", "Back off, up to an hour"] } }), "That answer names an option the question does not have.");
  assert.equal(bad({ screens: { type: "pick", picked: ["Nowhere"] } }), "That ticks something the list does not have.");
  assert.equal(bad({ screens: { type: "pick", picked: [] } }), null, "ticking nothing is an answer");
  assert.equal(bad({ order: { type: "rank", order: ["Queue", "Badge"] } }), "A ranking has to place every option once.");
  assert.equal(bad({ order: { type: "rank", order: ["Queue", "Queue", "Docs"] } }), "A ranking has to place every option once.");
  assert.equal(bad({ order: { type: "rank", order: ["Docs", "Queue", "Badge"] } }), null);
  assert.equal(bad({ "issue-1": { type: "item", choice: "Burn it" } }), "That is not one of the item's choices.");
  assert.equal(bad({ "issue-2": { type: "item", choice: "Close it", draft: "sneaked in" } }), "That item has no draft to edit.");
  assert.equal(bad({ "issue-1": { type: "item", choice: "Close it", draft: "Edited" } }), null);
});

test("answerProblem: one answer of your own is the one answer", () => {
  const made = form([{ ...retry, allow_other: true, recommended: [] }]);
  assert.equal(answerProblem(made, { retry: { type: "choice", selected: [], other: "Never retry" } }), null);
  assert.equal(answerProblem(made, { retry: { type: "choice", selected: ["Retry at once, 3 times"], other: "And never" } }), "That question takes one answer.");
});

test("composeAnswer: the message is the form's own words and yours, numbered", () => {
  const made = form([retry, screens, order, more]);
  const composed = composeAnswer(made, {
    retry: { type: "choice", selected: ["Back off, up to an hour"] },
    screens: { type: "pick", picked: ["Inbox", "Compose"] },
    order: { type: "rank", order: ["Badge", "Queue", "Docs"] },
    more: { type: "answer", text: " Ship it\nby Friday. " },
  });
  assert.equal(
    composed.text,
    [
      "My answers to “Offline queue”:",
      "",
      "1. How should a failed upload retry?",
      "   Back off, up to an hour",
      "2. Which screens get the badge?",
      "   Inbox, Compose",
      "3. What first?",
      "   1. Badge  2. Queue  3. Docs",
      "4. Anything else?",
      "   Ship it",
      "   by Friday.",
    ].join("\n"),
  );
  const [header, json] = composed.exact.split("\n");
  assert.equal(header, "[Follow Up: the same answers, keyed by id, for you alone]");
  assert.deepEqual(JSON.parse(json ?? ""), {
    form: "Offline queue",
    askedAt: AT,
    answers: {
      retry: { selected: ["Back off, up to an hour"] },
      screens: { picked: ["Inbox", "Compose"] },
      order: { order: ["Badge", "Queue", "Docs"] },
      more: { text: "Ship it\nby Friday." },
    },
    items: {},
    undecided: [],
  });
  assert.equal(isSpent(composed.form), true);
  assert.equal(composed.form.keepThrough, false);
  assert.deepEqual(composed.form.done, { retry: "Back off, up to an hour", screens: "Inbox, Compose", order: "1. Badge  2. Queue  3. Docs", more: "Ship it\nby Friday." });
});

test("composeAnswer: an optional question left blank is said so, and is done with", () => {
  const made = form([{ ...retry, allow_other: true }, more, { ...screens, picked: [] }]);
  const composed = composeAnswer(made, { retry: { type: "choice", selected: [], other: " Never retry " }, screens: { type: "pick", picked: [] } });
  assert.match(composed.text, /1\. How should a failed upload retry\?\n   Never retry\n2\. Anything else\?\n   \(no answer\)\n3\. Which screens get the badge\?\n   None$/);
  assert.deepEqual(JSON.parse(composed.exact.split("\n")[1] ?? "").answers, { retry: { selected: [], other: "Never retry" }, more: null, screens: { picked: [] } });
  assert.deepEqual(openQuestions(composed.form), []);
  assert.equal(composed.form.done.more, "No answer");
});

test("composeAnswer: items go one by one, and the form outlives its first answer while one is undecided", () => {
  const made = form([retry, issue(101), issue(118, { draft: { label: "Comment to post", text: "Which file type?" } }), issue(124, { draft: { label: "Task", text: "Rename it" } })]);
  const first = composeAnswer(made, {
    retry: { type: "choice", selected: ["Back off, up to an hour"] },
    "issue-101": { type: "item", choice: "Close it" },
    "issue-118": { type: "item", choice: "Leave open", draft: "Which file type,\nand how big?" },
  });
  assert.equal(
    first.text,
    [
      "My answers to “Offline queue”:",
      "",
      "1. How should a failed upload retry?",
      "   Back off, up to an hour",
      "",
      "And my decisions:",
      "- #101 An issue: Close it",
      "- #118 An issue: Leave open",
      "  Comment to post, as I edited it:",
      "  > Which file type,",
      "  > and how big?",
      "",
      "1 item is still undecided.",
    ].join("\n"),
  );
  const exact = JSON.parse(first.exact.split("\n")[1] ?? "");
  assert.deepEqual(exact.items, { "issue-101": { choice: "Close it" }, "issue-118": { choice: "Leave open", draft: "Which file type,\nand how big?", draftEdited: true } });
  assert.deepEqual(exact.undecided, ["issue-124"]);
  assert.equal(isSpent(first.form), false);
  assert.equal(first.form.keepThrough, true, "the turn this starts must not clear what is still open");
  assert.deepEqual(openItems(first.form).map((part) => part.id), ["issue-124"]);
  assert.equal(answerProblem(first.form, { "issue-101": { type: "item", choice: "Leave open" } }), "That was already answered.");

  // The last item, on its own: no questions left to lead with.
  const second = composeAnswer(first.form, { "issue-124": { type: "item", choice: "Close it" } });
  assert.equal(second.text, ["On “Offline queue”:", "", "- #124 An issue: Close it", "  Task: as you drafted it."].join("\n"));
  assert.deepEqual(JSON.parse(second.exact.split("\n")[1] ?? "").items, { "issue-124": { choice: "Close it", draft: "Rename it", draftEdited: false } });
  assert.equal(isSpent(second.form), true);
  assert.equal(second.form.keepThrough, false);
});

test("composeAnswer: two undecided items are counted, and an emptied draft is said to be empty", () => {
  const made = form([issue(1, { draft: { label: "Comment", text: "Hi" } }), issue(2), issue(3)]);
  const composed = composeAnswer(made, { "issue-1": { type: "item", choice: "Close it", draft: "  " } });
  assert.match(composed.text, /Comment, as I edited it:\n  > \(empty\)\n\n2 items are still undecided\.$/);
});
