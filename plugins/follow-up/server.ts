// bb-plugin-follow-up — backend entry.
//
// Agents call `record_follow_up` while they work; the composer banner and the
// `bb follow-up` CLI read and triage what a thread accumulated.
//
// Deliberately absent: any background model call. Capture happens inside a
// turn the agent is already running, which is the whole point of the design.
import { randomUUID } from "node:crypto";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { takeValueFlags } from "./lib/argv.ts";
import {
  addFollowUp,
  type AddOutcome,
  amendFollowUp,
  CAP_CEILING,
  EXPANSION_TURNS,
  EXPANSION_WORD_CAP,
  houseStyleBlock,
  applyOrder,
  applyTombstones,
  DETAIL_MAX,
  doneFollowUps,
  formatList,
  formatListForAgent,
  handoffPrompt,
  isDone,
  markHandoffState,
  carriedFromChild,
  isExpanding,
  backfillRequest,
  expansionPrompt,
  authorOf,
  matchFollowUp,
  MAX_PER_THREAD,
  AUTO_COLLAPSE_AT,
  moveFollowUp,
  normalizeKey,
  openFollowUps,
  REASONS,
  TEXT_MAX,
  type FollowUp,
} from "./lib/followups.ts";

/**
 * What the expansion helper runs on, when it is not the project's defaults.
 *
 * The shape is `ExperimentalProviderModelPickerValue` — the value bb's own
 * picker emits, documented as existing to be forwarded verbatim to
 * `threads.spawn`. Modelling it here rather than reusing the host type keeps
 * the wire validated, and the two cannot drift far: the picker only ever emits
 * a coherent selection.
 *
 * `model` is `min(1)` on purpose. It is the one field that can be absent while
 * a selection is half-made, and a spawn carrying an empty model would fail
 * where falling back to the project default would have worked. Refusing to
 * store it is what makes the fallback the only other outcome.
 */
const expansionExecutionSchema = z
  .object({
    providerId: z.string().min(1).max(120),
    model: z.string().min(1).max(200),
    reasoningLevel: z.enum([
      "none",
      "low",
      "medium",
      "high",
      "xhigh",
      "ultracode",
      "max",
      "ultra",
    ]),
    serviceTier: z.enum(["fast", "default"]).optional(),
  })
  .strict();

type ExpansionExecution = z.infer<typeof expansionExecutionSchema>;

/** Global, not per-thread: settings have no project or thread scope. */
const EXECUTION_KEY = "expansion-execution";

/**
 * The version stamped into `getFollowUpCountsV1`'s payload.
 *
 * A consumer reads this before it reads anything else. Without it, a payload
 * that changed shape is indistinguishable from a thread with no follow-ups —
 * both leave a consumer holding nothing — so a break would show up as a badge
 * that quietly stopped drawing rather than as an error anybody could act on.
 * Bump it when the shape changes; add fields without bumping it.
 */
const FOLLOW_UP_COUNTS_PROTOCOL = 1 as const;

/**
 * How many threads one counts call may ask about.
 *
 * A sidebar's worth, with room. The point of the method is that a caller asks
 * once for everything on screen, so the limit has to be above any plausible
 * screen — but it is still a limit, because the request costs one storage read
 * per thread and an unbounded array is an unbounded amount of work.
 */
const COUNTS_MAX_THREADS = 500;

const followUpSchema = z.object({
  id: z.string(),
  text: z.string(),
  reason: z.enum(REASONS).nullable(),
  file: z.string().nullable(),
  detail: z.string().nullable(),
  createdAt: z.string(),
  sentAt: z.string().nullable().optional(),
  handoffThreadId: z.string().nullable().optional(),
  handoffState: z.enum(["running", "finished", "failed"]).nullable().optional(),
  inheritedFrom: z.string().nullable().optional(),
  expandingSince: z.string().nullable().optional(),
  expandedBy: z.string().nullable().optional(),
  expandOutcome: z.enum(["described", "unresolved"]).nullable().optional(),
  doneAt: z.string().nullable().optional(),
  doneBy: z.enum(["agent", "user"]).nullable().optional(),
  doneNote: z.string().nullable().optional(),
  createdBy: z.enum(["agent", "user"]).nullable().optional(),
});

export const rpcContract = defineRpcContract({
  followups_list: {
    input: z.object({ threadId: z.string().min(1).max(200) }).strict(),
    output: z
      .object({
        followUps: z.array(followUpSchema),
        done: z.array(followUpSchema),
        /**
         * Whether this thread has ever tracked a follow-up — the gate on the
         * banner's empty state. Only here, not on the mutation RPCs that also
         * return both lists: it never goes false once true, so the client can
         * hold what its list call told it and a fetch per mutation would be
         * asking a question whose answer cannot have changed.
         */
        everRecorded: z.boolean(),
      })
      .strict(),
  },
  /** Mark one row finished; it moves to Done. */
  followups_done: {
    input: z
      .object({
        threadId: z.string().min(1).max(200),
        id: z.string().min(1).max(64),
        done: z.boolean(),
      })
      .strict(),
    output: z
      .object({
        followUps: z.array(followUpSchema),
        done: z.array(followUpSchema),
      })
      .strict(),
  },
  /** Empty the Done section, releasing those texts to be recorded again. */
  followups_clear_done: {
    input: z.object({ threadId: z.string().min(1).max(200) }).strict(),
    output: z.object({ cleared: z.number().int() }).strict(),
  },
  /**
   * Everything the compose view needs in one round trip: the row it is handing
   * off, the prompt to seed the draft with, and the project and environment to
   * seed the composer's own pickers so a handoff defaults to the checkout the
   * row is about.
   */
  followups_handoff_seed: {
    input: z
      .object({
        threadId: z.string().min(1).max(200),
        /**
         * Omitted when the compose view is starting something new rather than
         * handing a row off. The project and environment are still wanted —
         * they are what makes the new thread land in this checkout — so this is
         * the same round trip with `row` and `prompt` empty.
         */
        id: z.string().min(1).max(64).optional(),
      })
      .strict(),
    output: z
      .object({
        row: followUpSchema.nullable(),
        projectId: z.string(),
        environmentId: z.string().nullable(),
        prompt: z.string(),
      })
      .strict(),
  },
  /**
   * Send a row somewhere else. Both targets spawn; they differ only in whether
   * this thread keeps owning the work.
   *
   * `request` is the composer's own `NewThreadRequest`, forwarded to
   * `threads.spawn` unchanged. It is deliberately not modelled field by field:
   * that would mean re-declaring a host contract this plugin does not own, and
   * breaking on the next field the host adds. Loose rather than strict for the
   * same reason — a stricter schema here fails closed on a host upgrade.
   */
  followups_handoff: {
    input: z
      .object({
        threadId: z.string().min(1).max(200),
        id: z.string().min(1).max(64),
        target: z.enum(["child", "thread"]),
        request: z.looseObject({ projectId: z.string().min(1) }),
      })
      .strict(),
    output: z
      .object({
        outcome: z.enum([
          "spawned",
          "not-found",
          "no-environment",
          "failed",
        ]),
        prompt: z.string(),
        spawnedThreadId: z.string().nullable(),
        followUps: z.array(followUpSchema),
        done: z.array(followUpSchema),
      })
      .strict(),
  },
  /**
   * Ask this thread's own agent what to pick up next.
   *
   * Server-side because `threads.send` is: the composer SDK deliberately has no
   * "submit now" arm — see `ExperimentalComposerSubmitOptions`, which documents
   * that handing plugins an unconditional send is a larger surface than it
   * wants to open — so a client-side route could only have queued the message
   * on a countdown. Sending here dispatches now, and because no execution
   * options are passed the turn runs on the thread's own model and permission
   * mode, which are the settings already in front of the user.
   */
  followups_suggest_next: {
    input: z.object({ threadId: z.string().min(1).max(200) }).strict(),
    output: z
      .object({ outcome: z.enum(["sent", "queued", "failed", "disabled"]) })
      .strict(),
  },
  /**
   * Start a thread with no row attached: the empty state's "new thread".
   *
   * The same spawn as a handoff, minus everything a handoff does to a row —
   * there is no row. It is deliberately unparented: a child says this thread
   * still owns the work, and the whole premise of the surface offering this is
   * that this thread has nothing left to own.
   *
   * `request` is forwarded whole for the same reason `followups_handoff` does
   * it: `NewThreadRequest` is the host's contract, and re-declaring it here
   * would fail closed on the next field the host adds.
   */
  followups_start_thread: {
    input: z
      .object({
        threadId: z.string().min(1).max(200),
        request: z.looseObject({ projectId: z.string().min(1) }),
      })
      .strict(),
    output: z
      .object({
        outcome: z.enum(["spawned", "failed"]),
        spawnedThreadId: z.string().nullable(),
      })
      .strict(),
  },
  /**
   * Commit a drag. The client sends the whole resulting order plus the row the
   * user actually moved, because only that row becomes theirs — see applyOrder.
   */
  followups_reorder: {
    input: z
      .object({
        threadId: z.string().min(1).max(200),
        // The ceiling, not the configured cap: this bounds a wire payload, and
        // a reorder arriving while the cap is being lowered must still be a
        // reorder rather than a validation error.
        orderedIds: z.array(z.string().min(1).max(64)).max(CAP_CEILING),
        movedId: z.string().min(1).max(64),
      })
      .strict(),
    output: z
      .object({
        followUps: z.array(followUpSchema),
        done: z.array(followUpSchema),
      })
      .strict(),
  },
  /**
   * Record a follow-up the user wrote, from a text selection. Carries no
   * reason: that field answers "why is the agent not doing this", which is not
   * a question the user is being asked.
   */
  followups_add: {
    input: z
      .object({
        threadId: z.string().min(1).max(200),
        text: z.string().trim().min(1).max(TEXT_MAX),
        detail: z.string().trim().max(DETAIL_MAX).optional(),
        // The path an @-mention in the note pointed at, when it had one.
        file: z.string().trim().max(200).optional(),
      })
      .strict(),
    output: z
      .object({
        outcome: z.enum(["added", "duplicate", "dismissed", "full"]),
        // Null unless something was added. The caller needs it to expand the
        // row it has just created without matching on text.
        id: z.string().nullable(),
        followUps: z.array(followUpSchema),
        done: z.array(followUpSchema),
      })
      .strict(),
  },
  /**
   * Fork this thread to describe one row more fully, and write the result
   * straight into it. Explicit and per-row: nothing infers anything unasked.
   */
  followups_expand: {
    input: z
      .object({
        threadId: z.string().min(1).max(200),
        id: z.string().min(1).max(64),
      })
      .strict(),
    output: z
      .object({
        // "disabled" is a real answer, not a failure: the button is hidden when
        // the setting is off, so this is only reachable by a race between the
        // render and the click. Saying so keeps it out of the error log.
        outcome: z.enum(["forked", "not-found", "failed", "disabled"]),
        forkedThreadId: z.string().nullable(),
      })
      .strict(),
  },
  /**
   * Stop the helper describing a row, and let the row say so immediately.
   * The same call whether it is still thinking or already wedged.
   */
  followups_expand_cancel: {
    input: z
      .object({
        threadId: z.string().min(1).max(200),
        id: z.string().min(1).max(64),
      })
      .strict(),
    output: z
      .object({
        outcome: z.enum(["cancelled", "not-expanding"]),
        followUps: z.array(followUpSchema),
        done: z.array(followUpSchema),
      })
      .strict(),
  },
  /** Amend a row in place, keeping its id, created time and position. */
  followups_amend: {
    input: z
      .object({
        threadId: z.string().min(1).max(200),
        id: z.string().min(1).max(64),
        text: z.string().trim().min(1).max(TEXT_MAX).optional(),
        reason: z.enum(REASONS).nullable().optional(),
        file: z.string().trim().max(200).nullable().optional(),
        detail: z.string().trim().max(DETAIL_MAX).nullable().optional(),
      })
      .strict(),
    output: z
      .object({
        outcome: z.enum([
          "amended",
          "unchanged",
          "not-found",
          "duplicate",
          "dismissed",
          "forbidden",
        ]),
        followUps: z.array(followUpSchema),
        done: z.array(followUpSchema),
      })
      .strict(),
  },
  /**
   * How many follow-ups each of these threads has, open and done.
   *
   * The one method here meant for *other plugins*. Everything else in this
   * contract is this plugin talking to its own frontend and may change shape
   * whenever that is convenient; this is a promise, and the `V1` in its name
   * and the `protocolVersion` in its payload are what make that promise
   * checkable. The shape mirrors Ribbon's `getGroupingCatalogV1`, which is the
   * closest thing bb has to a convention for one plugin reading another.
   *
   * Batch because the caller is a sidebar. Thread Badges' ring was calling
   * `followups_list` once per visible row and counting the arrays — every
   * field of every follow-up, text and detail and handoff state, fetched to
   * learn two integers, N requests per render. This asks once and answers with
   * the two integers.
   *
   * Every requested thread comes back, including ones with nothing. A caller
   * that asked about a thread and got no entry cannot tell "no follow-ups"
   * from "not answered", and the first is worth caching while the second is
   * worth retrying.
   */
  getFollowUpCountsV1: {
    input: z
      .object({
        threadIds: z
          .array(z.string().min(1).max(200))
          .max(COUNTS_MAX_THREADS),
      })
      .strict(),
    output: z
      .object({
        protocolVersion: z.literal(FOLLOW_UP_COUNTS_PROTOCOL),
        counts: z.array(
          z
            .object({
              threadId: z.string(),
              open: z.number().int().nonnegative(),
              done: z.number().int().nonnegative(),
            })
            .strict(),
        ),
      })
      .strict(),
  },
  /**
   * Read and write what the expansion helper runs on.
   *
   * Its own pair of methods rather than a `settings.define` field because the
   * value is a live provider-and-model selection: a `select`'s options are
   * fixed when the plugin loads, and a free-text model id is a way to
   * misconfigure the feature silently. The settings section renders bb's own
   * picker over the live catalog instead, and this is where its answer lands.
   */
  followups_expansion_execution: {
    input: z.object({}).strict(),
    output: z.object({ execution: expansionExecutionSchema.nullable() }).strict(),
  },
  /** `execution: null` clears it, which is how "use the project defaults" is said. */
  followups_set_expansion_execution: {
    input: z
      .object({ execution: expansionExecutionSchema.nullable() })
      .strict(),
    output: z.object({ execution: expansionExecutionSchema.nullable() }).strict(),
  },
  /** Dismiss one row: removes it and tombstones its text for this thread. */
  followups_dismiss: {
    input: z.object({ threadId: z.string().min(1).max(200), id: z.string().min(1).max(64) }).strict(),
    output: z
      .object({
        followUps: z.array(followUpSchema),
        done: z.array(followUpSchema),
      })
      .strict(),
  },
});

/**
 * What the empty state's "Suggest what's next" sends, in two parts.
 *
 * Deliberately carries no context of its own. The agent is being asked about
 * the thread it is already in, and it can read that thread better than this
 * plugin could summarise it — a digest assembled here would be a worse copy of
 * something already in front of it.
 *
 * Split because this lands in the user's own thread as a message from them, and
 * fifteen lines of instructions quoted back at you every time you press a button
 * is the plugin talking over the conversation it exists to annotate. The ask is
 * one line and reads like something they would have typed; the method behind it
 * is sent `visibility: "agent-only"`, which the model receives in full and the
 * transcript does not render.
 *
 * That is verified rather than inferred: a fork seeded with a nonsense token
 * answered with the token, and the seed appears nowhere in `bb thread log`.
 * Both halves reach the model, so they are written to be read in order — the
 * ask states the situation, the method says what to do about it.
 *
 * The last paragraph is the load-bearing one. A button that asks for a
 * suggestion is a button that will get one, whether or not one exists, and an
 * invented next task is worse than an empty answer.
 */
const SUGGEST_ASK =
  "Nothing is outstanding on this thread — what would be worth picking up next?";

/** The plugin's half of the method. `suggestMethod` adds the user's. */
const SUGGEST_METHOD_BASE = [
  "Every follow-up recorded on this thread has been closed or dismissed.",
  "",
  "Look back over what this thread actually did. Be concrete — name the thing,",
  "and say why it follows from the work that is already here rather than from",
  "general good practice.",
  "",
  "Record each one with `record_follow_up` rather than describing it. The list",
  "above the composer is where these get acted on — dragged, handed off,",
  "dismissed — and a suggestion that only exists in a reply cannot be any of",
  "those. Then say in one or two lines what you added and why, and stop. The",
  "rows carry the detail; repeating them in prose is the same thing twice.",
  "",
  "If there is genuinely nothing worth doing next, record nothing and say so.",
  "That is a real answer, and inventing work to fill the silence is worse than",
  "none.",
].join("\n");

/** The method, with the user's own guidance appended where it belongs — last. */
function suggestMethod(houseStyle: string): string {
  const house = houseStyleBlock(houseStyle);
  return house === null
    ? SUGGEST_METHOD_BASE
    : [SUGGEST_METHOD_BASE, ...house].join("\n");
}

/** Frontend refetch signal; the payload names the thread that changed. */
const FOLLOWUPS_CHANGED = "followups-changed";

/** Mention provider id; the host composes wire ids as "<providerId>:<itemId>". */
const MENTION_PROVIDER = "follow-up";

/**
 * `resolve` receives only the item id, with no thread context, so the thread is
 * encoded into the id. "." is safe: thread ids are `thr_<alnum>` and follow-up
 * ids are hex, and the host only splits on the first ":".
 */
const mentionItemId = (threadId: string, id: string) => `${threadId}.${id}`;

function parseMentionItemId(itemId: string): { threadId: string; id: string } | null {
  const at = itemId.lastIndexOf(".");
  if (at <= 0 || at === itemId.length - 1) return null;
  return { threadId: itemId.slice(0, at), id: itemId.slice(at + 1) };
}

const ITEMS_PREFIX = "items:";
const TOMBS_PREFIX = "tombs:";
// Which row a helper thread is describing, so its death can be noticed.
const EXPANDING_PREFIX = "expanding:";
/**
 * One boolean per thread: this thread has recorded a follow-up at some point.
 *
 * It exists so the empty state survives Clear Done. Everything else about "has
 * this thread ever tracked anything" can be derived from the items and the
 * tombstones, but clearing Done drops both — and the moment you clear the last
 * finished row is exactly when "nothing outstanding, archive this?" is worth
 * saying, not when it should disappear.
 */
const SEEN_PREFIX = "seen:";

const itemsKey = (threadId: string) => `${ITEMS_PREFIX}${threadId}`;
const tombsKey = (threadId: string) => `${TOMBS_PREFIX}${threadId}`;
const expandingKey = (helperThreadId: string) => `${EXPANDING_PREFIX}${helperThreadId}`;
const seenKey = (threadId: string) => `${SEEN_PREFIX}${threadId}`;

const TOOL_INSTRUCTIONS = [
  "When you notice work you are not going to do in this turn — something out of",
  "scope, blocked, deliberately deferred, a risk you spotted, or cleanup worth",
  "doing later — call record_follow_up once for it, right then. Do not save them",
  "up for the end of the turn: a follow-up you never write down is lost when the",
  "turn ends.",
  "",
  "Record only things a person would want to act on later. Do not record work you",
  "completed, routine steps of the task you were given, or speculative polish.",
  "",
  "Leave priority alone unless the follow-up genuinely should be picked up before",
  "what is already on the list. Urgent by default is the same as no order at all.",
].join("\n");

const LIST_TOOL_INSTRUCTIONS = [
  "Read the list before telling the user what is outstanding on this thread —",
  "your memory of the conversation is not the list, and the user edits it",
  "directly. Also read it when you have finished something you did not record",
  "yourself and need its id to close it.",
  "",
  "Dismissed follow-ups are not shown. The user deleted them on purpose; do not",
  "raise them again.",
].join("\n");

/**
 * The boundary the whole write direction rests on: an agent may record that
 * work is finished, because that is a fact about the repository it can point
 * at. It may not decide a follow-up is not worth doing — that is a judgement
 * about what the user wants, and dismissal stays theirs alone.
 */
const COMPLETE_TOOL_INSTRUCTIONS = [
  "Close a follow-up only when the work it names is actually finished and you",
  "can point at what you changed. Do not close one because it now looks",
  "unnecessary, is already covered elsewhere, or is not worth doing — say so to",
  "the user and leave the row open. Deciding a follow-up should go away is the",
  "user's call, not yours.",
  "",
  "This applies to follow-ups you did not record. If you fixed what the row",
  "describes, close it, whoever wrote it.",
  "",
  "The note is what the user will check you against, so make it specific: name",
  "the file, the function, or the test that now passes.",
].join("\n");

/**
 * Amending is the one write that can destroy information the user put there,
 * so the instructions lead with what not to touch rather than what to do.
 */
const AMEND_TOOL_INSTRUCTIONS = [
  "Amend when the row is wrong or thin: it describes the problem imprecisely, or",
  "you have since learned what a future reader would need. Prefer adding detail",
  "over rewriting text — the wording is how the user recognises the row.",
  "",
  "You cannot reword a follow-up the user wrote, only add to it. If you think",
  "theirs says the wrong thing, say so in your reply and leave it alone.",
  "",
  "Amending is not closing. If the work is done, call complete_follow_up.",
].join("\n");

/**
 * Ordering is a hint from an agent and a decision from the user, so the tool
 * is described as moving within what the agent is allowed to touch rather than
 * as setting priority outright.
 */
const PRIORITIZE_TOOL_INSTRUCTIONS = [
  "Move a follow-up when what should happen next has actually changed — a row",
  "became urgent, got unblocked, or stopped mattering for now. Do not reorder",
  "the list to reflect your own plan for the turn.",
  "",
  "Rows the user placed by hand stay above anything you move to the front. That",
  "is not a failure: report where the row landed rather than calling the tool",
  "again.",
].join("\n");

/**
 * Injected into every thread's instructions, after the tool's own snippet.
 *
 * The tool snippet alone did not produce a single spontaneous call across the
 * baseline threads, so this is deliberately a standing rule rather than an
 * offer. The comparison that motivates the wording: `agent_checklist_update`
 * reaches 544 calls on this host because the user's CLAUDE.md *mandates* it —
 * not because agents volunteer bookkeeping.
 */
const CAPTURE_RULE = [
  "Follow-ups: when you decide not to do something you noticed — out of scope,",
  "blocked, deferred, a risk, or cleanup — call `record_follow_up` for it before",
  "you finish the turn. Recording is not reporting: do it even when you were",
  "asked to keep your answer short or to raise only one issue.",
  "",
  "A suggestion counts. If you raise something in prose — \"we should also X\",",
  "\"worth considering Y\" — record it in the same turn, then mention it. Asking",
  "the user is not recording: a question in a reply is gone once the thread",
  "moves on, and a row costs one click to dismiss if the answer is no.",
  "",
  "The list is shared state, not your notes: the user adds, sends and deletes",
  "rows behind your back. Call `list_follow_ups` before telling them what is",
  "outstanding. When you finish work a row describes — including one you were",
  "handed as a follow-up — call `complete_follow_up` for it before the turn ends,",
  "even if you also mention it in your reply. Closing a row you did not record",
  "is expected; deciding a row is not worth doing is the user's call, not yours.",
  "Use `prioritize_follow_up` when what should be picked up next changes.",
  "",
  "Ids are for tool arguments, never for prose. The user sees a list of",
  "sentences, not hashes — `daf31e68` names nothing they can look at, so a reply",
  "citing one is asking them to match a string they were never shown. Quote the",
  "row's own words instead: not \"closed daf31e68\" but \"closed the row about",
  "the handoff picker\".",
].join("\n");

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");

  // Every field here was a constant that someone disagreed with. Nothing is
  // exposed because it *could* be: the prompt harness, the text and detail
  // limits, and the animation timings stay hardcoded, because a settings field
  // is also a way to make the plugin worse and each one has to earn that risk.
  const settings = bb.settings.define({
    // Ordered the way the plugin is used: what agents are told, what happens
    // when you mention a row, what the list holds, then the two buttons that
    // spend something on your behalf.
    //
    // Every field here was a constant that someone disagreed with. Nothing is
    // exposed because it *could* be: the prompt harness, the text and detail
    // limits, and the animation timings stay hardcoded, because a settings
    // field is also a way to make the plugin worse and each one has to earn
    // that risk.
    captureRule: {
      type: "boolean",
      label: "Remind agents to record follow-ups",
      description:
        "Adds a standing rule to every thread's instructions. Without it, agents " +
        "have the tool but are not told to use it.",
      default: true,
    },
    mentionInAtMenu: {
      type: "boolean",
      label: "List follow-ups in the @ menu",
      description:
        "Turn this off to keep a crowded @ menu clear. The rows themselves still " +
        "insert into the composer from the banner, which is the same pill.",
      default: true,
    },
    markInProgressOnSend: {
      type: "boolean",
      label: "Mentioning a follow-up claims it",
      description:
        "Inserting a row as an @-mention moves it below the untouched ones and " +
        "shows it as in flight. Turn this off to mention a row without claiming it.",
      default: true,
    },
    backfillAsk: {
      type: "boolean",
      label: "Ask for a mentioned row's missing file and detail",
      description:
        "A row you jotted in a hurry arrives at the agent with a line asking it " +
        "to fill in what is absent. Turn this off to send the row and nothing else.",
      default: true,
    },
    inheritChildRows: {
      type: "boolean",
      label: "Carry a child thread's follow-ups up to its parent",
      description:
        "When a thread you handed work to finishes, whatever it recorded joins " +
        "this thread's list. Turn this off to keep the two lists separate.",
      default: true,
    },
    maxPerThread: {
      type: "number",
      label: "Follow-ups kept per thread",
      description:
        `Recording stops once a thread holds this many. Up to ${CAP_CEILING}; ` +
        "one thread's rows live in a single storage value, so this is a budget " +
        "as well as a preference.",
      default: MAX_PER_THREAD,
      experimental_schema: z.number().int().min(1).max(CAP_CEILING),
    },
    autoCollapseAt: {
      type: "number",
      label: "Collapse the banner above this many rows",
      description:
        "How many follow-ups a thread may show before the card starts folded to " +
        "a summary line. Expanding or collapsing it yourself always wins.",
      default: AUTO_COLLAPSE_AT,
      experimental_schema: z.number().int().min(0).max(CAP_CEILING),
    },
    offerDescribe: {
      type: "boolean",
      label: 'Offer "Describe this in more detail"',
      description:
        "The button on a row with no detail. It spawns a short-lived hidden " +
        "thread that reads this one and writes the detail, so it spends tokens. " +
        "Turn it off and nothing is ever spawned on your behalf.",
      default: true,
    },
    expansionWordCap: {
      type: "number",
      label: "Describe in more detail: word limit",
      description: "The ceiling that helper is given for what it writes.",
      default: EXPANSION_WORD_CAP,
      experimental_schema: z.number().int().min(20).max(2000),
    },
    expansionTurns: {
      type: "number",
      label: "Describe in more detail: turns of context",
      description:
        "How much of this thread that same helper reads before writing — it runs " +
        "`bb thread log --limit` with this number. Raising it buys context and " +
        "risks the prompt-too-long failure a bounded read exists to avoid.",
      default: EXPANSION_TURNS,
      experimental_schema: z.number().int().min(1).max(100),
    },
    expansionHouseStyle: {
      type: "string",
      label: "Describe in more detail: your own guidance",
      description:
        "Added to that helper's prompt in your voice, after the advice it may " +
        "argue with and before the commands it must not touch. Leave it empty and " +
        "the prompt is exactly as it ships. For example: \u201cLead with the file " +
        "it touches. Say what breaks if nobody does this. Never guess at a cause \u2014 " +
        "if the thread does not say, leave it out.\u201d",
      experimental_multiline: true,
      default: "",
    },
    offerSuggest: {
      type: "boolean",
      label: 'Offer "Suggest what\'s next"',
      description:
        "The button shown once a thread's follow-ups are all closed. It is the " +
        "only thing this plugin does that writes a message into your own " +
        "conversation. Turn it off and it never will.",
      default: true,
    },
    suggestHouseStyle: {
      type: "string",
      label: "Suggest what's next: your own guidance",
      description:
        "Added to that ask in your voice. Same rule as the other one: it steers " +
        "the answer, not the mechanism. For example: \u201cPrefer work that " +
        "unblocks someone else. Do not suggest tests or documentation unless this " +
        "thread was already about them. One suggestion is a fine answer.\u201d",
      experimental_multiline: true,
      default: "",
    },
  });

  /**
   * The configured per-thread cap.
   *
   * Read at each use rather than cached like `captureRuleEnabled`: recording is
   * not a hot path — it happens once per follow-up, behind a kv write already —
   * and a cache here would mean a lowered cap kept letting rows in until the
   * next reload.
   */
  async function threadCap(): Promise<number> {
    return (await settings.get()).maxPerThread;
  }

  /**
   * What the expansion helper should run on, or null for project defaults.
   *
   * Re-validated on read, not just on write: this is a kv value that survives
   * plugin upgrades, so a shape that stops parsing must degrade to "use the
   * defaults" rather than throw inside a spawn the user is waiting on.
   */
  async function readExpansionExecution(): Promise<ExpansionExecution | null> {
    const stored = await bb.storage.kv.get<unknown>(EXECUTION_KEY);
    if (stored === undefined || stored === null) return null;
    const parsed = expansionExecutionSchema.safeParse(stored);
    if (!parsed.success) {
      bb.log.warn("stored expansion execution no longer parses; using defaults");
      return null;
    }
    return parsed.data;
  }

  async function readItems(threadId: string): Promise<FollowUp[]> {
    return (await bb.storage.kv.get<FollowUp[]>(itemsKey(threadId))) ?? [];
  }

  async function readTombstones(threadId: string): Promise<string[]> {
    return (await bb.storage.kv.get<string[]>(tombsKey(threadId))) ?? [];
  }

  /** Remember that this thread has tracked something. Never unset. */
  async function markEverRecorded(threadId: string): Promise<void> {
    await bb.storage.kv.set(seenKey(threadId), true);
  }

  /**
   * Has this thread ever had a follow-up?
   *
   * Derived as well as stored: the flag only started being written at milestone
   * 4, so a thread whose rows predate it would otherwise read as untouched and
   * lose the empty state it has most earned. Either source answering yes is
   * enough — the flag is what survives Clear Done, the derivation is what
   * covers everything recorded before the flag existed.
   */
  async function readEverRecorded(threadId: string): Promise<boolean> {
    const [flag, items, tombstones] = await Promise.all([
      bb.storage.kv.get<boolean>(seenKey(threadId)),
      readItems(threadId),
      readTombstones(threadId),
    ]);
    return flag === true || items.length > 0 || tombstones.length > 0;
  }

  /** Rows still awaiting attention: not dismissed, not done. */
  async function listFollowUps(threadId: string): Promise<FollowUp[]> {
    const [items, tombstones] = await Promise.all([
      readItems(threadId),
      readTombstones(threadId),
    ]);
    return openFollowUps(items, tombstones);
  }

  /** Finished rows: the Done section. */
  async function listDone(threadId: string): Promise<FollowUp[]> {
    const [items, tombstones] = await Promise.all([
      readItems(threadId),
      readTombstones(threadId),
    ]);
    return doneFollowUps(items, tombstones);
  }

  /**
   * Mark a row finished, or reopen it.
   *
   * Deliberately not a tombstone: a done row still blocks an identical
   * re-record while it sits in Done, but clearing Done releases the text, so a
   * regression can legitimately be raised again. Dismissal is the permanent one.
   */
  /**
   * Send one row to a skill. Shared by the RPC and `bb follow-up handoff`, so
   * the disposition rules live in one place rather than being restated by
   * whichever surface asked.
   */
  /**
   * Where a handoff's spawn arguments come from. Two callers, two shapes: the
   * compose view resolved everything itself, while the CLI has no composer and
   * builds a prompt from the row plus an optional skill.
   */
  type HandoffSpawn =
    | { kind: "composed"; request: Record<string, unknown> }
    | {
        kind: "prompt";
        skill: string | null;
        execution?: Record<string, unknown>;
      };

  /**
   * The one place this plugin starts a thread.
   *
   * Both callers — a handoff and the empty state's "new thread" — need the same
   * origin stamping, and a second copy of it would be a second thing to keep in
   * step. `parentThreadId` is the only difference between them, and it is the
   * whole difference: it decides whether the new thread is delegated work this
   * one still owns.
   */
  async function spawnThread(
    args: Record<string, unknown>,
    parentThreadId: string | null,
  ): Promise<{ id: string }> {
    return await bb.sdk.threads.spawn({
      ...args,
      origin: "plugin",
      originPluginId: "follow-up",
      ...(parentThreadId === null ? {} : { parentThreadId }),
      // Cast because the composed branch forwards a host-owned shape this
      // plugin deliberately does not model: validating `NewThreadRequest`
      // field by field would mean re-declaring the host's own contract and
      // breaking on the next field it adds.
    } as Parameters<typeof bb.sdk.threads.spawn>[0]);
  }

  async function handoffFollowUp(
    threadId: string,
    id: string,
    target: "child" | "thread",
    spawnWith: HandoffSpawn,
  ): Promise<{
    outcome: "spawned" | "not-found" | "no-environment" | "failed";
    prompt: string;
    spawnedThreadId: string | null;
  }> {
    const items = await readItems(threadId);
    const row = items.find((entry) => entry.id === id);
    const empty = { prompt: "", spawnedThreadId: null };
    if (row === undefined) return { outcome: "not-found", ...empty };

    let args: Record<string, unknown>;
    let prompt: string;
    if (spawnWith.kind === "composed") {
      // The composer resolved every choice — project, provider, model,
      // reasoning, permission mode, environment, and the draft itself. Forward
      // it unchanged, which is what `NewThreadRequest` documents: the server
      // drops a provider or model carrying no provenance and re-derives it from
      // the project defaults, so stripping fields here would silently undo the
      // user's picks.
      args = { ...spawnWith.request };
      prompt = "";
    } else {
      // Both ids come from the thread rather than the caller: the caller
      // already proved which thread it means, and asking it for a project as
      // well would be trusting a second answer to a question the first settles.
      const thread = await bb.sdk.threads.get({ threadId });
      if (thread.environmentId === null) {
        return { outcome: "no-environment", ...empty };
      }
      prompt = handoffPrompt(spawnWith.skill, row);
      args = {
        projectId: thread.projectId,
        // Reuse, so the handoff lands in the same checkout the row is about.
        environment: { type: "reuse", environmentId: thread.environmentId },
        prompt,
        // Whatever the caller asked for, already carrying its provenance. Empty
        // when they asked for nothing, which is when project defaults apply —
        // the same rule `bb thread spawn` follows with its flags omitted.
        ...(spawnWith.execution ?? {}),
      };
    }

    try {
      const spawned = await spawnThread(
        args,
        target === "child" ? threadId : null,
      );
      if (target === "child") {
        // A parent still owns work it delegated, so the row stays open and only
        // moves to in progress — the same state a sent prompt puts it in,
        // because that is what this is.
        await markInProgress(threadId, id);
        // And remember where it went. Without this a finished child cannot be
        // matched back to the row that sent it, which is exactly why a
        // returning child used to change nothing at all.
        await patchRow(threadId, id, {
          handoffThreadId: spawned.id,
          handoffState: "running",
        });
      } else {
        // An unparented thread is a real handoff: not this thread's
        // responsibility any more. Done, not dismissed — dismissal would
        // tombstone the wording and read as the user rejecting it, losing where
        // the work actually went, and it would not be reopenable if the handoff
        // fell through.
        await setDone(threadId, id, true, "user", `handed off to ${spawned.id}`);
      }
      return { outcome: "spawned", prompt, spawnedThreadId: spawned.id };
    } catch (error) {
      bb.log.error(`handoff failed on ${threadId}: ${String(error)}`);
      return { outcome: "failed", ...empty };
    }
  }

  /**
   * The empty state's "new thread": spawn from a composed request, touching no
   * row. Separate from `handoffFollowUp` rather than a mode inside it because
   * every branch of that function is row bookkeeping, and there is no row here
   * to look up, mark in progress, or close.
   */
  async function startThread(
    threadId: string,
    request: Record<string, unknown>,
  ): Promise<{ outcome: "spawned" | "failed"; spawnedThreadId: string | null }> {
    try {
      // Unparented: a parent still owns work it delegated, and this thread is
      // being offered the button precisely because it has nothing left to own.
      const spawned = await spawnThread({ ...request }, null);
      bb.log.info(`started a new thread from ${threadId}: ${spawned.id}`);
      return { outcome: "spawned", spawnedThreadId: spawned.id };
    } catch (error) {
      bb.log.error(`start-thread failed on ${threadId}: ${String(error)}`);
      return { outcome: "failed", spawnedThreadId: null };
    }
  }

  async function setDone(
    threadId: string,
    id: string,
    done: boolean,
    by: "agent" | "user" = "user",
    note?: string,
  ): Promise<FollowUp | null> {
    const items = await readItems(threadId);
    const target = items.find((row) => row.id === id);
    if (target === undefined) return null;
    await bb.storage.kv.set(
      itemsKey(threadId),
      items.map((row) =>
        row.id === id
          ? {
              ...row,
              doneAt: done ? new Date().toISOString() : null,
              // Reopening clears the attribution with the completion: the
              // claim it recorded is no longer true of the row.
              doneBy: done ? by : null,
              doneNote: done ? (note ?? null) : null,
            }
          : row,
      ),
    );
    bb.log.info(`follow-up ${done ? "done" : "reopened"} on ${threadId}: ${target.text}`);
    bb.realtime.publish(FOLLOWUPS_CHANGED, { threadId });
    return target;
  }

  /** Drop finished rows entirely, releasing their texts for re-recording. */
  async function clearDone(threadId: string): Promise<number> {
    const items = await readItems(threadId);
    const remaining = items.filter((row) => !row.doneAt);
    const cleared = items.length - remaining.length;
    if (cleared > 0) {
      await bb.storage.kv.set(itemsKey(threadId), remaining);
      bb.log.info(`cleared ${cleared} done follow-up(s) on ${threadId}`);
      bb.realtime.publish(FOLLOWUPS_CHANGED, { threadId });
    }
    return cleared;
  }

  /** Commit a drag: the resulting order, with only `movedId` attributed. */
  async function reorderFollowUps(
    threadId: string,
    orderedIds: readonly string[],
    movedId: string,
  ): Promise<void> {
    const items = await readItems(threadId);
    await bb.storage.kv.set(
      itemsKey(threadId),
      applyOrder(items, orderedIds, "user", [movedId]),
    );
    bb.log.info(`reordered follow-ups on ${threadId}: moved ${movedId}`);
    bb.realtime.publish(FOLLOWUPS_CHANGED, { threadId });
  }

  /** Send one row to the top or bottom. `blockedBy` counts what outranked it. */
  async function moveOne(
    threadId: string,
    id: string,
    position: "top" | "bottom",
    by: "user" | "agent",
  ): Promise<{ row: FollowUp; blockedBy: number } | null> {
    const items = await readItems(threadId);
    const target = items.find((row) => row.id === id);
    if (target === undefined || isDone(target)) return null;
    const { list, blockedBy } = moveFollowUp(items, id, position, by);
    await bb.storage.kv.set(itemsKey(threadId), list);
    bb.log.info(`moved follow-up ${position} on ${threadId} by ${by}: ${target.text}`);
    bb.realtime.publish(FOLLOWUPS_CHANGED, { threadId });
    return { row: target, blockedBy };
  }

  /** Amend one row. The only writer of amendments, shared by RPC, tool and CLI. */
  async function amendOne(
    threadId: string,
    id: string,
    patch: Parameters<typeof amendFollowUp>[2],
    by: "user" | "agent",
  ) {
    const [items, tombstones] = await Promise.all([
      readItems(threadId),
      readTombstones(threadId),
    ]);
    const result = amendFollowUp(items, id, patch, by, tombstones);
    if (result.outcome === "amended") {
      // Whatever a helper was going to say, someone has now said something.
      // Clearing here rather than only when the helper settles means the
      // spinner stops the moment the description actually lands.
      await bb.storage.kv.set(
        itemsKey(threadId),
        result.list.map((entry) =>
          entry.id === id ? { ...entry, expandingSince: null } : entry,
        ),
      );
      bb.log.info(`amended follow-up on ${threadId} by ${by}: ${result.row?.text}`);
      bb.realtime.publish(FOLLOWUPS_CHANGED, { threadId });
    }
    return result;
  }

  /** Everything not dismissed, including rows already in progress. */
  async function listIncludingInProgress(threadId: string): Promise<FollowUp[]> {
    const [items, tombstones] = await Promise.all([
      readItems(threadId),
      readTombstones(threadId),
    ]);
    return applyTombstones(items, tombstones);
  }

  /**
   * Move a row to in progress, because a prompt referencing it was sent.
   *
   * `sentAt` keeps its name: the field records the event that was observed —
   * the send — while "in progress" is the state that event puts the row in.
   * Everything a person reads says in progress; only the timestamp says sent.
   *
   * Called from the mention provider's handOffToAgent, which the host runs once
   * per unique item at send time — so this fires only when a prompt is genuinely
   * sent, not when the pill is merely inserted into the draft.
   */
  /** Merge fields into one row. Silent when the row is gone. */
  async function patchRow(
    threadId: string,
    id: string,
    patch: Partial<FollowUp>,
  ): Promise<void> {
    const items = await readItems(threadId);
    if (!items.some((row) => row.id === id)) return;
    await bb.storage.kv.set(
      itemsKey(threadId),
      items.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
    bb.realtime.publish(FOLLOWUPS_CHANGED, { threadId });
  }

  /**
   * A handed-off child finished, or failed. Record which, on the row that sent
   * it there.
   *
   * The child's own `parentThreadId` is the lookup: it names the thread holding
   * the row, so this reads one key rather than scanning every thread's items.
   * A child spawned by anything else matches no row and writes nothing.
   *
   * Deliberately not a completion. A child going idle is a report, and a report
   * is not evidence — closing the row here would mark work done on the strength
   * of an agent's own account of it. This only says there is something to look
   * at.
   */
  async function onChildSettled(
    thread: { id: string; parentThreadId: string | null },
    state: "finished" | "failed",
  ): Promise<void> {
    const parent = thread.parentThreadId;
    if (parent === null) return;
    const items = await readItems(parent);
    const { list, changed } = markHandoffState(items, thread.id, state);
    if (changed) {
      await bb.storage.kv.set(itemsKey(parent), list);
      bb.log.info(`handoff ${state} on ${parent}: child ${thread.id}`);
      bb.realtime.publish(FOLLOWUPS_CHANGED, { threadId: parent });
    }
    // Not inside that guard, and not an early return any more. Handoff state
    // only changes for a child this plugin sent somewhere, while rows are worth
    // carrying up from any child at all — which is the common case, since
    // `bb thread spawn --parent-self` is how workers actually get made.
    await inheritChildRows(thread.id, parent);
  }

  /**
   * Carry a settled child's own follow-ups up to its parent.
   *
   * The plugin's promise is that nothing an agent noticed gets lost when the
   * turn ends. Until this, that held only for work done inline: a worker
   * recorded what it saw onto its own thread, and that thread is one nobody
   * opens again. The child's completion report is prose, and prose losing
   * things is the reason this plugin exists.
   *
   * Copied, not moved. A settled child can be steered again and should not find
   * its own notes gone.
   *
   * Idempotent through `addFollowUp` rather than through a flag of its own:
   * `thread.idle` fires on every idle, not once, and the same dedupe that stops
   * an agent recording the same thing twice stops this. The tombstone gate
   * comes along with it, so a row dismissed on the parent stays dismissed no
   * matter how often its child settles.
   */
  async function inheritChildRows(child: string, parent: string): Promise<void> {
    if (child === parent) return;
    // Checked before reading anything: the child's rows stay on the child, and
    // the parent's list is left exactly as the user left it.
    if (!(await settings.get()).inheritChildRows) return;
    // Open rows only: done ones were finished on the child, and dismissed ones
    // are already gone. `listFollowUps` applies both.
    const carried = await listFollowUps(child);
    if (carried.length === 0) return;
    const [items, tombstones] = await Promise.all([
      readItems(parent),
      readTombstones(parent),
    ]);
    const cap = await threadCap();
    let list = items;
    let added = 0;
    for (const row of carried) {
      const result = addFollowUp(
        list,
        carriedFromChild(row, child, randomUUID().slice(0, 8), new Date().toISOString()),
        tombstones,
        cap,
      );
      list = result.list;
      if (result.outcome === "added") added += 1;
    }
    if (added === 0) return;
    await bb.storage.kv.set(itemsKey(parent), list);
    await markEverRecorded(parent);
    bb.log.info(`carried ${added} follow-up(s) from child ${child} to ${parent}`);
    bb.realtime.publish(FOLLOWUPS_CHANGED, { threadId: parent });
  }

  /**
   * A helper stopped, whether or not it wrote anything.
   *
   * Unconditional: the point is that the row stops claiming to be worked on.
   * A helper that amended has already had the flag cleared by `amendOne`, so
   * this is the path for the one that errored, stopped early, or decided the
   * context did not tell it enough — the case that first showed up as a button
   * that "did nothing".
   */
  /**
   * What the settle events need to know about a helper that is still running.
   *
   * Keyed by helper thread id, because that is the handle the events carry —
   * they know a thread, not a row. `usedExecution` and `retried` are what make
   * the retry below possible and bounded; both are optional so records written
   * before they existed still parse, and a record without them simply never
   * retries.
   */
  type ExpandingRecord = {
    threadId: string;
    id: string;
    usedExecution?: boolean;
    retried?: boolean;
  };

  type ExpansionStart =
    | { outcome: "started"; helperThreadId: string }
    | { outcome: "not-found" | "failed" | "disabled"; helperThreadId: null };

  /**
   * Spawn the helper that describes one row.
   *
   * A spawn that reads a bounded slice of the parent, not a fork of it. The
   * fork was tried first and was wrong in the way that matters most: it
   * inherits the entire conversation, so it fails on exactly the long threads
   * where a jotted note most needs its context. The first real one died on
   * "Prompt is too long" after two minutes of work. A `bb thread log --limit`
   * read cannot do that.
   *
   * Shared by the button and by the retry in `onExpansionSettled`, so the
   * second attempt is the same spawn as the first with one field removed —
   * rather than a second, subtly different one.
   */
  async function startExpansion(
    threadId: string,
    id: string,
    execution: ExpansionExecution | null,
    retried: boolean,
  ): Promise<ExpansionStart> {
    // Checked here rather than at the callers, because there are three of them
    // now — the button, the retry, and the CLI — and the switch promises that
    // nothing is spawned on the user's behalf. A gate at the entry points is a
    // gate that the next entry point forgets; this is the only place a hidden
    // thread is created, so it is the only place the promise can be kept.
    if (!(await settings.get()).offerDescribe) {
      return { outcome: "disabled", helperThreadId: null };
    }
    const items = await readItems(threadId);
    const row = items.find((entry) => entry.id === id);
    if (row === undefined) return { outcome: "not-found", helperThreadId: null };
    const thread = await bb.sdk.threads.get({ threadId });
    if (thread.environmentId === null) {
      return { outcome: "failed", helperThreadId: null };
    }
    const current = await settings.get();
    try {
      const helper = await bb.sdk.threads.spawn({
        projectId: thread.projectId,
        // The same checkout, so the helper's `bb follow-up amend` and
        // `bb thread log` are the same CLI against the same daemon.
        environment: { type: "reuse", environmentId: thread.environmentId },
        prompt: expansionPrompt(row, threadId, {
          turns: current.expansionTurns,
          wordCap: current.expansionWordCap,
          houseStyle: current.expansionHouseStyle,
        }),
        // Hidden: housekeeping the user asked for, not work they want to
        // watch. It archives itself when done, so the sidebar never sees it
        // either way.
        visibility: "hidden",
        origin: "plugin",
        originPluginId: "follow-up",
        // Provenance or nothing: the server drops a provider or model that
        // arrives without a source and re-derives both from the project
        // defaults, so passing the fields alone would look like it worked and
        // quietly do the opposite. Omitting the block entirely is how "use the
        // defaults" is actually said.
        ...(execution === null
          ? {}
          : {
              providerId: execution.providerId,
              model: execution.model,
              reasoningLevel: execution.reasoningLevel,
              ...(execution.serviceTier === undefined
                ? {}
                : { serviceTier: execution.serviceTier }),
              executionInputSources: {
                providerId: "explicit" as const,
                model: "explicit" as const,
                reasoningLevel: "explicit" as const,
                ...(execution.serviceTier === undefined
                  ? {}
                  : { serviceTier: "explicit" as const }),
              },
            }),
      });
      // Marked only after the spawn succeeded, so a spawn that throws never
      // leaves a spinner running on a row nobody is working on.
      await patchRow(threadId, id, {
        expandingSince: new Date().toISOString(),
        expandedBy: helper.id,
        // Clears any previous verdict: this row is being looked at again.
        expandOutcome: null,
      });
      const record: ExpandingRecord = {
        threadId,
        id,
        usedExecution: execution !== null,
        retried,
      };
      await bb.storage.kv.set(expandingKey(helper.id), record);
      bb.log.info(
        `expanding follow-up ${id} on ${threadId} in ${helper.id}` +
          `${execution === null ? "" : ` (${execution.providerId}/${execution.model})`}` +
          `${retried ? " [retry]" : ""}`,
      );
      return { outcome: "started", helperThreadId: helper.id };
    } catch (error) {
      bb.log.error(`expand failed on ${threadId}: ${String(error)}`);
      return { outcome: "failed", helperThreadId: null };
    }
  }

  async function onExpansionSettled(
    helperThreadId: string,
    /** The error a `thread.failed` carried, or null when it settled idle. */
    failure: string | null,
  ): Promise<void> {
    const key = expandingKey(helperThreadId);
    const target = await bb.storage.kv.get<ExpandingRecord>(key);
    if (target === undefined || target === null) return;
    await bb.storage.kv.delete(key);

    // Archived first, and whatever happens next. `bb thread archive --self` is
    // the last line of the instructions, so every way of stopping early skips
    // it — and a hidden thread nobody archives is still a live thread holding
    // an environment. Doing it here covers the obedient and the disobedient
    // alike, and covers the retry path, which returns before the end.
    try {
      await bb.sdk.threads.archive({ threadId: helperThreadId });
    } catch (error) {
      bb.log.error(`could not archive expansion ${helperThreadId}: ${String(error)}`);
    }

    // One retry, on the project's defaults.
    //
    // The chosen model is stored globally and forever, so it outlives the thing
    // it names: uninstall that provider, or let the model be retired from the
    // catalog, and every describe fails from then on. It fails *here* rather
    // than at the spawn — a spawn naming a dead provider is accepted and the
    // thread then dies provisioning, with "has no bridge to run on" — so a
    // try/catch around the spawn would never have seen it. Verified by spawning
    // one: the call returned a thread id and the thread went straight to error.
    //
    // Retrying without the block is cheaper than probing the catalog first and
    // covers reasons we have not thought of, because it asks the only question
    // that matters: does this work without the part we chose? Bounded to one
    // attempt by `retried`, and skipped entirely when nothing was configured —
    // there is no second thing to try, and re-running the same spawn would turn
    // one honest failure into two.
    if (
      failure !== null &&
      target.usedExecution === true &&
      target.retried !== true
    ) {
      bb.log.warn(
        `expansion ${helperThreadId} failed on the chosen model (${failure});` +
          ` retrying ${target.id} on the project defaults`,
      );
      const again = await startExpansion(target.threadId, target.id, null, true);
      // Started means the row keeps its spinner and a second helper is running,
      // so there is no verdict to record yet. Anything else falls through and
      // the row is marked unresolved, which is the truth.
      if (again.outcome === "started") return;
    }

    // Judged by the row, not by the helper's own account of itself: a helper
    // that errored and one that decided the context was too thin are the same
    // thing from here, which is why the row records only whether it is better
    // off. `described` is not a claim the answer is good — only that there is
    // one to read.
    const items = await readItems(target.threadId);
    const row = items.find((entry) => entry.id === target.id);
    const described =
      row !== undefined && row.detail !== null && row.detail !== "";
    await patchRow(target.threadId, target.id, {
      expandingSince: null,
      expandOutcome: described ? "described" : "unresolved",
    });

    bb.log.info(
      `expansion ${helperThreadId} settled for ${target.id}: ${described ? "described" : "unresolved"}`,
    );
  }

  bb.events.on("thread.idle", ({ thread }) => {
    void onChildSettled(thread, "finished");
    void onExpansionSettled(thread.id, null);
  });
  bb.events.on("thread.failed", ({ thread, error }) => {
    void onChildSettled(thread, "failed");
    // `thread.failed` is the transition into `error`, which is where a thread
    // naming a provider that no longer exists ends up. The message is passed
    // through so the log names the real cause rather than "it stopped".
    void onExpansionSettled(thread.id, error ?? "no error message");
  });

  /**
   * Record a row the user wrote, from whichever surface they wrote it in.
   *
   * Shared by the composer's record button and `bb follow-up add`, so the two
   * cannot come to disagree about what a user-written row is. `createdBy` is
   * "user" in both, which is what `backfillRequest` keys on — an agent's row
   * came through a tool that asked for a file and a detail, so a gap there was
   * a decision; a gap in one of these was someone jotting.
   *
   * `reason` is optional here and required by the agent tool, deliberately.
   * "Why am I not doing this now" is a question an agent should have to answer
   * and a person should not.
   */
  async function addUserFollowUp(
    threadId: string,
    fields: {
      text: string;
      reason?: (typeof REASONS)[number] | null;
      detail?: string | null;
      file?: string | null;
    },
  ): Promise<{ outcome: AddOutcome; id: string | null }> {
    const [items, tombstones] = await Promise.all([
      readItems(threadId),
      readTombstones(threadId),
    ]);
    const row: FollowUp = {
      id: randomUUID().slice(0, 8),
      text: fields.text,
      reason: fields.reason ?? null,
      // The path an @-mention in the note pointed at, when it had one.
      file: fields.file ?? null,
      detail: fields.detail ?? null,
      createdAt: new Date().toISOString(),
      createdBy: "user",
    };
    // Same gate as the agent tool: a dismissed text stays dismissed, and a
    // duplicate is refused, whoever is asking.
    const { list, outcome } = addFollowUp(items, row, tombstones, await threadCap());
    if (outcome === "added") {
      await bb.storage.kv.set(itemsKey(threadId), list);
      await markEverRecorded(threadId);
      bb.log.info(`user recorded follow-up on ${threadId}: ${fields.text}`);
      bb.realtime.publish(FOLLOWUPS_CHANGED, { threadId });
    }
    return { outcome, id: outcome === "added" ? row.id : null };
  }

  async function markInProgress(threadId: string, id: string): Promise<FollowUp | null> {
    const items = await readItems(threadId);
    const target = items.find((row) => row.id === id);
    if (target === undefined) return null;
    if (target.sentAt) return target;
    await bb.storage.kv.set(
      itemsKey(threadId),
      items.map((row) =>
        row.id === id ? { ...row, sentAt: new Date().toISOString() } : row,
      ),
    );
    bb.log.info(`follow-up in progress on ${threadId}: ${target.text}`);
    bb.realtime.publish(FOLLOWUPS_CHANGED, { threadId });
    return target;
  }

  /**
   * Turn a mentioned row into agent context, and move it to in progress.
   *
   * Named rather than inlined as `resolve:` because "resolve" is the SDK's word
   * for expanding a mention, and this plugin needed it to stop meaning a second
   * thing. Completing a follow-up is `complete_follow_up`; this is the hand-off
   * that starts one.
   */
  async function handOffToAgent(itemId: string): Promise<{ context: string }> {
    const parsed = parseMentionItemId(itemId);
    if (parsed === null) return { context: "" };
    // One read for both switches this function consults, so a settings write
    // landing between them cannot produce a half-applied prompt.
    const current = await settings.get();
    const rows = await listIncludingInProgress(parsed.threadId);
    const row = rows.find((entry) => entry.id === parsed.id);
    if (row === undefined) {
      return { context: "This follow-up no longer exists." };
    }
    // Gated here rather than inside `markInProgress`, because the other caller
    // is a handoff to a child thread — that row really was delegated, and
    // `handoffState` is written beside it. Turning off "claim it when I mention
    // it" is an opinion about mentions, not about handoffs.
    if (current.markInProgressOnSend) {
      await markInProgress(parsed.threadId, parsed.id);
    }
    const lines = [`Follow-up (${row.reason}): ${row.text}`];
    if (row.file !== null) lines.push(`Anchored to: ${row.file}`);
    if (row.detail !== null && row.detail !== "") lines.push("", row.detail);
    // The one moment the row's id is provably in front of the agent that will
    // do the work. Saying so here is cheaper than any amount of standing
    // instruction telling it to go look the id up.
    lines.push(
      "",
      `If you finish this, call complete_follow_up with follow_up: "${row.id}"` +
        ` — that id is a tool argument, not something to repeat back to the user.`,
    );
    // Asked here, and only here, because this is the moment the gap can be
    // closed: an agent is being handed the row and is about to learn the very
    // things a jotted note leaves out. A standing instruction could not do it —
    // `contributeInstructions` is frozen for the life of a provider session, so
    // a note written mid-thread would not reach the agent until it restarted.
    const backfill = current.backfillAsk ? backfillRequest(row) : null;
    if (backfill !== null) lines.push("", backfill);
    return { context: lines.join("\n") };
  }

  bb.ui.registerMentionProvider({
    id: MENTION_PROVIDER,
    label: "Follow-ups",
    search: async ({ threadId, query }) => {
      if (threadId === null) return [];
      // Silence rather than deregistration: the provider is registered once at
      // load, and a setting that only took effect on the next reload would be a
      // switch that appears not to work. An empty result reads the same to the
      // host — the group simply has nothing in it.
      if (!(await settings.get()).mentionInAtMenu) return [];
      const rows = await listFollowUps(threadId);
      const needle = query.trim().toLowerCase();
      return rows
        .filter((row) => needle === "" || row.text.toLowerCase().includes(needle))
        .slice(0, 20)
        .map((row) => {
          // Either part can now be absent — a user-written row has no reason —
          // so the subtitle is composed rather than branched on the file alone.
          const subtitle = [row.reason, row.file]
            .filter((part): part is string => part !== null && part !== "")
            .join(" · ");
          return {
            id: mentionItemId(threadId, row.id),
            title: row.text,
            subtitle: subtitle === "" ? undefined : subtitle,
          };
        });
    },
    // Hands the agent the whole record — including `detail`, which the banner
    // never shows and plain-text insertion always dropped.
    resolve: handOffToAgent,
  });

  bb.agents.registerTool({
    name: "record_follow_up",
    description:
      "Record a piece of work you noticed but are not doing now, so it is not " +
      "lost when this turn ends. Call it once per follow-up, at the moment you " +
      "notice it.",
    instructions: TOOL_INSTRUCTIONS,
    // One glyph for the plugin: the manifest's branding icon, the timeline row
    // for every tool call, and the banner header all use TextWrap. Note the
    // manifest accepts BB icon names the frontend Icon component does not ship —
    // the scaffold's "ListTodo" is valid in the manifest but absent from the
    // 98-name frontend registry, so keeping it would have split the identity.
    presentation: {
      label: { pending: "Recording follow-up", completed: "Recorded follow-up" },
      icon: { glyph: "TextWrap" },
    },
    parameters: z.object({
      text: z
        .string()
        .trim()
        .min(1)
        .max(TEXT_MAX)
        .describe("The follow-up as one imperative line, e.g. 'Fix the flaky auth test'."),
      reason: z
        .enum(REASONS)
        .describe(
          "Why it is not being done now: out-of-scope, blocked, deferred, risk, or cleanup.",
        ),
      file: z
        .string()
        .trim()
        .max(200)
        .optional()
        .describe("Optional path, or path:line, this follow-up is anchored to."),
      detail: z
        .string()
        .trim()
        .max(DETAIL_MAX)
        .optional()
        .describe("Optional context a future reader would need to act on it."),
      priority: z
        .enum(["next", "normal"])
        .optional()
        .describe(
          "next places it at the front of the list, for something that should " +
            "be picked up before what is already recorded. Defaults to normal, " +
            "which appends it to the end.",
        ),
    }),
    async execute({ text, reason, file, detail, priority }, { threadId }) {
      const [items, tombstones] = await Promise.all([
        readItems(threadId),
        readTombstones(threadId),
      ]);
      const row: FollowUp = {
        id: randomUUID().slice(0, 8),
        text,
        reason,
        file: file ?? null,
        detail: detail ?? null,
        createdAt: new Date().toISOString(),
        createdBy: "agent",
      };
      const cap = await threadCap();
      const { list, outcome } = addFollowUp(items, row, tombstones, cap);

      switch (outcome) {
        case "added": {
          await bb.storage.kv.set(itemsKey(threadId), list);
          await markEverRecorded(threadId);
          bb.log.info(`recorded follow-up on ${threadId}: ${text}`);
          bb.realtime.publish(FOLLOWUPS_CHANGED, { threadId });
          // Placement goes through the same clamp as prioritize_follow_up, so
          // recording something as urgent can no more jump the user's own
          // arrangement than moving it later could.
          const placed =
            priority === "next"
              ? await moveOne(threadId, row.id, "top", "agent")
              : null;
          const where =
            placed === null
              ? ""
              : placed.blockedBy > 0
                ? ` Placed at the front of what you can order, below ${placed.blockedBy} follow-up${placed.blockedBy === 1 ? "" : "s"} the user placed by hand.`
                : " Placed at the front of the list.";
          // The id comes back so that finishing this later in the same session
          // needs no lookup — the common case for something you deferred and
          // then found time for. It is deliberately not the first thing in the
          // sentence any more: leading with it taught agents to repeat it, and
          // a hash names nothing the user can see. What was recorded is the
          // answer to "what happened"; the id is a handle for the next call.
          // Count what is open, not every row stored: done rows are in `list`
          // too, so this was reporting a larger number than any surface shows.
          const openCount = (await listFollowUps(threadId)).length;
          return (
            `Recorded "${row.text}". This thread now has ${openCount} ` +
            `follow-up${openCount === 1 ? "" : "s"}.${where}\n` +
            `(Tool-argument id, not for prose: ${row.id}.)`
          );
        }
        case "duplicate":
          return "Already recorded on this thread — not added again.";
        case "dismissed":
          return "The user dismissed this follow-up earlier; not re-adding it.";
        case "full":
          return `This thread already holds the maximum of ${cap} follow-ups. Nothing was added.`;
      }
    },
  });

  bb.agents.registerTool({
    name: "list_follow_ups",
    description:
      "List the follow-ups recorded on this thread, with their ids and current " +
      "state. Read this before answering what is outstanding, and to find the " +
      "id of a follow-up you did not record yourself.",
    instructions: LIST_TOOL_INSTRUCTIONS,
    presentation: {
      label: { pending: "Reading follow-ups", completed: "Read follow-ups" },
      icon: { glyph: "TextWrap" },
      // The only one of the five that changes nothing. "Ran list_follow_ups"
      // tells the reader what the agent looked at, which they can see for
      // themselves in the card above the composer — the SDK's own example of a
      // row worth collapsing is a bookkeeping call, and this is one. The other
      // four all write, and a write is worth a row whatever the volume.
      suppress: true,
    },
    parameters: z.object({
      include_done: z
        .boolean()
        .optional()
        .describe("Also list follow-ups already marked done. Defaults to false."),
    }),
    async execute({ include_done }, { threadId }) {
      const open = await listFollowUps(threadId);
      const lines = [formatListForAgent(open)];
      if (include_done === true) {
        const done = await listDone(threadId);
        if (done.length > 0) lines.push("", "Done:", formatListForAgent(done));
      }
      // Dismissed rows are deliberately absent: they are gone, and listing
      // them would invite arguing with a decision the user already made.
      return lines.join("\n");
    },
  });

  bb.agents.registerTool({
    name: "complete_follow_up",
    description:
      "Mark a follow-up on this thread done, because you finished the work it " +
      "names. Identify it by its text, or by the id if you have one — either " +
      "resolves, and the text is what you should be writing anyway.",
    instructions: COMPLETE_TOOL_INSTRUCTIONS,
    presentation: {
      label: { pending: "Closing follow-up", completed: "Closed follow-up" },
      icon: { glyph: "TextWrap" },
    },
    parameters: z.object({
      follow_up: z
        .string()
        .trim()
        .min(1)
        .max(TEXT_MAX)
        .describe(
          "The follow-up's id, or enough of its text to identify it uniquely.",
        ),
      note: z
        .string()
        .trim()
        .min(1)
        .max(TEXT_MAX)
        .describe(
          "What you actually did, in one line, specific enough for the user to " +
            "check it — e.g. 'Added the missing null guard in auth.ts:88'.",
        ),
    }),
    async execute({ follow_up, note }, { threadId }) {
      const candidates = await listIncludingInProgress(threadId);
      const match = matchFollowUp(candidates, follow_up);

      if (match.kind === "none") {
        const open = await listFollowUps(threadId);
        return [
          `No follow-up on this thread matches "${follow_up}". Nothing was changed.`,
          open.length === 0
            ? "This thread has no open follow-ups."
            : `Open follow-ups:\n${formatListForAgent(open)}`,
        ].join("\n");
      }
      if (match.kind === "ambiguous") {
        // Never guessed through: closing the wrong row records a completion
        // that did not happen, and the user would have no way to notice.
        return [
          `"${follow_up}" matches ${match.rows.length} follow-ups. Nothing was changed — call again with one of these ids:`,
          formatListForAgent(match.rows),
        ].join("\n");
      }
      if (isDone(match.row)) {
        return `Follow-up ${match.row.id} is already done: ${match.row.text}`;
      }

      const closed = await setDone(threadId, match.row.id, true, "agent", note);
      if (closed === null) {
        return `Follow-up ${match.row.id} no longer exists. Nothing was changed.`;
      }
      const remaining = await listFollowUps(threadId);
      return `Marked done: ${closed.text}\n${remaining.length} follow-up${remaining.length === 1 ? "" : "s"} still open on this thread.`;
    },
  });

  bb.agents.registerTool({
    name: "prioritize_follow_up",
    description:
      "Move a follow-up to the front or the back of this thread's list, when " +
      "you learn something that changes what should be picked up next.",
    instructions: PRIORITIZE_TOOL_INSTRUCTIONS,
    presentation: {
      label: { pending: "Reordering follow-ups", completed: "Reordered follow-ups" },
      icon: { glyph: "TextWrap" },
    },
    parameters: z.object({
      follow_up: z
        .string()
        .trim()
        .min(1)
        .max(TEXT_MAX)
        .describe("The follow-up's id, or enough of its text to identify it uniquely."),
      position: z
        .enum(["next", "later"])
        .describe(
          "next puts it at the front of the list; later sends it to the back.",
        ),
    }),
    async execute({ follow_up, position }, { threadId }) {
      const open = await listFollowUps(threadId);
      const match = matchFollowUp(open, follow_up);

      if (match.kind === "none") {
        return [
          `No open follow-up on this thread matches "${follow_up}". Nothing was moved.`,
          open.length === 0
            ? "This thread has no open follow-ups."
            : `Open follow-ups:\n${formatListForAgent(open)}`,
        ].join("\n");
      }
      if (match.kind === "ambiguous") {
        return [
          `"${follow_up}" matches ${match.rows.length} follow-ups. Nothing was moved — call again with one of these ids:`,
          formatListForAgent(match.rows),
        ].join("\n");
      }

      const moved = await moveOne(
        threadId,
        match.row.id,
        position === "next" ? "top" : "bottom",
        "agent",
      );
      if (moved === null) {
        return `Follow-up ${match.row.id} is no longer open. Nothing was moved.`;
      }
      // Saying the clamp out loud matters: silently landing mid-list would look
      // like the tool half-worked, and the agent would try again.
      const clamped =
        moved.blockedBy > 0
          ? ` It sits below ${moved.blockedBy} follow-up${moved.blockedBy === 1 ? "" : "s"} the user placed by hand, which stay where they are.`
          : "";
      return `Moved ${position === "next" ? "to the front" : "to the back"}: ${moved.row.text}.${clamped}\n${formatListForAgent(await listFollowUps(threadId))}`;
    },
  });

  bb.agents.registerTool({
    name: "amend_follow_up",
    description:
      "Correct or enrich a follow-up on this thread in place — sharpen its " +
      "wording, or attach what you have since learned — without losing the row.",
    instructions: AMEND_TOOL_INSTRUCTIONS,
    presentation: {
      label: { pending: "Amending follow-up", completed: "Amended follow-up" },
      icon: { glyph: "TextWrap" },
    },
    parameters: z.object({
      follow_up: z
        .string()
        .trim()
        .min(1)
        .max(TEXT_MAX)
        .describe("The follow-up's id, or enough of its text to identify it uniquely."),
      text: z
        .string()
        .trim()
        .min(1)
        .max(TEXT_MAX)
        .optional()
        .describe("Replacement one-line text. Omit to leave the wording alone."),
      detail: z
        .string()
        .trim()
        .max(DETAIL_MAX)
        .optional()
        .describe("Replacement detail — what a future reader needs to act on it."),
      file: z
        .string()
        .trim()
        .max(200)
        .optional()
        .describe("Replacement path, or path:line, this follow-up is anchored to."),
      reason: z
        .enum(REASONS)
        .optional()
        .describe("Replacement reason, when the situation changed — say, it became blocked."),
    }),
    async execute({ follow_up, text, detail, file, reason }, { threadId }) {
      const open = await listFollowUps(threadId);
      const match = matchFollowUp(open, follow_up);
      if (match.kind === "none") {
        return [
          `No open follow-up on this thread matches "${follow_up}". Nothing was changed.`,
          open.length === 0
            ? "This thread has no open follow-ups."
            : `Open follow-ups:\n${formatListForAgent(open)}`,
        ].join("\n");
      }
      if (match.kind === "ambiguous") {
        return [
          `"${follow_up}" matches ${match.rows.length} follow-ups. Nothing was changed — call again with one of these ids:`,
          formatListForAgent(match.rows),
        ].join("\n");
      }

      const result = await amendOne(
        threadId,
        match.row.id,
        { text, detail, file, reason },
        "agent",
      );
      switch (result.outcome) {
        case "amended":
          return `Amended ${match.row.id}: ${result.row?.text}`;
        case "forbidden":
          return (
            `Follow-up ${match.row.id} was written by the user, so its wording and ` +
            `reason are theirs to change. Nothing was changed — you can still add ` +
            `detail or a file anchor, or say what you think it should say.`
          );
        case "duplicate":
          return `That wording already belongs to another follow-up on this thread. Nothing was changed.`;
        case "dismissed":
          return `The user dismissed that wording earlier. Nothing was changed.`;
        case "unchanged":
          return `Follow-up ${match.row.id} already says that. Nothing was changed.`;
        case "not-found":
          return `Follow-up ${match.row.id} no longer exists. Nothing was changed.`;
      }
    },
  });

  /**
   * The execution flags `bb follow-up handoff` accepts, and how each maps onto
   * `threads.spawn`.
   *
   * `source` is not decoration. `NewThreadRequest` documents that the server
   * "drops a requested providerId/model that carries no provenance and
   * re-derives it from the project's stored defaults" — so a `--model` passed
   * without marking it explicit would be silently ignored, which is the very
   * bug this command is being given flags to fix.
   *
   * Names and values match `bb thread spawn` exactly. A follow-up handoff that
   * spelled its flags differently from the spawn command beside it would be a
   * worse answer than having no flags at all.
   */
  const EXECUTION_FLAGS = [
    { name: "provider", field: "providerId", allowed: null },
    { name: "model", field: "model", allowed: null },
    {
      name: "reasoning-level",
      field: "reasoningLevel",
      allowed: ["low", "medium", "high", "xhigh", "max"],
    },
    { name: "service-tier", field: "serviceTier", allowed: ["fast", "default"] },
    {
      name: "permission-mode",
      field: "permissionMode",
      allowed: ["accept-edits", "auto", "full"],
    },
  ] as const;

  const usage = [
    "Usage:",
    "  bb follow-up add <text> [--reason <r>]       Record one yourself",
    "                   [--detail <s>] [--file <s>]",
    "  bb follow-up show [--thread <id>] [-v] [--include-done] [--json]",
    "                                               Open follow-ups, in-progress ones last;",
    "                                               -v adds detail, --include-done also",
    "                                               lists finished ones",
    "  bb follow-up show --all [--json]             Every thread that recorded any",
    "  bb follow-up move <id> top|bottom            Place one at the front or the back",
    "  bb follow-up amend <id> [--text <s>]         Change one in place, keeping its id",
    "                         [--detail <s>] [--file <s>] [--reason <r>]",
    "  bb follow-up done <id> [--thread <id>]       Mark one finished",
    "  bb follow-up reopen <id> [--thread <id>]     Move one back out of Done",
    "  bb follow-up clear-done [--thread <id>]      Empty Done, releasing those texts",
    "  bb follow-up describe <id> [--thread <id>]   Have a helper write its detail",
    "  bb follow-up dismiss <id> [--thread <id>]    Drop one, and never record it again",
    "  bb follow-up clear [--thread <id>]           Drop this thread's follow-ups",
    "  bb follow-up handoff <id> [skill] [--new]    Send one to a new thread;",
    "                       [--provider <id>] [--model <m>]         --new makes it independent",
    "                       [--reasoning-level <l>] [--service-tier <t>]",
    "                       [--permission-mode <m>]",
    "  bb follow-up forget [--thread <id>]          Let dismissed follow-ups return",
  ].join("\n");

  /**
   * Remove a row and tombstone its text. Dismissal has to outlive the row
   * itself, or an agent that notices the same thing again resurrects it.
   * Shared by the banner's × and `bb follow-up dismiss`, so the only
   * tombstone writer in the plugin stays testable without a browser.
   */
  async function dismissFollowUp(
    threadId: string,
    id: string,
  ): Promise<{ dismissed: FollowUp | null; followUps: FollowUp[] }> {
    const items = await readItems(threadId);
    const target = items.find((row) => row.id === id);
    if (target === undefined) {
      return { dismissed: null, followUps: await listFollowUps(threadId) };
    }
    const tombstones = await readTombstones(threadId);
    const key = normalizeKey(target.text);
    if (!tombstones.includes(key)) {
      await bb.storage.kv.set(tombsKey(threadId), [...tombstones, key]);
    }
    await bb.storage.kv.set(
      itemsKey(threadId),
      items.filter((row) => row.id !== id),
    );
    bb.log.info(`dismissed follow-up on ${threadId}: ${target.text}`);
    bb.realtime.publish(FOLLOWUPS_CHANGED, { threadId });
    return { dismissed: target, followUps: await listFollowUps(threadId) };
  }

  const bothLists = async (threadId: string) => ({
    followUps: await listFollowUps(threadId),
    done: await listDone(threadId),
  });

  bb.rpc.register(rpcContract, {
    getFollowUpCountsV1: async ({ threadIds }) => {
      // Deduped, and first-seen order kept: a caller assembling a sidebar may
      // well name the same thread twice, and answering twice would be two
      // entries a consumer has to reconcile.
      const unique = [...new Set(threadIds)];
      const counts = await Promise.all(
        unique.map(async (threadId) => {
          // One read of each key, not two. `listFollowUps` and `listDone` each
          // read both the items and the tombstones, so calling them in turn
          // would double the storage work for an answer that is two numbers.
          const [items, tombstones] = await Promise.all([
            readItems(threadId),
            readTombstones(threadId),
          ]);
          return {
            threadId,
            open: openFollowUps(items, tombstones).length,
            done: doneFollowUps(items, tombstones).length,
          };
        }),
      );
      return { protocolVersion: FOLLOW_UP_COUNTS_PROTOCOL, counts };
    },
    followups_list: async ({ threadId }) => ({
      ...(await bothLists(threadId)),
      everRecorded: await readEverRecorded(threadId),
    }),
    followups_dismiss: async ({ threadId, id }) => {
      await dismissFollowUp(threadId, id);
      return bothLists(threadId);
    },
    followups_done: async ({ threadId, id, done }) => {
      await setDone(threadId, id, done);
      return bothLists(threadId);
    },
    followups_add: async ({ threadId, text, detail, file }) => {
      const { outcome, id } = await addUserFollowUp(threadId, { text, detail, file });
      return {
        outcome,
        // The caller expands the row it just made, so it needs the id
        // rather than having to match on text.
        id,
        ...(await bothLists(threadId)),
      };
    },
    followups_expand: async ({ threadId, id }) => {
      const started = await startExpansion(
        threadId,
        id,
        await readExpansionExecution(),
        false,
      );
      return started.outcome === "started"
        ? { outcome: "forked" as const, forkedThreadId: started.helperThreadId }
        : { outcome: started.outcome, forkedThreadId: null };
    },
    followups_expand_cancel: async ({ threadId, id }) => {
      const items = await readItems(threadId);
      const row = items.find((entry) => entry.id === id);
      if (row === undefined || !isExpanding(row)) {
        return { outcome: "not-expanding" as const, ...(await bothLists(threadId)) };
      }
      // Clear the row first. Stopping a thread can fail — it may have finished
      // a millisecond ago, or the daemon may refuse — and the user asked for
      // the row to stop claiming to be busy, which is the part we can promise.
      await patchRow(threadId, id, { expandingSince: null });
      const keys = await bb.storage.kv.list(EXPANDING_PREFIX);
      for (const key of keys) {
        const target = await bb.storage.kv.get<{ threadId: string; id: string }>(key);
        if (target?.threadId !== threadId || target.id !== id) continue;
        await bb.storage.kv.delete(key);
        try {
          await bb.sdk.threads.stop({ threadId: key.slice(EXPANDING_PREFIX.length) });
        } catch (error) {
          // Logged, not surfaced: the helper is already forgotten and the row
          // is already clear, so a thread left running is untidy rather than
          // wrong — and it archives itself or goes idle either way.
          bb.log.error(`could not stop expansion ${key}: ${String(error)}`);
        }
      }
      return { outcome: "cancelled" as const, ...(await bothLists(threadId)) };
    },
    followups_amend: async ({ threadId, id, ...patch }) => {
      const { outcome } = await amendOne(threadId, id, patch, "user");
      return { outcome, ...(await bothLists(threadId)) };
    },
    followups_reorder: async ({ threadId, orderedIds, movedId }) => {
      await reorderFollowUps(threadId, orderedIds, movedId);
      return bothLists(threadId);
    },
    followups_handoff_seed: async ({ threadId, id }) => {
      // Both ids come from the thread rather than the client: the caller
      // already proved which thread it is talking about, and asking it for a
      // project as well would be trusting a second answer to a question the
      // first one settles.
      const [thread, items] = await Promise.all([
        bb.sdk.threads.get({ threadId }),
        readItems(threadId),
      ]);
      // No id means the compose view is starting something new rather than
      // handing a row off; there is nothing to look up and nothing to seed the
      // draft with. The project and environment still are the point.
      const row = id === undefined ? null : (items.find((entry) => entry.id === id) ?? null);
      return {
        row,
        projectId: thread.projectId,
        environmentId: thread.environmentId,
        // The prompt the composer opens on. Built here, not in the client, so
        // the composed handoff and `bb follow-up handoff` cannot drift into
        // wording the other would not have produced.
        prompt: row === null ? "" : handoffPrompt(null, row),
      };
    },
    followups_handoff: async ({ threadId, id, target, request }) => ({
      ...(await handoffFollowUp(threadId, id, target, {
        kind: "composed",
        request,
      })),
      ...(await bothLists(threadId)),
    }),
    followups_suggest_next: async ({ threadId }) => {
      if (!(await settings.get()).offerSuggest) {
        return { outcome: "disabled" as const };
      }
      try {
        const result = await bb.sdk.threads.send({
          threadId,
          // `auto` is what pressing Enter does: start on an idle thread, and
          // fall back to the host's own busy handling otherwise. The card only
          // appears on an idle thread, so this starts — but naming a mode that
          // could not cope with a turn beginning between the render and the
          // click would be trusting the gap.
          mode: "auto",
          input: [
            { type: "text", text: SUGGEST_ASK, mentions: [] },
            // Reaches the model, never renders in the transcript. See the note
            // on SUGGEST_ASK for why the ask and the method are separate inputs
            // and for the check that this visibility actually holds.
            {
              type: "text",
              text: suggestMethod((await settings.get()).suggestHouseStyle),
              mentions: [],
              visibility: "agent-only",
            },
          ],
        });
        // A busy thread queues rather than refusing, and that is still a send
        // as far as the caller is concerned — but the card should say which,
        // because a queued turn has not started thinking yet.
        const outcome = result.delivery === "queued" ? ("queued" as const) : ("sent" as const);
        bb.log.info(`asked ${threadId} what to pick up next (${outcome})`);
        return { outcome };
      } catch (error) {
        bb.log.error(`suggest-next failed on ${threadId}: ${String(error)}`);
        return { outcome: "failed" as const };
      }
    },
    followups_expansion_execution: async () => ({
      execution: await readExpansionExecution(),
    }),
    followups_set_expansion_execution: async ({ execution }) => {
      if (execution === null) {
        await bb.storage.kv.delete(EXECUTION_KEY);
        bb.log.info("expansion helper reset to project defaults");
        return { execution: null };
      }
      await bb.storage.kv.set(EXECUTION_KEY, execution);
      bb.log.info(
        `expansion helper set to ${execution.providerId}/${execution.model} (${execution.reasoningLevel})`,
      );
      return { execution };
    },
    followups_start_thread: ({ threadId, request }) => startThread(threadId, request),
    followups_clear_done: async ({ threadId }) => ({
      cleared: await clearDone(threadId),
    }),
  });

  // Standing rule in every thread's instructions. Synchronous and allocation-free
  // on the hot path: this runs at thread.start and turn.submit.
  let captureRuleEnabled = (await settings.get()).captureRule;
  settings.onChange((next) => {
    captureRuleEnabled = next.captureRule;
  });
  bb.agents.contributeInstructions(() =>
    captureRuleEnabled ? CAPTURE_RULE : null,
  );

  bb.cli.register({
    name: "follow-up",
    summary: "Read and reset the follow-ups agents recorded on a thread",
    commands: [
      {
        name: "add",
        summary: "Record a follow-up yourself, the same row the composer records",
        usage:
          "bb follow-up add <text> [--reason <r>] [--detail <s>] [--file <s>] [--thread <id>] [--json]",
      },
      {
        name: "show",
        summary:
          "Show open follow-ups (-v for detail, --include-done to list finished ones too)",
        usage: "bb follow-up show [--thread <id>] [--all] [-v] [--include-done] [--json]",
      },
      {
        name: "move",
        summary: "Place a follow-up at the front or the back of the list",
        usage: "bb follow-up move <id> <top|bottom> [--thread <id>]",
      },
      {
        name: "amend",
        summary: "Change a follow-up in place, keeping its id, age and position",
        usage:
          "bb follow-up amend <id> [--text <s>] [--detail <s>] [--file <s>] [--reason <r>] [--thread <id>]",
      },
      {
        name: "done",
        summary: "Mark a follow-up finished; it moves to Done",
        usage: "bb follow-up done <id> [--thread <id>]",
      },
      {
        name: "reopen",
        summary: "Move a finished follow-up back to the open list",
        usage: "bb follow-up reopen <id> [--thread <id>]",
      },
      {
        name: "clear-done",
        summary: "Empty Done, so those follow-ups can be recorded again if they recur",
        usage: "bb follow-up clear-done [--thread <id>]",
      },
      {
        name: "describe",
        summary:
          "Have a short-lived helper read the thread and write a follow-up's detail",
        usage: "bb follow-up describe <id> [--thread <id>] [--json]",
      },
      {
        name: "dismiss",
        summary: "Dismiss one follow-up so it is never recorded on this thread again",
        usage: "bb follow-up dismiss <id> [--thread <id>] [--json]",
      },
      {
        name: "handoff",
        summary:
          "Send a follow-up to a new thread, optionally invoking a skill on it (a child of this one unless --new)",
        usage: "bb follow-up handoff <id> [skill] [--new] [--thread <id>] [--json]",
      },
      {
        name: "clear",
        summary: "Drop the follow-ups recorded on a thread",
        usage: "bb follow-up clear [--thread <id>]",
      },
      {
        name: "forget",
        summary: "Drop the dismissal record, so dismissed follow-ups can be recorded again",
        usage: "bb follow-up forget [--thread <id>]",
      },
    ],
    async run(argv, ctx) {
      const json = argv.includes("--json");
      const all = argv.includes("--all");
      const verbose = argv.includes("--verbose") || argv.includes("-v");
      // What this adds is done rows: `show` already lists in-progress ones,
      // sorted last. `--sent` still works — it named this flag back when a
      // sent row vanished from the open list, and it is in older notes.
      const includeDone = argv.includes("--include-done") || argv.includes("--sent");
      const wantDone = argv.includes("--done");
      // Every flag has to be stripped here, not just the ones `show` reads:
      // what is left is positional, so a flag left in becomes an argument. It
      // did — `handoff <id> --new` took "--new" as the skill name and sent a
      // prompt beginning "/--new".
      const rest = argv.filter(
        (arg) =>
          arg !== "--json" &&
          arg !== "--all" &&
          arg !== "--verbose" &&
          arg !== "-v" &&
          arg !== "--include-done" &&
          arg !== "--sent" &&
          arg !== "--done" &&
          arg !== "--new",
      );

      // Both the flag and its value have to leave the positionals, which is why
      // this goes through one helper rather than more index arithmetic. Only
      // the flags every command shares plus handoff's are taken here; `amend`
      // reads its own by index and its values are meaningless to anything else.
      const taken = takeValueFlags(rest, [
        "thread",
        ...EXECUTION_FLAGS.map((flag) => flag.name),
      ]);
      if (taken.missing !== null) {
        return { exitCode: 1, stderr: `--${taken.missing} needs a value.\n` };
      }
      const explicitThread = taken.values.thread;
      const args = taken.rest;
      const [command = "show"] = args;

      const threadId = explicitThread ?? ctx.threadId;
      const needsThread = () => ({
        exitCode: 1,
        stderr: "No thread in context — pass --thread <id>.\n",
      });

      switch (command) {
        case "help":
        case "--help":
          return { exitCode: 0, stdout: `${usage}\n` };

        case "handoff": {
          if (threadId === undefined) return needsThread();
          const [, id, skill] = args;
          if (id === undefined) {
            return {
              exitCode: 1,
              stderr: "Usage: bb follow-up handoff <id> [skill] [--new]\n",
            };
          }
          // `here` is deliberately absent: it only fills a composer, and there
          // is no composer on the far side of a CLI.
          const target = argv.includes("--new") ? ("thread" as const) : ("child" as const);

          // Build the execution options, and their provenance, from whatever
          // was actually passed. A flag nobody gave contributes nothing, so
          // omitting them all still means project defaults.
          const execution: Record<string, unknown> = {};
          const sources: Record<string, "explicit"> = {};
          for (const flag of EXECUTION_FLAGS) {
            const value = taken.values[flag.name];
            if (value === undefined) continue;
            if (flag.allowed !== null && !flag.allowed.includes(value as never)) {
              return {
                exitCode: 1,
                stderr: `--${flag.name} must be one of: ${flag.allowed.join(", ")}.\n`,
              };
            }
            execution[flag.field] = value;
            sources[flag.field] = "explicit";
          }
          const result = await handoffFollowUp(threadId, id, target, {
            kind: "prompt",
            skill: skill ?? null,
            ...(Object.keys(execution).length === 0
              ? {}
              : { execution: { ...execution, executionInputSources: sources } }),
          });
          if (json) return { exitCode: 0, stdout: `${JSON.stringify(result)}\n` };
          if (result.outcome !== "spawned") {
            return { exitCode: 1, stderr: `Handoff failed: ${result.outcome}\n` };
          }
          return {
            exitCode: 0,
            stdout: `Handed off to ${result.spawnedThreadId}${skill === undefined ? "" : ` as /${skill}`}${target === "child" ? " (child of this thread)" : ""}\n`,
          };
        }

        case "show": {
          if (all) {
            // The milestone-1 question in one command: did agents call the tool?
            const keys = await bb.storage.kv.list(ITEMS_PREFIX);
            const rows: { threadId: string; count: number }[] = [];
            for (const key of keys) {
              const id = key.slice(ITEMS_PREFIX.length);
              rows.push({ threadId: id, count: (await listFollowUps(id)).length });
            }
            const live = rows.filter((row) => row.count > 0);
            if (json) return { exitCode: 0, stdout: `${JSON.stringify(live)}\n` };
            if (live.length === 0) {
              return { exitCode: 0, stdout: "No thread has recorded a follow-up yet.\n" };
            }
            const text = live
              .map((row) => `${row.threadId}  ${row.count}`)
              .join("\n");
            return { exitCode: 0, stdout: `${text}\n` };
          }
          if (threadId === undefined) return needsThread();
          const list = wantDone
            ? await listDone(threadId)
            : includeDone
              ? await listIncludingInProgress(threadId)
              : await listFollowUps(threadId);
          if (json) return { exitCode: 0, stdout: `${JSON.stringify(list)}\n` };
          return { exitCode: 0, stdout: `${formatList(list, verbose)}\n` };
        }

        case "move": {
          if (threadId === undefined) return needsThread();
          const id = args[1];
          const position = args[2];
          if (id === undefined || (position !== "top" && position !== "bottom")) {
            return {
              exitCode: 1,
              stderr: "move needs a follow-up id and top or bottom.\n",
            };
          }
          const moved = await moveOne(threadId, id, position, "user");
          if (moved === null) {
            return {
              exitCode: 1,
              stderr: `No open follow-up with id ${id} on ${threadId}.\n`,
            };
          }
          return {
            exitCode: 0,
            stdout: `Moved to the ${position}: ${moved.row.text}\n`,
          };
        }

        case "amend": {
          if (threadId === undefined) return needsThread();
          const id = args[1];
          if (id === undefined) {
            return { exitCode: 1, stderr: "amend needs a follow-up id.\n" };
          }
          const patch: Record<string, string> = {};
          for (const field of ["text", "detail", "file", "reason"] as const) {
            const at = args.indexOf(`--${field}`);
            const value = at === -1 ? undefined : args[at + 1];
            if (at !== -1 && value === undefined) {
              return { exitCode: 1, stderr: `--${field} needs a value.\n` };
            }
            if (value !== undefined) patch[field] = value;
          }
          if (Object.keys(patch).length === 0) {
            return {
              exitCode: 1,
              stderr: "amend needs at least one of --text, --detail, --file, --reason.\n",
            };
          }
          if (patch.reason !== undefined && !REASONS.includes(patch.reason as never)) {
            return {
              exitCode: 1,
              stderr: `--reason must be one of: ${REASONS.join(", ")}.\n`,
            };
          }
          const result = await amendOne(threadId, id, patch, "user");
          if (result.outcome !== "amended") {
            return {
              exitCode: 1,
              stderr: `Not amended (${result.outcome}).\n`,
            };
          }
          return { exitCode: 0, stdout: `Amended: ${result.row?.text}\n` };
        }

        case "done":
        case "reopen": {
          if (threadId === undefined) return needsThread();
          const id = args[1];
          if (id === undefined) {
            return { exitCode: 1, stderr: `${command} needs a follow-up id.\n` };
          }
          const target = await setDone(threadId, id, command === "done");
          if (target === null) {
            return { exitCode: 1, stderr: `No follow-up with id ${id} on ${threadId}.\n` };
          }
          return {
            exitCode: 0,
            stdout: `${command === "done" ? "Done" : "Reopened"}: ${target.text}\n`,
          };
        }

        case "clear-done": {
          if (threadId === undefined) return needsThread();
          const cleared = await clearDone(threadId);
          return {
            exitCode: 0,
            stdout:
              `Cleared ${cleared} finished follow-up${cleared === 1 ? "" : "s"}. ` +
              `They can be recorded again if they recur.\n`,
          };
        }

        case "add": {
          if (threadId === undefined) return needsThread();
          // Its own flag pass rather than the one at the top, which would strip
          // these from `amend` too — that command scans `args` itself and would
          // stop seeing them. Stripping here is what lets the text be written
          // before or after its flags without the order mattering.
          const flags = takeValueFlags(args.slice(1), ["reason", "detail", "file"]);
          if (flags.missing !== null) {
            return { exitCode: 1, stderr: `--${flags.missing} needs a value.\n` };
          }
          // The bug this guards is one this CLI has already shipped once: an
          // unrecognised flag falls through as a positional, so `--resaon risk`
          // would silently become part of the follow-up's text.
          const stray = flags.rest.find((token) => token.startsWith("--"));
          if (stray !== undefined) {
            return { exitCode: 1, stderr: `Unknown flag ${stray}.\n` };
          }
          const text = flags.rest.join(" ").trim();
          if (text === "") {
            return { exitCode: 1, stderr: "add needs the follow-up text.\n" };
          }
          if (text.length > TEXT_MAX) {
            return {
              exitCode: 1,
              stderr: `The text must be ${TEXT_MAX} characters or fewer.\n`,
            };
          }
          const reason = flags.values.reason;
          if (reason !== undefined && !REASONS.includes(reason as never)) {
            return {
              exitCode: 1,
              stderr: `--reason must be one of: ${REASONS.join(", ")}.\n`,
            };
          }
          const detail = flags.values.detail;
          if (detail !== undefined && detail.length > DETAIL_MAX) {
            return {
              exitCode: 1,
              stderr: `The detail must be ${DETAIL_MAX} characters or fewer.\n`,
            };
          }
          const added = await addUserFollowUp(threadId, {
            text,
            ...(reason === undefined ? {} : { reason: reason as (typeof REASONS)[number] }),
            ...(detail === undefined ? {} : { detail }),
            ...(flags.values.file === undefined ? {} : { file: flags.values.file }),
          });
          if (json) return { exitCode: 0, stdout: `${JSON.stringify(added)}\n` };
          switch (added.outcome) {
            case "added":
              return { exitCode: 0, stdout: `Recorded ${added.id}: ${text}\n` };
            case "duplicate":
              return {
                exitCode: 1,
                stderr: "This thread already has that follow-up.\n",
              };
            case "dismissed":
              return {
                exitCode: 1,
                stderr:
                  "That follow-up was dismissed on this thread and will not come " +
                  "back. `bb follow-up forget` releases dismissed texts.\n",
              };
            default:
              return {
                exitCode: 1,
                stderr: "This thread is holding as many follow-ups as it may.\n",
              };
          }
        }

        case "describe": {
          // The same call the row's button makes, so the two cannot drift.
          // Without this the expansion path had no route but a click, which is
          // how a retry written around the wrong failure survived review: the
          // spawn does not throw on a dead provider, and nothing short of
          // running the feature would have shown that.
          if (threadId === undefined) return needsThread();
          const id = args[1];
          if (id === undefined) {
            return { exitCode: 1, stderr: "describe needs a follow-up id.\n" };
          }
          const started = await startExpansion(
            threadId,
            id,
            await readExpansionExecution(),
            false,
          );
          if (json) {
            return { exitCode: 0, stdout: `${JSON.stringify(started)}\n` };
          }
          switch (started.outcome) {
            case "started":
              return {
                exitCode: 0,
                stdout:
                  `Describing ${id} in ${started.helperThreadId}.\n` +
                  "It writes the detail onto the row and archives itself; " +
                  "`bb follow-up show -v` when it settles.\n",
              };
            case "not-found":
              return {
                exitCode: 1,
                stderr: `No follow-up with id ${id} on ${threadId}.\n`,
              };
            case "disabled":
              return {
                exitCode: 1,
                stderr:
                  "Describing is switched off. Turn on \"Offer Describe this in " +
                  "more detail\" in the plugin's settings, or run " +
                  "`bb plugin config follow-up set offerDescribe true`.\n",
              };
            default:
              return {
                exitCode: 1,
                stderr: `Could not start a helper for ${id}.\n`,
              };
          }
        }

        case "dismiss": {
          if (threadId === undefined) return needsThread();
          const id = args[1];
          if (id === undefined) {
            return { exitCode: 1, stderr: "dismiss needs a follow-up id.\n" };
          }
          const { dismissed, followUps } = await dismissFollowUp(threadId, id);
          if (dismissed === null) {
            return {
              exitCode: 1,
              stderr: `No follow-up with id ${id} on ${threadId}.\n`,
            };
          }
          if (json) return { exitCode: 0, stdout: `${JSON.stringify(followUps)}\n` };
          return {
            exitCode: 0,
            stdout: `Dismissed: ${dismissed.text}\nIt will not be recorded again on this thread.\n`,
          };
        }

        case "clear": {
          if (threadId === undefined) return needsThread();
          const count = (await listFollowUps(threadId)).length;
          await bb.storage.kv.delete(itemsKey(threadId));
          bb.realtime.publish(FOLLOWUPS_CHANGED, { threadId });
          return {
            exitCode: 0,
            stdout: `Cleared ${count} follow-up${count === 1 ? "" : "s"} from ${threadId}.\n`,
          };
        }

        case "forget": {
          if (threadId === undefined) return needsThread();
          const count = (await readTombstones(threadId)).length;
          await bb.storage.kv.delete(tombsKey(threadId));
          return {
            exitCode: 0,
            stdout: `Forgot ${count} dismissal${count === 1 ? "" : "s"} on ${threadId}.\n`,
          };
        }
      }

      return { exitCode: 1, stderr: `${usage}\n` };
    },
  });

  bb.onDispose(() => {
    bb.log.info("disposed");
  });
}
