// bb-plugin-follow-up — backend entry.
//
// Agents call `record_follow_up` while they work; the composer banner and the
// `bb follow-up` CLI read and triage what a thread accumulated.
//
// Deliberately absent: any background model call. Capture happens inside a
// turn the agent is already running, which is the whole point of the design.
import { randomUUID } from "node:crypto";
import {
  cliCommand,
  defineCli,
  defineRpcContract,
  PluginCliError,
  type BbPluginApi,
  type PluginCliContext,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
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
  TITLE_MAX,
  titleAndDetail,
  fileFollowUp,
  isFiled,
  isFiling,
  keysOf,
  unfiled,
  withMarks,
  withoutMarks,
  type FiledMark,
  type FiledTo,
  MENTION_PROVIDER,
  followUpMentionId,
  type FollowUp,
} from "./lib/followups.ts";
import {
  expansionExecutionSchema,
  SERVICE_TIER_MAX,
  type ExpansionExecution,
} from "./lib/expansion-execution.ts";
import { COMMAND_TIMEOUT_MS, hostContract } from "./lib/host-contract.ts";
import {
  commandEnv,
  commandStdin,
  approvalStillHolds,
  CONFIRM_FILING_RENDERER,
  type ConfirmFilingPayload,
  destinationSchema,
  DESTINATIONS_MAX,
  filedToOf,
  filingPrompt,
  refFromOutput,
  findDestination,
  parseDestinations,
  slugFor,
  type Destination,
} from "./lib/destinations.ts";
import {
  doAsk,
  isShowable,
  makeOffer,
  NEXT_STEP_MAX,
  NEXT_STEPS_MAX,
  normalizeStep,
  parseOffer,
  stepAt,
  withoutStep,
  type NextOffer,
} from "./lib/next-steps.ts";
import {
  checkWrapUp,
  dispositionSchema,
  failedMessage,
  GIT_WORKTREE,
  newWorktreeEnvironment,
  type Disposition,
  type EnvironmentShape,
  type WrapUpRecord,
} from "./lib/wrap-up.ts";
import {
  activityLabel,
  approvalResolution,
  asksFor,
  capFinished,
  cardFor,
  cardSchema,
  combineFamilies,
  countOf,
  DECISIONS,
  familyOf,
  foldRunning,
  groupFollowUps,
  inMotion,
  isBusy,
  isUnread,
  laneGroupSchema,
  MERGE_METHODS,
  PAGE_CHANGED,
  parsePutAway,
  pendingAsk,
  prAction,
  prOwners,
  prSummary,
  rank,
  REPLY_MAX,
  runningSchema,
  STRIP_MAX,
  threadFacts,
  type LaneInput,
  type MergeMethod,
  type PendingAsk,
  type PrSummary,
  type RunningWorker,
  type ThreadFacts,
} from "./lib/page.ts";

/** Global, not per-thread: settings have no project or thread scope. */
const EXECUTION_KEY = "expansion-execution";
/** Where follow-ups can be filed: defined once, for every project. */
const DESTINATIONS_KEY = "destinations";
/**
 * Each project's default destination, the one File all uses. Per project
 * because the tracker and the backlog differ from repo to repo; set the first
 * time someone picks a destination there, and changed from the same menu.
 */
const DEFAULT_DESTINATION_PREFIX = "default-destination:";
const defaultDestinationKey = (projectId: string) => `${DEFAULT_DESTINATION_PREFIX}${projectId}`;

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
  filedAt: z.string().nullable().optional(),
  filedTo: z.object({ id: z.string(), name: z.string() }).nullable().optional(),
  filedRef: z.string().nullable().optional(),
  filingSince: z.string().nullable().optional(),
  filingBy: z.enum(["agent", "user"]).nullable().optional(),
  filingTo: z.string().nullable().optional(),
  filingNote: z.string().nullable().optional(),
});

const nextOfferSchema = z
  .object({
    steps: z.array(z.string()),
    goalMet: z.boolean(),
    offeredAt: z.string(),
  })
  .strict();

/** Which step of which offer a press is about. */
const nextStepRef = z
  .object({
    threadId: z.string().min(1).max(200),
    offeredAt: z.string().min(1).max(64),
    index: z.number().int().min(0).max(NEXT_STEPS_MAX - 1),
  })
  .strict();

/** A wrap-up under way, or held short of the archive, as the app sees it. */
const wrapUpStateSchema = z
  .object({
    status: z.enum(["running", "held"]),
    archive: z.boolean(),
    held: z.string().nullable(),
    waitingOn: z.number().int(),
    failed: z.array(z.object({ id: z.string(), note: z.string() }).strict()),
  })
  .strict();

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
  /** The steps offered under this thread's latest reply. See lib/next-steps.ts. */
  followups_next_get: {
    input: z.object({ threadId: z.string().min(1).max(200) }).strict(),
    output: z.object({ offer: nextOfferSchema.nullable() }).strict(),
  },
  /**
   * Press a step: send its text as the user's message. `offeredAt` names the
   * offer the button belonged to, so a press that lands after the offer was
   * replaced is `stale` rather than a different step sent by index.
   */
  followups_next_take: {
    input: nextStepRef,
    output: z
      .object({ outcome: z.enum(["sent", "queued", "stale", "failed"]) })
      .strict(),
  },
  /**
   * Keep a step as a follow-up instead of doing it now. The step leaves the
   * offer; the rest stay pressable.
   */
  followups_next_keep: {
    input: nextStepRef,
    output: z
      .object({
        outcome: z.enum(["added", "duplicate", "dismissed", "filed", "full", "stale"]),
        offer: nextOfferSchema.nullable(),
        followUps: z.array(followUpSchema),
        done: z.array(followUpSchema),
      })
      .strict(),
  },
  /** Put the offer away without sending anything. */
  followups_next_clear: {
    input: z.object({ threadId: z.string().min(1).max(200) }).strict(),
    output: z.object({ ok: z.literal(true) }).strict(),
  },
  /**
   * "Do" on the top follow-up: hand it to this thread's agent now, the way a
   * mention pill would on send, without going through the composer.
   */
  /** The destinations set up in Settings, and this project's default among them. */
  followups_destinations: {
    input: z
      .object({
        projectId: z.string().min(1).max(200).nullable(),
        /** Or the thread whose project to ask about, for a surface that knows only that. */
        threadId: z.string().min(1).max(200).optional(),
      })
      .strict(),
    output: z
      .object({
        destinations: z.array(destinationSchema),
        defaultId: z.string().nullable(),
      })
      .strict(),
  },
  /** Replace the whole list, from the Settings section that edits it. */
  followups_set_destinations: {
    input: z
      .object({ destinations: z.array(destinationSchema).max(DESTINATIONS_MAX) })
      .strict(),
    output: z
      .object({
        outcome: z.enum(["saved", "duplicate-name"]),
        destinations: z.array(destinationSchema),
      })
      .strict(),
  },
  /**
   * File rows to a destination: the named one, or this project's default.
   * Returns at once — a command per row, or a helper thread, can take a while,
   * and the rows say "filing…" until each lands. Null ids means every open row.
   */
  followups_file: {
    input: z
      .object({
        threadId: z.string().min(1).max(200),
        ids: z.array(z.string().min(1).max(64)).min(1).max(CAP_CEILING).nullable(),
        destinationId: z.string().min(1).max(60).nullable(),
      })
      .strict(),
    output: z
      .object({
        outcome: z.enum(["started", "no-destination", "unknown-destination", "nothing-to-file"]),
        destinationId: z.string().nullable(),
        count: z.number().int(),
      })
      .strict(),
  },
  /**
   * Whether this thread is wrapping up, or was held short of the archive: the
   * card's status line. The popup's fuller read is `followups_wrap_up_get`.
   */
  followups_wrap_up_state: {
    input: z.object({ threadId: z.string().min(1).max(200) }).strict(),
    output: z.object({ state: wrapUpStateSchema.nullable() }).strict(),
  },
  /**
   * What the Wrap up popup needs beyond the rows the card already holds:
   * whether a wrap-up is under way or was held, whether a hand-off can go to a
   * new worktree, and the child threads an archive would take with it.
   */
  followups_wrap_up_get: {
    input: z.object({ threadId: z.string().min(1).max(200) }).strict(),
    output: z
      .object({
        state: wrapUpStateSchema.nullable(),
        newWorktree: z.boolean(),
        children: z.object({ open: z.number().int(), running: z.number().int() }).strict(),
      })
      .strict(),
  },
  /**
   * Carry out a wrap-up: one disposition per open row, then the archive if
   * asked for. `plan` has to name every open row not already being filed, and
   * nothing else — a row that arrived while the person was deciding has not
   * been decided about, so the whole request is refused rather than half done.
   */
  followups_wrap_up: {
    input: z
      .object({
        threadId: z.string().min(1).max(200),
        plan: z
          .array(z.object({ id: z.string().min(1).max(64), disposition: dispositionSchema }).strict())
          .max(CAP_CEILING),
        archive: z.boolean(),
      })
      .strict(),
    output: z
      .object({
        outcome: z.enum(["archived", "finished", "waiting", "held", "changed", "running", "busy", "failed"]),
        message: z.string().nullable(),
      })
      .strict(),
  },
  /** Let go of a held wrap-up: the card stops saying the thread was not archived. */
  followups_wrap_up_forget: {
    input: z.object({ threadId: z.string().min(1).max(200) }).strict(),
    output: z.object({ forgotten: z.boolean() }).strict(),
  },
  /** Make one destination this project's default, or clear it. */
  followups_set_default_destination: {
    input: z
      .object({
        projectId: z.string().min(1).max(200),
        id: z.string().min(1).max(60).nullable(),
      })
      .strict(),
    output: z.object({ defaultId: z.string().nullable() }).strict(),
  },
  followups_next_do: {
    input: z
      .object({
        threadId: z.string().min(1).max(200),
        id: z.string().min(1).max(64),
      })
      .strict(),
    output: z
      .object({ outcome: z.enum(["sent", "queued", "gone", "failed"]) })
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
        outcome: z.enum(["added", "duplicate", "dismissed", "filed", "full"]),
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
          "filed",
          "forbidden",
          "too-long",
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
  /**
   * Everything the Follow Up page shows, in one round trip: a card for each
   * thread that wants you, the threads in motion, and every open follow-up.
   * The rules are lib/page.ts; this only gathers what they read.
   */
  page_snapshot: {
    input: z.object({}).strict(),
    output: z
      .object({
        cards: z.array(cardSchema),
        /** Cards put away with "Not now", for the Put away fold. */
        putAway: z.array(cardSchema),
        moreFinished: z.number().int(),
        count: z.number().int(),
        running: z.array(runningSchema),
        followUps: z.array(laneGroupSchema),
        /** Project names, so a card can say where its thread lives. */
        projects: z.array(z.object({ id: z.string(), name: z.string() }).strict()),
      })
      .strict(),
  },
  /**
   * The sidebar's count and the new-thread strip's first cards. The same
   * cards as the page, without the lanes, because the sidebar asks on every
   * change whether or not the page is open.
   */
  page_summary: {
    input: z.object({}).strict(),
    output: z.object({ count: z.number().int(), top: z.array(cardSchema) }).strict(),
  },
  /**
   * Answer a thread's question from its card. Refused as `stale` once the
   * question is no longer pending — answered in the thread, in another window,
   * or interrupted — so a late press never answers something else.
   */
  page_answer: {
    input: z
      .object({
        threadId: z.string().min(1).max(200),
        interactionId: z.string().min(1).max(200),
        answers: z.record(
          z.string().min(1).max(200),
          z
            .object({
              selected: z.array(z.string().max(2000)).max(50),
              freeText: z.string().max(REPLY_MAX).optional(),
            })
            .strict(),
        ),
      })
      .strict(),
    output: z.object({ outcome: z.enum(["answered", "stale", "failed"]) }).strict(),
  },
  /**
   * Answer an approval from its card, exactly as bb's own approval card does
   * (approvalResolution). Refused as `stale` once it is no longer pending, and
   * as `refused` for a choice the approval does not offer. `note` goes with
   * "Keep planning" on a plan: the plan is denied, then the note is steered
   * into the live turn, or starts one, as typing it in the composer would.
   */
  page_approve: {
    input: z
      .object({
        threadId: z.string().min(1).max(200),
        interactionId: z.string().min(1).max(200),
        decision: z.enum(DECISIONS),
        note: z.string().trim().min(1).max(REPLY_MAX).optional(),
      })
      .strict(),
    output: z
      .object({
        outcome: z.enum(["answered", "stale", "refused", "failed"]),
        noted: z.enum(["sent", "queued", "failed"]).nullable(),
      })
      .strict(),
  },
  /**
   * Send a message into a thread as you: a card's reply box, an edited next
   * step, or a pull request's prefilled message. The text is exactly what the
   * box showed when you pressed send.
   */
  page_reply: {
    input: z
      .object({
        threadId: z.string().min(1).max(200),
        text: z.string().trim().min(1).max(REPLY_MAX),
      })
      .strict(),
    output: z.object({ outcome: z.enum(["sent", "queued", "failed"]) }).strict(),
  },
  page_mark_read: {
    input: z.object({ threadId: z.string().min(1).max(200) }).strict(),
    output: z.object({ outcome: z.enum(["done", "failed"]) }).strict(),
  },
  page_archive: {
    input: z.object({ threadId: z.string().min(1).max(200) }).strict(),
    output: z.object({ outcome: z.enum(["done", "failed"]) }).strict(),
  },
  /**
   * "Not now": put this card away until something new happens on its thread,
   * or its pull request changes. `at` is the attention mark the card was
   * showing, so a press that lands after the thread moved on hides nothing
   * newer than what you saw; `pr` is the PR state it showed (`prKey`).
   */
  page_hide: {
    input: z
      .object({
        threadId: z.string().min(1).max(200),
        at: z.number().int().min(0),
        pr: z.string().max(200).nullable().optional(),
      })
      .strict(),
    output: z.object({ outcome: z.enum(["done"]) }).strict(),
  },
  /** Bring put-away cards back: "Undo" after Not now, and the Put away fold. */
  page_unhide: {
    input: z.object({ threadIds: z.array(z.string().min(1).max(200)).min(1).max(100) }).strict(),
    output: z.object({ outcome: z.enum(["done"]) }).strict(),
  },
  /** Re-run a failed turn with bb's own retry. */
  page_retry: {
    input: z.object({ threadId: z.string().min(1).max(200) }).strict(),
    output: z.object({ outcome: z.enum(["retrying", "failed"]) }).strict(),
  },
  /** Stop a thread that is in motion. */
  page_stop: {
    input: z.object({ threadId: z.string().min(1).max(200) }).strict(),
    output: z.object({ outcome: z.enum(["stopped", "failed"]) }).strict(),
  },
  /**
   * Merge the pull request on this thread's worktree. The first merge in a
   * project has no method yet and answers `needs-method`; the method it is
   * then called with becomes that project's, and later merges use it.
   *
   * `tell` is the message the card showed beside the button, sent to the
   * thread once the merge lands: an agent that opened a pull request is often
   * waiting to hear it merged before it goes on. Not sent when the merge does
   * not happen.
   */
  page_pr_merge: {
    input: z
      .object({
        threadId: z.string().min(1).max(200),
        method: z.enum(MERGE_METHODS).optional(),
        tell: z.string().trim().min(1).max(REPLY_MAX).optional(),
      })
      .strict(),
    output: z
      .object({
        outcome: z.enum(["merged", "needs-method", "not-ready", "failed"]),
        method: z.enum(MERGE_METHODS).nullable(),
        message: z.string().nullable(),
        /** Whether the thread was told, when it was asked to be. */
        told: z.enum(["sent", "queued", "failed"]).nullable(),
      })
      .strict(),
  },
  /**
   * Start a review thread for this thread's pull request, in the same
   * worktree, with the prompt the card showed you. A child of the author's
   * thread: the review is the author's delegated work, so it reports back
   * there, folds into the author's card on the page, and its findings, if
   * recorded as follow-ups, carry up to the author.
   */
  page_pr_review: {
    input: z
      .object({
        threadId: z.string().min(1).max(200),
        prompt: z.string().trim().min(1).max(REPLY_MAX),
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
   * "Archive the merged workers" on a family card. Archives only the workers
   * the card listed that are, still, workers of that family whose pull request
   * merged — never one the card did not show, and never one that moved on in
   * between.
   */
  page_archive_workers: {
    input: z
      .object({
        parentThreadId: z.string().min(1).max(200),
        threadIds: z.array(z.string().min(1).max(200)).min(1).max(100),
      })
      .strict(),
    output: z.object({ archived: z.number().int(), skipped: z.number().int() }).strict(),
  },
  /**
   * Hand a follow-up to a new thread in its own thread's checkout, from the
   * page's follow-ups lane — `bb follow-up handoff` without a skill. The row
   * is done on its old thread, saying where it went.
   */
  page_handoff: {
    input: z.object({ threadId: z.string().min(1).max(200), id: z.string().min(1).max(64) }).strict(),
    output: z
      .object({
        outcome: z.enum(["spawned", "not-found", "no-environment", "failed"]),
        spawnedThreadId: z.string().nullable(),
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

// The mention provider id and the pill's item id are shared with the banner,
// which reads pills back out of the draft: see lib/followups.ts.
const mentionItemId = followUpMentionId;

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
/**
 * The steps the agent offered at the end of this thread's latest turn. One
 * value per thread, replaced on every offer and deleted when a turn starts:
 * see lib/next-steps.ts for why an offer never outlives its turn.
 */
const NEXT_PREFIX = "next:";
/** Texts this thread filed somewhere, which may not be recorded here again. */
const FILED_PREFIX = "filed:";

const itemsKey = (threadId: string) => `${ITEMS_PREFIX}${threadId}`;
const tombsKey = (threadId: string) => `${TOMBS_PREFIX}${threadId}`;
const expandingKey = (helperThreadId: string) => `${EXPANDING_PREFIX}${helperThreadId}`;
const seenKey = (threadId: string) => `${SEEN_PREFIX}${threadId}`;
const nextKey = (threadId: string) => `${NEXT_PREFIX}${threadId}`;
/** Which rows a filing helper thread was given, so its settling can be noticed. */
const FILING_HELPER_PREFIX = "filing-helper:";
const filingHelperKey = (helperThreadId: string) => `${FILING_HELPER_PREFIX}${helperThreadId}`;
const filedKey = (threadId: string) => `${FILED_PREFIX}${threadId}`;

/**
 * Frontend refetch signal for offers, separate from FOLLOWUPS_CHANGED because
 * an offer changes on every turn and the list mostly does not: sharing one
 * signal would refetch every row twice a turn to learn nothing.
 */
const NEXT_CHANGED = "followups-next-changed";

/** Destinations or a project's default changed: menus that list them refetch. */
const DESTINATIONS_CHANGED = "followups-destinations-changed";

/** A thread's wrap-up, while it waits on filings or after it was held. */
const WRAP_UP_PREFIX = "wrap-up:";
const wrapUpKey = (threadId: string) => `${WRAP_UP_PREFIX}${threadId}`;
/** A wrap-up started, settled, or was let go of: its card line refetches. */
const WRAP_UP_CHANGED = "followups-wrap-up-changed";
/** Thread statuses with a turn under way, or about to be. */
const BUSY_STATUSES: ReadonlySet<string> = new Set(["active", "pending", "starting", "stopping"]);

/** How long a burst of host changes is gathered into one page refetch. */
const PAGE_SIGNAL_MS = 250;
/** "Not now" on a card: the thread's attention mark when it was pressed. */
const HIDDEN_PREFIX = "page-hidden:";
const hiddenKey = (threadId: string) => `${HIDDEN_PREFIX}${threadId}`;
/** Each project's merge method, asked the first time a card merges there. */
const MERGE_METHOD_PREFIX = "merge-method:";
const mergeMethodKey = (projectId: string) => `${MERGE_METHOD_PREFIX}${projectId}`;
/** The review thread a card started, and for which pull request. */
const REVIEW_PREFIX = "page-review:";
const reviewKey = (threadId: string) => `${REVIEW_PREFIX}${threadId}`;
/** How long a pull request lookup is good for before a page asks again. */
const PR_TTL_MS = 5 * 60 * 1000;
/** Pull request lookups at once. 76 worktrees on one host is not unusual. */
const PR_CONCURRENCY = 4;
/** Events read to say what a running thread is doing. */
const ACTIVITY_EVENTS = "60";
/** Started items read to find a file change an approval is about. */
const FILE_CHANGE_EVENTS = "200";

/** An approval of a file change, whose diff is read from the thread's events. */
function namesFileChange(ask: PendingAsk | null): boolean {
  return ask?.kind === "approval" && ask.detail.kind === "file_change" && ask.detail.itemId !== "";
}

/** The thread changes that can move a card. Everything else — every streamed delta — cannot. */
const PAGE_RELEVANT_CHANGES: ReadonlySet<string> = new Set([
  "interactions-changed",
  "read-state-changed",
  "status-changed",
  "archived-changed",
  "thread-created",
  "thread-deleted",
  "title-changed",
  "queue-changed",
  // Families fold by parent, and a worktree's PR goes to the thread that
  // opened it: either can move a card without any of the above changing.
  "parent-changed",
  "environment-changed",
]);

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
  `The text is a title of at most ${TITLE_MAX} characters that names the specific`,
  "thing (\"Fix the flaky auth-timeout test\", not \"Fix the test\"). It is what the",
  "list, a button and an issue title show. Put the why, where and how in detail.",
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

const FILE_TOOL_INSTRUCTIONS = [
  "When the user asks to move follow-ups to wherever they track work — \"add these",
  "to the backlog\", \"file the out-of-scope ones in Jira\" — call file_follow_ups.",
  "It files them to a destination the user set up, by name, or to the project's",
  "default when you leave the destination out; filed rows leave this thread's list",
  "and are not recorded here again.",
  "",
  "Do not file on your own initiative. Unless the user turned it off, they are",
  "asked to confirm each time, and a request they did not expect is one they will",
  "decline.",
].join("\n");

const OFFER_TOOL_INSTRUCTIONS = [
  "When your reply would end by offering to do something in this thread — \"Want",
  "me to open a PR?\", \"Shall I add the test?\" — call offer_next_steps with it,",
  "once, as the last thing you do in the turn. Each step becomes a button under",
  "your reply, and pressing it sends that same text as the user's message — the",
  "button shows exactly what will be sent, so write each step as the user's own",
  "instruction: \"Open a PR against main\", not \"PR\".",
  "",
  "Offer only what you would do here, now, if the user said yes. Work that",
  "belongs somewhere else is a follow-up, not a next step. Offering nothing is a",
  "real answer: when nothing follows naturally, do not invent something to fill",
  "the row.",
].join("\n");

/**
 * The standing rule for offers, injected beside CAPTURE_RULE when the setting
 * is on. Same reasoning as that one: a tool snippet alone is an offer agents
 * do not take up, and the buttons are only worth having if they are there
 * after the turns where a reply ends with a question.
 */
const NEXT_RULE = [
  "Next steps: when you end a turn by asking whether to do something next in",
  "this thread, call `offer_next_steps` with it so the user can answer with one",
  "click. Each step is both the button and the message it sends, so write it",
  "as the user's own short instruction to you (\"Open a PR against main\"). At",
  `most ${NEXT_STEPS_MAX}. Set \`goal_met\` when what this thread set out to do is done.`,
  "",
  "An offer is not a follow-up. Something you would do here on a yes is a next",
  "step; something you are not going to do here is a follow-up. Do not record",
  "the same work as both.",
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
    offerNextSteps: {
      type: "boolean",
      label: "Let agents offer next steps",
      description:
        "When an agent's reply ends with \u201cwant me to\u2026?\u201d, the answers " +
        "appear as buttons under it. Pressing one sends it as your " +
        "message; nothing is sent until you do. Turn it off and agents are not " +
        "told about the buttons, and any offer they make anyway is refused.",
      default: true,
    },
    agentFileWithoutAsking: {
      type: "boolean",
      label: "Let agents file follow-ups without asking",
      description:
        "When an agent files follow-ups to one of your destinations, you are asked " +
        "first with one tap: filing writes to your tracker or backlog, and an agent " +
        "steered by something it read could otherwise open issues there. Turn this " +
        "on to let it file straight away.",
      default: false,
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
    offerOnEveryThread: {
      type: "boolean",
      label: "Offer the empty state on every thread",
      description:
        "The card shown once a thread's follow-ups are all closed normally waits " +
        "until that thread has recorded one, so the plugin stays silent on threads " +
        "it has nothing to say about. Turn this on to offer it above the composer " +
        "of any thread with nothing outstanding. It stays out of the way while a " +
        "turn is running either way.",
      default: false,
    },
    offerSuggest: {
      type: "boolean",
      label: 'Offer "Suggest what\'s next"',
      description:
        "The button shown once a thread's follow-ups are all closed. It writes " +
        "a message into your own conversation when you press it, as a next-step " +
        "button does. Turn it off and it is not offered.",
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

  async function readDestinations(): Promise<Destination[]> {
    return parseDestinations(await bb.storage.kv.get<unknown>(DESTINATIONS_KEY));
  }

  /** This project's default, as long as it is still set up. */
  async function readDefaultDestination(projectId: string | null): Promise<Destination | null> {
    if (projectId === null) return null;
    const id = await bb.storage.kv.get<string>(defaultDestinationKey(projectId));
    if (typeof id !== "string") return null;
    return (await readDestinations()).find((destination) => destination.id === id) ?? null;
  }

  /** The project a thread belongs to, or null when it has none or is gone. */
  async function projectOf(threadId: string): Promise<string | null> {
    try {
      return (await bb.sdk.threads.get({ threadId })).projectId ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Mark rows as being filed, or stop marking them — with a note saying why,
   * when the filing did not land. One write and one signal for the batch.
   */
  async function setFiling(
    threadId: string,
    ids: readonly string[],
    state: { by: "agent" | "user"; to: string } | { note: string | null },
  ): Promise<void> {
    const items = await readItems(threadId);
    const now = new Date().toISOString();
    await bb.storage.kv.set(
      itemsKey(threadId),
      items.map((row) => {
        if (!ids.includes(row.id) || isFiled(row)) return row;
        return "by" in state
          ? { ...row, filingSince: now, filingBy: state.by, filingTo: state.to, filingNote: null }
          : { ...row, filingSince: null, filingBy: null, filingTo: null, filingNote: state.note };
      }),
    );
    bb.realtime.publish(FOLLOWUPS_CHANGED, { threadId });
    // A filing that did not land may be the one a wrap-up was waiting on.
    if (!("by" in state)) void settleWrapUp(threadId);
  }

  /**
   * What became of one row a filing was asked for. "pending": handed to a
   * helper thread, which will report it, or not, when it is done.
   */
  type FilingReport = {
    id: string;
    text: string;
    outcome: "filed" | "failed" | "pending";
    ref: string | null;
    note: string | null;
  };

  type FilingHelperRecord = { threadId: string; ids: string[]; destination: string };

  /**
   * An agent-recipe destination: one hidden helper for the whole batch, in the
   * thread's own checkout, so its `bb follow-up filed` lands on these rows. It
   * runs on the destination's model, or the describing helper's, or the
   * project's defaults — the same fallback Describe uses.
   */
  async function fileByAgent(
    threadId: string,
    rows: readonly FollowUp[],
    destination: Destination,
  ): Promise<FilingReport[]> {
    const ids = rows.map((row) => row.id);
    const fail = async (note: string) => {
      await setFiling(threadId, ids, { note });
      return rows.map((row) => ({ id: row.id, text: row.text, outcome: "failed" as const, ref: null, note }));
    };
    const thread = await bb.sdk.threads.get({ threadId });
    if (thread.environmentId === null || thread.environmentId === undefined) {
      return fail("This thread has no checkout for a helper to work in.");
    }
    const execution = destination.execution ?? (await readExpansionExecution());
    let helperId: string;
    try {
      const helper = await bb.sdk.threads.spawn({
        projectId: thread.projectId,
        environment: { type: "reuse", environmentId: thread.environmentId },
        prompt: filingPrompt(rows, destination, threadId),
        // Housekeeping the user asked for, not work to watch; it archives
        // itself, and is archived for it when it settles either way.
        visibility: "hidden",
        origin: "plugin",
        originPluginId: "follow-up",
        ...(execution === null
          ? {}
          : {
              providerId: execution.providerId,
              model: execution.model,
              reasoningLevel: execution.reasoningLevel,
              ...(execution.serviceTier === undefined ? {} : { serviceTier: execution.serviceTier }),
              executionInputSources: {
                providerId: "explicit" as const,
                model: "explicit" as const,
                reasoningLevel: "explicit" as const,
                ...(execution.serviceTier === undefined ? {} : { serviceTier: "explicit" as const }),
              },
            }),
      });
      helperId = helper.id;
    } catch (error) {
      return fail(`Could not start the ${destination.name} helper: ${String(error)}`.slice(0, 300));
    }
    const record: FilingHelperRecord = { threadId, ids, destination: destination.name };
    await bb.storage.kv.set(filingHelperKey(helperId), record);
    bb.log.info(`handed ${ids.length} follow-up(s) on ${threadId} to ${destination.name} helper ${helperId}`);
    return rows.map((row) => ({ id: row.id, text: row.text, outcome: "pending" as const, ref: null, note: null }));
  }

  /**
   * A filing helper stopped. Whatever it reported is filed already; whatever
   * it did not is open again, saying so. Archived either way, since a hidden
   * thread nobody archives is still a thread holding an environment.
   */
  async function onFilingSettled(helperThreadId: string, failure: string | null): Promise<void> {
    const key = filingHelperKey(helperThreadId);
    const record = await bb.storage.kv.get<FilingHelperRecord>(key);
    if (record === undefined || record === null) return;
    await bb.storage.kv.delete(key);
    try {
      await bb.sdk.threads.archive({ threadId: helperThreadId });
    } catch (error) {
      bb.log.error(`could not archive filing helper ${helperThreadId}: ${String(error)}`);
    }
    const items = await readItems(record.threadId);
    const unfiled = items
      .filter((row) => record.ids.includes(row.id) && !isFiled(row) && row.filingSince)
      .map((row) => row.id);
    if (unfiled.length === 0) return;
    const note =
      failure === null
        ? `The ${record.destination} helper finished without filing this.`
        : `The ${record.destination} helper stopped: ${failure}`.slice(0, 300);
    await setFiling(record.threadId, unfiled, { note });
  }

  const hostClient = bb.hosts.experimental_client({ contract: hostContract });

  /** The last line of output worth showing, for a note on a row that did not file. */
  const lastLine = (text: string) =>
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== "")
      .at(-1) ?? "";

  /**
   * A command destination: run once per row, on the host the thread lives on,
   * in its checkout. Exit 0 files the row with whatever ref its output gives;
   * anything else leaves the row open with the reason on it.
   */
  async function fileByCommand(
    threadId: string,
    rows: readonly FollowUp[],
    destination: Destination,
    by: "agent" | "user",
  ): Promise<FilingReport[]> {
    let where: { hostId: string; path: string } | { problem: string };
    try {
      const thread = await bb.sdk.threads.get({ threadId });
      if (thread.environmentId === null || thread.environmentId === undefined) {
        where = { problem: "This thread has no checkout to run the command in." };
      } else {
        const environment = await bb.sdk.environments.get({ environmentId: thread.environmentId });
        where =
          environment.path === null || environment.path === ""
            ? { problem: "This thread's checkout has no path on its host." }
            : { hostId: environment.hostId, path: environment.path };
      }
    } catch (error) {
      where = { problem: `Could not find this thread's checkout: ${String(error)}` };
    }

    const reports: FilingReport[] = [];
    for (const row of rows) {
      if ("problem" in where) {
        await setFiling(threadId, [row.id], { note: where.problem });
        reports.push({ id: row.id, text: row.text, outcome: "failed", ref: null, note: where.problem });
        continue;
      }
      let note: string;
      try {
        const result = await hostClient.call(
          "run_command",
          {
            command: destination.command ?? "",
            cwd: where.path,
            env: commandEnv(row, threadId),
            stdin: commandStdin(row, threadId),
            timeoutMs: COMMAND_TIMEOUT_MS,
          },
          // A little longer than the command's own limit, so the host reports
          // the timeout rather than the call giving up first.
          { hostId: where.hostId, timeoutMs: COMMAND_TIMEOUT_MS + 15_000 },
        );
        if (result.exitCode === 0) {
          const ref = refFromOutput(result.stdout);
          await markFiled(threadId, row.id, filedToOf(destination), ref, by);
          reports.push({ id: row.id, text: row.text, outcome: "filed", ref, note: null });
          continue;
        }
        const said = lastLine(result.stderr) || lastLine(result.stdout);
        note = result.timedOut
          ? `${destination.name} timed out after ${COMMAND_TIMEOUT_MS / 1000}s.`
          : `${destination.name} exited ${result.exitCode ?? "abnormally"}${said === "" ? "." : `: ${said}`}`;
      } catch (error) {
        note = `Could not run ${destination.name} on this thread's host: ${String(error)}`;
      }
      note = note.slice(0, 300);
      await setFiling(threadId, [row.id], { note });
      bb.log.warn(`filing to ${destination.name} failed on ${threadId}: ${note}`);
      reports.push({ id: row.id, text: row.text, outcome: "failed", ref: null, note });
    }
    return reports;
  }

  /**
   * File rows to a destination, whatever its kind. The rows are marked as
   * being filed first, so every surface shows it while this runs; anything
   * that escapes leaves them open with the reason rather than spinning.
   */
  async function fileRows(
    threadId: string,
    rows: readonly FollowUp[],
    destination: Destination,
    by: "agent" | "user",
    /** The caller marked them already, before answering whoever asked. */
    marked = false,
  ): Promise<FilingReport[]> {
    const ids = rows.map((row) => row.id);
    if (!marked) await setFiling(threadId, ids, { by, to: destination.name });
    try {
      return destination.kind === "command"
        ? await fileByCommand(threadId, rows, destination, by)
        : await fileByAgent(threadId, rows, destination);
    } catch (error) {
      const note = `Filing to ${destination.name} failed: ${String(error)}`.slice(0, 300);
      await setFiling(threadId, ids, { note });
      return rows.map((row) => ({ id: row.id, text: row.text, outcome: "failed" as const, ref: null, note }));
    }
  }

  /**
   * Which rows and which destination a filing request means, or why it means
   * nothing. Shared by the card, the CLI and the agent tool.
   */
  async function resolveFiling(
    threadId: string,
    ids: readonly string[] | null,
    destinationName: string | null,
  ): Promise<
    | { outcome: "ok"; rows: FollowUp[]; destination: Destination; projectId: string | null }
    | { outcome: "no-destination" | "unknown-destination" | "nothing-to-file" }
  > {
    // Rows first: nobody should be asked to pick a destination for nothing.
    // Open rows not already on their way somewhere, since filing one twice
    // would file it twice.
    const open = (await listFollowUps(threadId)).filter((row) => !isFiling(row));
    const rows = ids === null ? open : open.filter((row) => ids.includes(row.id));
    if (rows.length === 0) return { outcome: "nothing-to-file" };
    const projectId = await projectOf(threadId);
    let destination: Destination | null;
    if (destinationName === null) {
      destination = await readDefaultDestination(projectId);
      if (destination === null) return { outcome: "no-destination" };
    } else {
      destination = findDestination(await readDestinations(), destinationName);
      if (destination === null) return { outcome: "unknown-destination" };
    }
    return { outcome: "ok", rows, destination, projectId };
  }

  async function readFiledMarks(threadId: string): Promise<FiledMark[]> {
    return (await bb.storage.kv.get<FiledMark[]>(filedKey(threadId))) ?? [];
  }

  /**
   * File one row: done, with where it went, and its text kept from coming
   * back. The one writer of the filed state — the CLI a helper reports through,
   * a command destination's result and a person's own `bb follow-up filed` all
   * land here.
   */
  async function markFiled(
    threadId: string,
    id: string,
    to: FiledTo,
    ref: string | null,
    fallbackBy: "agent" | "user",
  ): Promise<{ outcome: "filed" | "not-found" | "already-filed"; row: FollowUp | null }> {
    const [items, marks] = await Promise.all([readItems(threadId), readFiledMarks(threadId)]);
    const target = items.find((row) => row.id === id);
    const result = fileFollowUp(items, id, {
      to,
      ref,
      at: new Date().toISOString(),
      // Whoever asked for the filing, when one was in flight: the helper that
      // reports it is only the messenger.
      by: target?.filingBy ?? fallbackBy,
    });
    if (result.outcome !== "filed") return { outcome: result.outcome, row: result.row };
    await bb.storage.kv.set(itemsKey(threadId), result.list);
    await bb.storage.kv.set(filedKey(threadId), withMarks(marks, result.marks));
    bb.log.info(`filed follow-up on ${threadId} to ${to.name}: ${result.row?.text}`);
    bb.realtime.publish(FOLLOWUPS_CHANGED, { threadId });
    void settleWrapUp(threadId);
    return { outcome: "filed", row: result.row };
  }

  async function wrapUpView(
    threadId: string,
    record: WrapUpRecord | null,
  ): Promise<z.infer<typeof wrapUpStateSchema> | null> {
    if (record === null) return null;
    // What is still on its way, not what was sent: the card counts down.
    const rows = await readItems(threadId);
    const now = Date.now();
    const pending = record.waitingOn.filter((id) => {
      const row = rows.find((entry) => entry.id === id);
      return row !== undefined && isFiling(row, now);
    });
    return {
      status: record.held === null ? "running" : "held",
      archive: record.archive,
      held: record.held,
      waitingOn: pending.length,
      failed: record.failures.map(({ id, note }) => ({ id, note })),
    };
  }

  async function readWrapUp(threadId: string): Promise<WrapUpRecord | null> {
    return (await bb.storage.kv.get<WrapUpRecord>(wrapUpKey(threadId))) ?? null;
  }

  async function writeWrapUp(threadId: string, record: WrapUpRecord | null): Promise<void> {
    if (record === null) await bb.storage.kv.delete(wrapUpKey(threadId));
    else await bb.storage.kv.set(wrapUpKey(threadId), record);
    bb.realtime.publish(WRAP_UP_CHANGED, { threadId });
  }

  /**
   * One change to a thread's wrap-up at a time. Two filings can land together
   * and each asks to settle; side by side, both could read "landed" and
   * archive twice, or a turn starting could hold a wrap-up a settle had
   * already read as landed.
   */
  const wrapUpQueue = new Map<string, Promise<unknown>>();
  function onWrapUpQueue<T>(threadId: string, run: () => Promise<T>): Promise<T> {
    const previous = wrapUpQueue.get(threadId) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(run);
    wrapUpQueue.set(threadId, next);
    void next
      .finally(() => {
        if (wrapUpQueue.get(threadId) === next) wrapUpQueue.delete(threadId);
      })
      .catch(() => {});
    return next;
  }

  type WrapUpSettled = "none" | "waiting" | "archived" | "held";
  const settleWrapUp = (threadId: string) => onWrapUpQueue(threadId, () => settleWrapUpNow(threadId));

  /**
   * Archive the thread once everything its wrap-up sent has landed, or hold
   * it open, saying why, once something has not. Asked whenever a filing
   * lands or fails, and when the popup reads the state, so a filing that went
   * quiet still settles the next time anyone looks.
   */
  async function settleWrapUpNow(threadId: string): Promise<WrapUpSettled> {
    const record = await readWrapUp(threadId);
    if (record === null) return "none";
    if (record.held !== null) return "held";
    if (!record.dispatched) return "waiting";
    const check = checkWrapUp(record, await readItems(threadId));
    if (check.outcome === "waiting") return "waiting";
    if (check.outcome === "held") {
      await writeWrapUp(threadId, { ...record, failures: check.failed, held: failedMessage(check.failed, true) });
      bb.log.warn(`wrap-up on ${threadId} held: ${check.failed.length} did not land`);
      return "held";
    }
    // Gone before the archive, so a restart between the two cannot leave an
    // archived thread saying it is still wrapping up.
    await writeWrapUp(threadId, null);
    try {
      await bb.sdk.threads.archive({ threadId });
    } catch (error) {
      await writeWrapUp(threadId, {
        ...record,
        held: `Everything landed, but the thread could not be archived: ${String(error)}`.slice(0, 300),
      });
      return "held";
    }
    bb.log.info(`wrapped up and archived ${threadId}`);
    return "archived";
  }

  /**
   * How to ask for a new worktree for a hand-off from this thread, or null
   * where there cannot be one: no checkout, not a git repository, or no
   * git-worktree provider available for its project on its machine.
   */
  async function worktreeFor(thread: {
    projectId?: string | null;
    environmentId?: string | null;
  }): Promise<Record<string, unknown> | null> {
    if (thread.environmentId === null || thread.environmentId === undefined) return null;
    try {
      const environment = await bb.sdk.environments.get({ environmentId: thread.environmentId });
      const request = newWorktreeEnvironment(environment as unknown as EnvironmentShape);
      if (request === null) return null;
      const providers = await bb.sdk.environments.listProviders({
        ...(thread.projectId ? { projectId: thread.projectId } : {}),
        hostId: environment.hostId,
      });
      const provider = providers.find((entry) => entry.id === GIT_WORKTREE);
      const available = provider !== undefined && (provider.availability?.status ?? "available") === "available";
      return available ? request : null;
    } catch {
      return null;
    }
  }

  const HANDOFF_FAILED: Record<"not-found" | "no-environment" | "failed", string> = {
    "not-found": "It was no longer here to hand off.",
    "no-environment": "This thread has no checkout to hand off from.",
    failed: "The new thread could not be started.",
  };

  /**
   * Carry out a wrap-up. Quick dispositions happen here, in order; filings are
   * marked before any starts, so a filing that lands at once never finds
   * another the wrap-up has not marked yet and archives early.
   */
  async function startWrapUp(
    threadId: string,
    plan: readonly { id: string; disposition: Disposition }[],
    archive: boolean,
  ): Promise<{
    outcome: "archived" | "finished" | "waiting" | "held" | "changed" | "running" | "busy" | "failed";
    message: string | null;
  }> {
    const existing = await readWrapUp(threadId);
    if (existing !== null && existing.held === null) {
      return { outcome: "busy", message: "This thread is already wrapping up." };
    }
    let thread: Awaited<ReturnType<typeof bb.sdk.threads.get>>;
    try {
      thread = await bb.sdk.threads.get({ threadId });
    } catch {
      return { outcome: "failed", message: "Could not read this thread." };
    }
    if (BUSY_STATUSES.has(thread.status)) {
      return { outcome: "running", message: "The agent is still working. Wrap up once it stops." };
    }
    const open = await listFollowUps(threadId);
    const deciding = open.filter((row) => !isFiling(row));
    const planned = new Map(plan.map((entry) => [entry.id, entry.disposition]));
    const changed = {
      outcome: "changed" as const,
      message: "The follow-ups changed while you were deciding. Check them and wrap up again.",
    };
    if (planned.size !== plan.length || planned.size !== deciding.length) return changed;
    if (!deciding.every((row) => planned.has(row.id))) return changed;

    const destinations = await readDestinations();
    const groups = new Map<string, { destination: Destination; rows: FollowUp[] }>();
    for (const row of deciding) {
      const disposition = planned.get(row.id)!;
      if (disposition.kind !== "file") continue;
      const destination = destinations.find((entry) => entry.id === disposition.destinationId);
      if (destination === undefined) {
        return { outcome: "changed", message: "A destination you picked is no longer set up." };
      }
      const group = groups.get(destination.id) ?? { destination, rows: [] };
      group.rows.push(row);
      groups.set(destination.id, group);
    }
    let worktree: Record<string, unknown> | null = null;
    if ([...planned.values()].some((entry) => entry.kind === "handoff" && entry.where === "new-worktree")) {
      worktree = await worktreeFor(thread);
      if (worktree === null) {
        return { outcome: "failed", message: "This thread's checkout cannot have a new worktree." };
      }
    }

    // Kept only when there is an archive to wait for. Leaving the thread
    // open, there is nothing to settle: each row's filing shows on the row.
    const record: WrapUpRecord = {
      startedAt: new Date().toISOString(),
      archive,
      // Rows already on their way when the popup opened hold the archive too.
      waitingOn: open.filter((row) => isFiling(row)).map((row) => row.id),
      failures: [],
      dispatched: false,
      held: null,
    };
    if (archive) await writeWrapUp(threadId, record);

    for (const row of deciding) {
      const disposition = planned.get(row.id)!;
      if (disposition.kind === "done") await setDone(threadId, row.id, true, "user");
      else if (disposition.kind === "dismiss") await dismissFollowUp(threadId, row.id);
      else if (disposition.kind === "handoff") {
        const handed = await handoffFollowUp(threadId, row.id, "thread", {
          kind: "prompt",
          skill: null,
          ...(disposition.where === "new-worktree" && worktree !== null ? { environment: worktree } : {}),
        });
        if (handed.outcome !== "spawned") {
          record.failures.push({ id: row.id, text: row.text, note: HANDOFF_FAILED[handed.outcome] });
        }
      }
    }
    for (const { destination, rows } of groups.values()) {
      await setFiling(threadId, rows.map((row) => row.id), { by: "user", to: destination.name });
      record.waitingOn.push(...rows.map((row) => row.id));
    }
    // The first destination picked in a project becomes its default, here as
    // in the card's own File to.
    const firstPicked = groups.values().next().value?.destination;
    if (firstPicked !== undefined && thread.projectId !== null && thread.projectId !== undefined) {
      const known = await bb.storage.kv.get<string>(defaultDestinationKey(thread.projectId));
      if (typeof known !== "string") {
        await bb.storage.kv.set(defaultDestinationKey(thread.projectId), firstPicked.id);
        bb.realtime.publish(DESTINATIONS_CHANGED, {});
      }
    }
    if (archive) await writeWrapUp(threadId, { ...record, dispatched: true });
    for (const { destination, rows } of groups.values()) {
      void fileRows(threadId, rows, destination, "user", true);
    }
    bb.log.info(
      `wrap-up on ${threadId}: ${plan.length} decided, ${record.waitingOn.length} filing, archive ${archive}`,
    );

    const settled = await settleWrapUp(threadId);
    const after = await readWrapUp(threadId);
    switch (settled) {
      case "archived":
        return { outcome: "archived", message: null };
      case "held":
        return { outcome: "held", message: after?.held ?? null };
      case "waiting":
        return { outcome: "waiting", message: null };
      default:
        return {
          outcome: "finished",
          message: record.failures.length === 0 ? null : failedMessage(record.failures, false),
        };
    }
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

  /** The offer under this thread's latest reply, or null. */
  async function readOffer(threadId: string): Promise<NextOffer | null> {
    return parseOffer(await bb.storage.kv.get<unknown>(nextKey(threadId)));
  }

  /**
   * Replace the offer, or delete it with null, and tell the card. A delete of
   * an offer that is not there writes and publishes nothing: a turn starting
   * clears the offer, and most turns start on a thread that has none.
   */
  async function writeOffer(threadId: string, offer: NextOffer | null): Promise<void> {
    if (offer === null) {
      if ((await bb.storage.kv.get<unknown>(nextKey(threadId))) === undefined) return;
      await bb.storage.kv.delete(nextKey(threadId));
    } else {
      await bb.storage.kv.set(nextKey(threadId), offer);
    }
    bb.realtime.publish(NEXT_CHANGED, { threadId });
  }

  /**
   * Send a message into this thread as the user, the way pressing Enter would.
   *
   * `queue-if-active` starts a turn on an idle thread and queues behind a busy
   * one. Not `auto`, which despite the name steers: it puts the message into
   * the running turn. The card only offers buttons on an idle thread, but a
   * turn can begin between the render and the click, and the Follow Up page's
   * "Queue a message" is pressed on a thread that is running by definition.
   * Shared by every button that sends: a next step, "Do" on the top
   * follow-up, Suggest, and the page's replies.
   */
  async function sendAsUser(
    threadId: string,
    input: Array<{ text: string; agentOnly?: boolean }>,
    mode: "queue-if-active" | "auto" = "queue-if-active",
  ): Promise<"sent" | "queued"> {
    const result = await bb.sdk.threads.send({
      threadId,
      mode,
      input: input.map((part) => ({
        type: "text" as const,
        text: part.text,
        mentions: [],
        ...(part.agentOnly === true ? { visibility: "agent-only" as const } : {}),
      })),
    });
    return result.delivery === "queued" ? "queued" : "sent";
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
        /**
         * Where the new thread runs. Omitted, this thread's own checkout;
         * Wrap up passes a new worktree's request here when asked for one.
         */
        environment?: Record<string, unknown>;
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
        // Reuse, so the handoff lands in the same checkout the row is about,
        // unless the caller asked for somewhere else.
        environment: spawnWith.environment ?? { type: "reuse", environmentId: thread.environmentId },
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
    // Reopening a filed row makes it this thread's again: no longer filed,
    // and its text free to stand on its own here.
    if (!done && isFiled(target)) {
      const marks = await readFiledMarks(threadId);
      await bb.storage.kv.set(filedKey(threadId), withoutMarks(marks, keysOf(target)));
    }
    await bb.storage.kv.set(
      itemsKey(threadId),
      items.map((row) =>
        row.id === id
          ? {
              ...(done ? row : unfiled(row)),
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
    const [items, tombstones, filed] = await Promise.all([
      readItems(threadId),
      readTombstones(threadId),
      readFiledMarks(threadId),
    ]);
    const result = amendFollowUp(items, id, patch, by, tombstones, filed);
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
    const marks = await readFiledMarks(parent);
    let list = items;
    let added = 0;
    for (const row of carried) {
      const result = addFollowUp(
        list,
        carriedFromChild(row, child, randomUUID().slice(0, 8), new Date().toISOString()),
        tombstones,
        cap,
        marks,
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
    void onFilingSettled(thread.id, null);
  });
  bb.events.on("thread.failed", ({ thread, error }) => {
    void onChildSettled(thread, "failed");
    // `thread.failed` is the transition into `error`, which is where a thread
    // naming a provider that no longer exists ends up. The message is passed
    // through so the log names the real cause rather than "it stopped".
    void onExpansionSettled(thread.id, error ?? "no error message");
    void onFilingSettled(thread.id, error ?? "no error message");
  });

  /**
   * Record a row the user wrote, from whichever surface they wrote it in.
   *
   * Shared by recording the draft (the send-menu row and its command), the
   * message action and `bb follow-up add`, so they cannot come to disagree
   * about what a user-written row is. `createdBy` is "user" in all of them,
   * which is what `backfillRequest` keys on — an agent's row came through a
   * tool that asked for a file and a detail, so a gap there was a decision; a
   * gap in one of these was someone jotting.
   *
   * `reason` is optional here and required by the agent tool, deliberately.
   * "Why am I not doing this now" is a question an agent should have to answer
   * and a person should not.
   *
   * Never refused for length either: past TITLE_MAX the start becomes the title
   * and the whole of what was written leads the detail (`titleAndDetail`). The
   * agent tool refuses a long title instead, because an agent can write a
   * better one than a cut can.
   */
  async function addUserFollowUp(
    threadId: string,
    fields: {
      text: string;
      reason?: (typeof REASONS)[number] | null;
      detail?: string | null;
      file?: string | null;
    },
  ): Promise<{ outcome: AddOutcome; id: string | null; text: string }> {
    const [items, tombstones] = await Promise.all([
      readItems(threadId),
      readTombstones(threadId),
    ]);
    const split = titleAndDetail(fields.text, fields.detail ?? null);
    const row: FollowUp = {
      id: randomUUID().slice(0, 8),
      text: split.text,
      reason: fields.reason ?? null,
      // The path an @-mention in the note pointed at, when it had one.
      file: fields.file ?? null,
      detail: split.detail,
      createdAt: new Date().toISOString(),
      createdBy: "user",
    };
    // Same gate as the agent tool: a dismissed text stays dismissed, and a
    // duplicate is refused, whoever is asking.
    const { list, outcome } = addFollowUp(
      items,
      row,
      tombstones,
      await threadCap(),
      await readFiledMarks(threadId),
    );
    if (outcome === "added") {
      await bb.storage.kv.set(itemsKey(threadId), list);
      await markEverRecorded(threadId);
      bb.log.info(`user recorded follow-up on ${threadId}: ${row.text}`);
      bb.realtime.publish(FOLLOWUPS_CHANGED, { threadId });
    }
    return { outcome, id: outcome === "added" ? row.id : null, text: row.text };
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
    return { context: rowContext(row, current.backfillAsk) };
  }

  /**
   * One row's whole record, as the agent that is about to work on it reads it.
   * Shared by the mention pill and the card's "Do" button, which are two ways
   * of handing the same row to the same agent.
   */
  function rowContext(row: FollowUp, backfillAsk: boolean): string {
    // A row a person wrote has no reason, and "(null)" is what interpolating
    // one used to print.
    const lines = [
      row.reason === null
        ? `Follow-up: ${row.text}`
        : `Follow-up (${row.reason}): ${row.text}`,
    ];
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
    const backfill = backfillAsk ? backfillRequest(row) : null;
    if (backfill !== null) lines.push("", backfill);
    return lines.join("\n");
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
        .max(TITLE_MAX)
        .describe(
          `A short title, at most ${TITLE_MAX} characters, naming the specific thing: ` +
            "'Fix the flaky auth-timeout test'. Everything else goes in detail.",
        ),
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
        .describe(
          "What the title leaves out: why it matters, where it is, how to do it — " +
            "whatever a future reader needs to act on it.",
        ),
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
      const { list, outcome, filedAs } = addFollowUp(
        items,
        row,
        tombstones,
        cap,
        await readFiledMarks(threadId),
      );

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
        case "filed":
          return (
            `This was filed to ${filedAs?.to ?? "a destination"} from this thread earlier` +
            `${filedAs?.ref ? ` (${filedAs.ref})` : ""}, so it is tracked there; not re-adding it.`
          );
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
        .max(TITLE_MAX)
        .optional()
        .describe(
          `Replacement title, at most ${TITLE_MAX} characters. Omit to leave the wording alone.`,
        ),
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
        case "filed": {
          const to = result.filedAs;
          const where = to === undefined ? "elsewhere" : `to ${to.to}${to.ref === null ? "" : ` (${to.ref})`}`;
          return `That wording was filed ${where} from this thread, so it is tracked there. Nothing was changed.`;
        }
        case "unchanged":
          return `Follow-up ${match.row.id} already says that. Nothing was changed.`;
        case "not-found":
          return `Follow-up ${match.row.id} no longer exists. Nothing was changed.`;
        case "too-long":
          return (
            `A follow-up's text is a title of at most ${TITLE_MAX} characters. Nothing ` +
            `was changed — shorten it, and put the rest in detail.`
          );
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
    { name: "provider", field: "providerId" },
    { name: "model", field: "model" },
    { name: "reasoning-level", field: "reasoningLevel" },
    { name: "service-tier", field: "serviceTier" },
    { name: "permission-mode", field: "permissionMode" },
  ] as const;


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

  /**
   * The gate on filing an agent asked for, whichever way it asked — the
   * file_follow_ups tool, or `bb follow-up file` run from inside a thread.
   *
   * Unless the user switched the question off, they are asked with one tap on
   * the thread the request came from, shown all of what each row sends. Then
   * the rows and the destination are resolved again and held to what was
   * shown: a row filed or closed meanwhile is not filed, and one reworded or a
   * destination edited voids the answer.
   */
  async function confirmedFiling(
    askOn: string,
    threadId: string,
    resolved: { rows: FollowUp[]; destination: Destination },
    signal: AbortSignal | undefined,
  ): Promise<
    | { outcome: "ok"; rows: FollowUp[]; destination: Destination }
    | { outcome: "declined" | "gone" | "changed" }
  > {
    let approved: ConfirmFilingPayload | null = null;
    if (!(await settings.get()).agentFileWithoutAsking) {
      const payload: ConfirmFilingPayload = {
        destination: resolved.destination.name,
        kind: resolved.destination.kind,
        rows: resolved.rows.map((row) => ({
          id: row.id,
          text: row.text,
          detail: row.detail ?? null,
          file: row.file ?? null,
        })),
      };
      const count = resolved.rows.length;
      const answer = await bb.ui.requestInput(
        {
          threadId: askOn,
          rendererId: CONFIRM_FILING_RENDERER,
          title: `File ${count} follow-up${count === 1 ? "" : "s"} to ${resolved.destination.name}?`,
          payload,
        },
        signal === undefined ? undefined : { signal },
      );
      const confirmed =
        answer.outcome === "submitted" &&
        typeof answer.value === "object" &&
        answer.value !== null &&
        (answer.value as { file?: unknown }).file === true;
      if (!confirmed) return { outcome: "declined" };
      approved = payload;
    }
    const fresh = await resolveFiling(
      threadId,
      resolved.rows.map((row) => row.id),
      resolved.destination.id,
    );
    if (fresh.outcome !== "ok") return { outcome: "gone" };
    if (approved !== null && !approvalStillHolds(approved, fresh.rows, fresh.destination, resolved.destination)) {
      return { outcome: "changed" };
    }
    return { outcome: "ok", rows: fresh.rows, destination: fresh.destination };
  }

  const CONFIRM_REFUSED = {
    declined: "The user did not confirm filing these. Nothing was filed; they stay on this thread's list.",
    gone: "Nothing to file any more: those follow-ups were filed or closed while waiting.",
    changed:
      "Those follow-ups, or the destination, changed while the user was deciding. " +
      "Nothing was filed; ask again if they still want it.",
  } as const;

  /** The destinations, listed for an agent that named none or the wrong one. */
  async function destinationsForAgent(): Promise<string> {
    const destinations = await readDestinations();
    return destinations.length === 0
      ? "The user has not set up anywhere to file follow-ups yet (Settings → Plugins → Follow Up, or the Follow-ups panel)."
      : `Destinations set up: ${destinations.map((destination) => `"${destination.name}"`).join(", ")}.`;
  }

  bb.agents.registerTool({
    name: "file_follow_ups",
    description:
      "File follow-ups on this thread to a destination the user set up — their tracker " +
      "or backlog — so they are tracked there and leave this thread's list.",
    instructions: FILE_TOOL_INSTRUCTIONS,
    presentation: {
      label: { pending: "Filing follow-ups", completed: "Filed follow-ups" },
      icon: { glyph: "TextWrap" },
    },
    parameters: z.object({
      follow_ups: z
        .array(z.string().trim().min(1).max(TEXT_MAX))
        .min(1)
        .max(CAP_CEILING)
        .optional()
        .describe("Ids, or enough of each one's text to identify it. Leave out with all: true."),
      all: z.boolean().optional().describe("File every open follow-up on this thread."),
      destination: z
        .string()
        .trim()
        .min(1)
        .max(60)
        .optional()
        .describe("A destination's name or id. Leave out for this project's default."),
    }),
    async execute({ follow_ups, all, destination }, { threadId, signal }) {
      if (all !== true && (follow_ups === undefined || follow_ups.length === 0)) {
        return "Name the follow-ups to file, or pass all: true. Nothing was filed.";
      }
      let ids: string[] | null = null;
      if (all !== true) {
        const candidates = await listFollowUps(threadId);
        ids = [];
        for (const wanted of follow_ups ?? []) {
          const match = matchFollowUp(candidates, wanted);
          if (match.kind === "none") {
            return [
              `No open follow-up matches "${wanted}". Nothing was filed.`,
              candidates.length === 0
                ? "This thread has no open follow-ups."
                : `Open follow-ups:\n${formatListForAgent(candidates)}`,
            ].join("\n");
          }
          if (match.kind === "ambiguous") {
            // Never guessed through, as complete_follow_up does not: filing the
            // wrong row opens an issue nobody asked for.
            return [
              `"${wanted}" matches ${match.rows.length} follow-ups. Nothing was filed — call again with one of these ids:`,
              formatListForAgent(match.rows),
            ].join("\n");
          }
          ids.push(match.row.id);
        }
      }

      const resolved = await resolveFiling(threadId, ids, destination ?? null);
      if (resolved.outcome === "nothing-to-file") {
        return "Nothing to file: those follow-ups are already filed, or on their way.";
      }
      if (resolved.outcome === "no-destination") {
        return `This project has no default destination, and you named none. Nothing was filed. ${await destinationsForAgent()}`;
      }
      if (resolved.outcome !== "ok") {
        return `No destination called "${destination}". Nothing was filed. ${await destinationsForAgent()}`;
      }

      const fresh = await confirmedFiling(threadId, threadId, resolved, signal);
      if (fresh.outcome !== "ok") return CONFIRM_REFUSED[fresh.outcome];
      const reports = await fileRows(threadId, fresh.rows, fresh.destination, "agent");
      const lines = reports.map((report) =>
        report.outcome === "filed"
          ? `Filed${report.ref ? ` (${report.ref})` : ""}: ${report.text}`
          : report.outcome === "pending"
            ? `Handed to the ${fresh.destination.name} helper, which reports it when done: ${report.text}`
            : `Not filed: ${report.text} — ${report.note}`,
      );
      return lines.join("\n");
    },
  });

  bb.agents.registerTool({
    name: "offer_next_steps",
    description:
      "Offer what you would do next in this thread as buttons under your reply, " +
      "so the user can say yes with one click. Call it once, as the last thing " +
      "in a turn whose reply ends by offering to do something.",
    instructions: OFFER_TOOL_INSTRUCTIONS,
    presentation: {
      label: { pending: "Offering next steps", completed: "Offered next steps" },
      icon: { glyph: "TextWrap" },
      // The buttons are the record. A row saying the agent offered them, under
      // a reply with the buttons right below it, says the same thing twice on
      // every turn that has an offer.
      suppress: true,
    },
    parameters: z.object({
      steps: z
        .array(
          z
            .string()
            .trim()
            .min(1)
            .max(NEXT_STEP_MAX)
            // A refinement rather than a transform, so the parameters still
            // convert to the JSON Schema a provider is handed. `makeOffer`
            // normalizes whitespace the same way when it stores the step.
            .refine((step) => isShowable(normalizeStep(step)), {
              message:
                "contains characters that do not show on screen (zero-width, " +
                "bidi, tag, variation-selector or control characters); a " +
                "button has to show everything it sends",
            })
            .describe(
              "The button's text, which is also exactly what pressing it sends " +
                "as the user's message: 'Open a PR against main'.",
            ),
        )
        .max(NEXT_STEPS_MAX)
        .describe(
          `Up to ${NEXT_STEPS_MAX}, most likely first. An empty list clears ` +
            "whatever you offered earlier in this turn.",
        ),
      goal_met: z
        .boolean()
        .optional()
        .describe(
          "True when what this thread set out to do is done. It changes what " +
            "the card leads with; closing the thread stays the user's call.",
        ),
    }),
    async execute({ steps, goal_met }, { threadId }) {
      if (!(await settings.get()).offerNextSteps) {
        return (
          "The user has turned next-step buttons off, so nothing was offered. " +
          "Ask in your reply instead."
        );
      }
      const offer = makeOffer(steps, goal_met === true, new Date().toISOString());
      await writeOffer(threadId, offer);
      if (offer === null) return "Cleared. No buttons will show under your reply.";
      bb.log.info(
        `offered ${offer.steps.length} next step(s) on ${threadId}` +
          (offer.goalMet ? " (goal met)" : ""),
      );
      const shown =
        offer.steps.length === 0
          ? "No buttons, but the card will say this thread's goal is met."
          : `${offer.steps.length} button${offer.steps.length === 1 ? "" : "s"} will ` +
            "show under your reply until the next turn starts: " +
            offer.steps.map((step) => `"${step}"`).join(", ") +
            ". Pressing one sends that text as the user's message.";
      return `Offered. ${shown}`;
    },
  });

  // An offer answers the reply it sits under, so it goes the moment the next
  // turn starts — whoever starts it: a pressed button, a typed message, a
  // queued one, or another plugin. Clearing here rather than when a button is
  // pressed is what makes that true of all of them.
  //
  // It does not fire mid-turn. bb emits it only when a run starts, moving a
  // thread from idle, starting or error into active, and a thread waiting
  // on a question or an approval stays active throughout: there is no
  // waiting status, and a second run.started from active is an illegal
  // transition that bb drops. Read from bb 0.45's thread lifecycle table
  // (packages/domain/src/thread-lifecycle.ts), 2026-10-08.
  bb.events.on("thread.active", ({ thread }) => {
    void writeOffer(thread.id, null);
    void holdWrapUpForTurn(thread.id);
  });

  /**
   * A turn started while a wrap-up waited on its filings: someone is working
   * in this thread again, so the archive it was waiting to do is off.
   */
  function holdWrapUpForTurn(threadId: string): Promise<void> {
    return onWrapUpQueue(threadId, async () => {
      const record = await readWrapUp(threadId);
      if (record === null || record.held !== null) return;
      await writeWrapUp(threadId, { ...record, held: "A new turn started, so this thread was not archived." });
    });
  }

  // -------------------------------------------------------------------------
  // The Follow Up page: every thread that needs you, in one list.
  //
  // lib/page.ts holds the rules. This gathers the facts they read — one
  // thread list, the asks of blocked threads only, this plugin's own storage,
  // last replies and pull requests — and carries out what a card asks for.

  /** Last replies, good until the thread's attention mark moves. */
  const replies = new Map<string, { at: number; reply: string | null }>();
  /** Each worktree's pull request, and when it was last looked up. */
  const pullRequests = new Map<string, { checkedAt: number; pr: PrSummary | null }>();
  const prQueue: string[] = [];
  const prQueued = new Set<string>();
  let prActive = 0;
  /**
   * Archived threads that still hold open follow-ups. Looked up once each:
   * an archived thread's title and project do not change while it stays
   * archived, and unarchiving it puts it back in the thread list.
   */
  const archivedThreads = new Map<
    string,
    { title: string; projectId: string; updatedAt: number } | null
  >();
  let pageTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Set when bb reloads or disables this plugin. After that every `bb` handle
   * throws, and a timer, a late change from the feed or a lookup finishing in
   * the background must not reach one: thrown from a timer, it is an uncaught
   * exception in bb's server.
   */
  let disposed = false;

  /**
   * Tell open pages and the sidebar count to refetch. A burst — a turn ending
   * moves a thread's status, attention and read mark at once — is one refetch.
   */
  function pageChanged(): void {
    if (disposed || pageTimer !== null) return;
    pageTimer = setTimeout(() => {
      pageTimer = null;
      if (disposed) return;
      bb.realtime.publish(PAGE_CHANGED, {});
    }, PAGE_SIGNAL_MS);
  }

  /** The visible, unarchived threads, as the page reads them. */
  async function listOpenThreads(): Promise<ThreadFacts[]> {
    // Open threads only: the list otherwise includes every archived thread,
    // which on a host that has been in use a while is most of them.
    const rows: unknown = await bb.sdk.threads.list({ archived: false });
    if (!Array.isArray(rows)) return [];
    return rows
      .map((row) => threadFacts(row as Record<string, unknown>))
      .filter((facts): facts is ThreadFacts => facts !== null && !facts.archived);
  }

  async function readPendingAsks(threadId: string): Promise<PendingAsk[]> {
    let raw: unknown[];
    try {
      const list: unknown = await bb.sdk.threads.interactions.list({ threadId });
      raw = Array.isArray(list) ? list : [];
    } catch (error) {
      bb.log.warn(`page: could not read ${threadId}'s pending asks: ${String(error)}`);
      return [];
    }
    const asks = raw.map((interaction) => pendingAsk(interaction));
    const events = asks.some(namesFileChange) ? await readFileChanges(threadId) : undefined;
    return raw
      .map((interaction) => pendingAsk(interaction, events))
      .filter((ask): ask is PendingAsk => ask !== null);
  }

  /**
   * A file change's approval names only the item; its diff is on the
   * thread's started items. Undefined when they can't be read, which holds
   * the approval for the thread rather than answer it unseen.
   */
  async function readFileChanges(threadId: string): Promise<unknown[] | undefined> {
    try {
      const events: unknown = await bb.sdk.threads.events.list({
        threadId,
        order: "desc",
        limit: FILE_CHANGE_EVENTS,
        types: ["item/started"],
      });
      return Array.isArray(events) ? events : [];
    } catch (error) {
      bb.log.warn(`page: could not read ${threadId}'s file changes: ${String(error)}`);
      return undefined;
    }
  }

  async function readLastReply(thread: ThreadFacts): Promise<string | null> {
    const cached = replies.get(thread.id);
    if (cached !== undefined && cached.at === thread.latestAttentionAt) return cached.reply;
    try {
      const { output } = await bb.sdk.threads.output({ threadId: thread.id });
      replies.set(thread.id, { at: thread.latestAttentionAt, reply: output });
      return output;
    } catch (error) {
      bb.log.warn(`page: could not read ${thread.id}'s last reply: ${String(error)}`);
      return null;
    }
  }

  /**
   * Look a worktree's pull request up in the background, unless it was looked
   * up recently. A page never waits on GitHub: it shows what is cached, and a
   * lookup that changes anything signals the page to refetch.
   */
  function queuePullRequest(environmentId: string, force = false): void {
    const cached = pullRequests.get(environmentId);
    if (!force && cached !== undefined && Date.now() - cached.checkedAt < PR_TTL_MS) return;
    if (prQueued.has(environmentId)) return;
    prQueued.add(environmentId);
    prQueue.push(environmentId);
    pumpPullRequests();
  }

  function pumpPullRequests(): void {
    while (!disposed && prActive < PR_CONCURRENCY && prQueue.length > 0) {
      const environmentId = prQueue.shift() as string;
      prActive += 1;
      void (async () => {
        const before = pullRequests.get(environmentId);
        try {
          const pr = prSummary(await bb.sdk.environments.pullRequest({ environmentId }));
          pullRequests.set(environmentId, { checkedAt: Date.now(), pr });
          if (JSON.stringify(before?.pr ?? null) !== JSON.stringify(pr)) pageChanged();
        } catch (error) {
          // Keep what was known, and wait the full interval before asking again:
          // a git host having a bad minute is not worth a lookup per refetch.
          pullRequests.set(environmentId, { checkedAt: Date.now(), pr: before?.pr ?? null });
          // A lookup that outlived a reload fails on the stale handle; the
          // log is behind the same handle, so it says nothing.
          if (!disposed) bb.log.warn(`page: pull request lookup failed for ${environmentId}: ${String(error)}`);
        } finally {
          prQueued.delete(environmentId);
          prActive -= 1;
          pumpPullRequests();
        }
      })();
    }
  }

  async function readArchivedThread(
    threadId: string,
  ): Promise<{ title: string; projectId: string; updatedAt: number } | null> {
    if (archivedThreads.has(threadId)) return archivedThreads.get(threadId) ?? null;
    let info: { title: string; projectId: string; updatedAt: number } | null = null;
    try {
      const facts = threadFacts((await bb.sdk.threads.get({ threadId })) as unknown as Record<string, unknown>);
      // Only archived threads: a hidden helper that recorded a row is not
      // somewhere a person goes to read it.
      if (facts !== null && facts.archived) {
        info = { title: facts.title, projectId: facts.projectId, updatedAt: facts.updatedAt };
      }
    } catch {
      // Deleted: its rows have nowhere to send anything.
    }
    archivedThreads.set(threadId, info);
    return info;
  }

  async function runningRow(
    thread: ThreadFacts,
    rows: readonly FollowUp[],
    done: number,
  ): Promise<RunningWorker> {
    let startedAt: number | null = null;
    let now = thread.status === "pending" ? "Waiting to start" : "Working";
    if (thread.status !== "pending") {
      try {
        const events: unknown = await bb.sdk.threads.events.list({
          threadId: thread.id,
          order: "desc",
          limit: ACTIVITY_EVENTS,
          types: ["turn/started", "item/started"],
        });
        const list = Array.isArray(events) ? (events as Array<Record<string, unknown>>) : [];
        const turn = list.find((event) => event.type === "turn/started");
        startedAt = typeof turn?.createdAt === "number" ? turn.createdAt : null;
        // The newest item since the turn started that says something: a run
        // of reasoning between two commands is still the command's turn.
        const items = list.filter(
          (event) =>
            event.type === "item/started" &&
            (startedAt === null || (typeof event.createdAt === "number" && event.createdAt >= startedAt)),
        );
        const telling = items.find((event) => {
          const item = (event.data as { item?: { type?: unknown } } | undefined)?.item;
          return item?.type !== "reasoning";
        });
        const chosen = telling ?? items[0];
        if (chosen !== undefined) now = activityLabel((chosen.data as { item?: unknown } | undefined)?.item);
      } catch (error) {
        bb.log.warn(`page: could not read ${thread.id}'s activity: ${String(error)}`);
      }
    }
    return {
      threadId: thread.id,
      title: thread.title,
      projectId: thread.projectId,
      status: thread.status,
      startedAt,
      now,
      openFollowUps: rows.length,
      doneFollowUps: done,
    };
  }

  /**
   * Build the page. `withLanes` adds the threads in motion and the follow-ups
   * lane, which the sidebar count and the new-thread strip do not need.
   */
  async function buildPage(withLanes: boolean) {
    const now = Date.now();
    const [threads, current, offerKeys, wrapKeys, hiddenKeys, reviewKeys, itemKeys] =
      await Promise.all([
        listOpenThreads(),
        settings.get(),
        bb.storage.kv.list(NEXT_PREFIX),
        bb.storage.kv.list(WRAP_UP_PREFIX),
        bb.storage.kv.list(HIDDEN_PREFIX),
        bb.storage.kv.list(REVIEW_PREFIX),
        bb.storage.kv.list(ITEMS_PREFIX),
      ]);
    const idsOf = (keys: readonly string[], prefix: string) =>
      new Set(keys.map((key) => key.slice(prefix.length)));
    const withOffer = idsOf(offerKeys, NEXT_PREFIX);
    const withWrapUp = idsOf(wrapKeys, WRAP_UP_PREFIX);
    const withHidden = idsOf(hiddenKeys, HIDDEN_PREFIX);
    const withReview = idsOf(reviewKeys, REVIEW_PREFIX);
    const withItems = idsOf(itemKeys, ITEMS_PREFIX);
    const byId = new Map(threads.map((thread) => [thread.id, thread]));

    // Each thread's open rows, read once however many things need them.
    const open = new Map<string, Promise<{ rows: FollowUp[]; done: number }>>();
    const rowsOf = (threadId: string) => {
      let entry = open.get(threadId);
      if (entry === undefined) {
        entry = withItems.has(threadId)
          ? Promise.all([readItems(threadId), readTombstones(threadId)]).then(([items, tombs]) => ({
              rows: openFollowUps(items, tombs),
              done: doneFollowUps(items, tombs).length,
            }))
          : Promise.resolve({ rows: [], done: 0 });
        open.set(threadId, entry);
      }
      return entry;
    };

    const owners = prOwners(threads);
    const environmentOf = new Map([...owners].map(([environmentId, threadId]) => [threadId, environmentId]));
    for (const [environmentId, threadId] of owners) {
      // An idle thread's pull request only: a working agent is still pushing.
      if (!isBusy(byId.get(threadId)?.status ?? "idle")) queuePullRequest(environmentId);
    }

    const cards = (
      await Promise.all(
        threads.map(async (thread) => {
          const asks = asksFor(thread, thread.hasPendingInteraction ? await readPendingAsks(thread.id) : []);
          const busy = isBusy(thread.status);
          if (asks.length === 0 && busy) return null;
          const [offer, wrapRecord, hiddenAt, review] = await Promise.all([
            current.offerNextSteps && withOffer.has(thread.id) ? readOffer(thread.id) : null,
            withWrapUp.has(thread.id) ? readWrapUp(thread.id) : null,
            withHidden.has(thread.id) ? bb.storage.kv.get<unknown>(hiddenKey(thread.id)) : undefined,
            withReview.has(thread.id)
              ? bb.storage.kv.get<{ prNumber: number; threadId: string }>(reviewKey(thread.id))
              : undefined,
          ]);
          const environmentId = environmentOf.get(thread.id);
          const pr = environmentId === undefined || busy ? null : (pullRequests.get(environmentId)?.pr ?? null);
          // A reply is read only where a card could use it: an unread turn, an
          // offer, a failure or a pull request. A read thread that asked for
          // nothing has nothing to quote.
          const wantsReply =
            !busy &&
            (isUnread(thread) ||
              offer !== null ||
              thread.status === "error" ||
              (pr !== null && prAction(pr) !== null));
          const reply = wantsReply ? await readLastReply(thread) : null;
          const inputs = {
            thread,
            asks,
            offer,
            wrapUp: wrapRecord === null ? null : { held: wrapRecord.held, running: wrapRecord.held === null },
            pr,
            reply,
            hidden: parsePutAway(hiddenAt),
            parentTitle:
              thread.parentThreadId === null ? null : (byId.get(thread.parentThreadId)?.title ?? null),
            review: review ?? null,
          };
          // A thread's rows are read only where they can matter: on a card it
          // gets anyway, where they are listed for its close-out, or when its
          // goal is met, where open rows make it a wrap-up. Most open threads
          // are neither, and the sidebar count asks on every change; reading
          // every one's rows was two kv reads per open thread per refresh.
          const card = cardFor({ ...inputs, openFollowUps: 0, rows: [] });
          if (!withItems.has(thread.id) || (card === null && offer?.goalMet !== true)) return card;
          const { rows } = await rowsOf(thread.id);
          return cardFor({ ...inputs, openFollowUps: rows.length, rows });
        }),
      )
    ).filter((card) => card !== null);

    // One card per family: workers fold into their parent's (lib/page.ts).
    // Cards put away with "Not now" are kept apart: not counted, and listed
    // in the page's Put away fold, families combined the same way.
    const ranked = rank(combineFamilies(cards.filter((card) => !card.putAway), threads));
    const putAway = rank(combineFamilies(cards.filter((card) => card.putAway), threads));
    const count = countOf(ranked);
    if (!withLanes) {
      return { count, ranked, putAway, running: [], followUps: [], projectNames: new Map<string, string>() };
    }

    const running = foldRunning(
      await Promise.all(
        threads
          .filter((thread) => inMotion(thread, now))
          .map(async (thread) => {
            const { rows, done } = await rowsOf(thread.id);
            return runningRow(thread, rows, done);
          }),
      ),
      threads,
    );

    let projectNames = new Map<string, string>();
    try {
      const projects: unknown = await bb.sdk.projects.list();
      if (Array.isArray(projects)) {
        projectNames = new Map(
          projects.flatMap((project: { id?: unknown; name?: unknown }) =>
            typeof project.id === "string" && typeof project.name === "string"
              ? [[project.id, project.name] as const]
              : [],
          ),
        );
      }
    } catch (error) {
      bb.log.warn(`page: could not list projects: ${String(error)}`);
    }

    // In parallel: rows outlive archiving, so this is every thread that ever
    // recorded one, and reading them in turn made each refetch wait on all.
    const laneInputs = (
      await Promise.all(
        [...withItems].map(async (threadId): Promise<LaneInput | null> => {
          const { rows } = await rowsOf(threadId);
          if (rows.length === 0) return null;
          const live = byId.get(threadId);
          const info = live ?? (await readArchivedThread(threadId));
          if (info === null) return null;
          return {
            threadId,
            title: info.title,
            projectId: info.projectId,
            archived: live === undefined,
            updatedAt: info.updatedAt,
            rows,
          };
        }),
      )
    ).filter((input): input is LaneInput => input !== null);

    return {
      count,
      ranked,
      putAway,
      running,
      followUps: groupFollowUps(laneInputs, projectNames),
      projectNames,
    };
  }

  /** Merge a thread's worktree pull request, once it is still ready to merge. */
  async function mergeFromPage(
    threadId: string,
    asked: MergeMethod | undefined,
    tell: string | undefined,
  ): Promise<{
    outcome: "merged" | "needs-method" | "not-ready" | "failed";
    method: MergeMethod | null;
    message: string | null;
    told: "sent" | "queued" | "failed" | null;
  }> {
    const thread = await bb.sdk.threads.get({ threadId });
    if (thread.environmentId === null) {
      return { outcome: "not-ready", method: null, message: "This thread has no worktree to merge from.", told: null };
    }
    const remembered = await bb.storage.kv.get<MergeMethod>(mergeMethodKey(thread.projectId));
    const method = asked ?? remembered ?? null;
    if (method === null) return { outcome: "needs-method", method: null, message: null, told: null };
    // Looked up again rather than trusting the card: checks can fail, or a
    // conflict land, between the card drawing and the press.
    const pr = prSummary(await bb.sdk.environments.pullRequest({ environmentId: thread.environmentId }));
    if (pr === null || prAction(pr) !== "merge") {
      return {
        outcome: "not-ready",
        method,
        message: pr === null ? "There is no pull request on this thread's branch." : "This pull request is no longer ready to merge.",
        told: null,
      };
    }
    try {
      await bb.sdk.environments.mergePullRequest({ environmentId: thread.environmentId, method });
    } catch (error) {
      bb.log.error(`page: merge failed on ${threadId}: ${String(error)}`);
      return { outcome: "failed", method, message: String(error instanceof Error ? error.message : error), told: null };
    }
    if (asked !== undefined && asked !== remembered) {
      await bb.storage.kv.set(mergeMethodKey(thread.projectId), asked);
    }
    queuePullRequest(thread.environmentId, true);
    bb.log.info(`page: merged #${pr.number} on ${threadId} (${method})`);
    let told: "sent" | "queued" | "failed" | null = null;
    if (tell !== undefined) {
      try {
        told = await sendAsUser(threadId, [{ text: tell }]);
      } catch (error) {
        bb.log.error(`page: merged #${pr.number} but could not tell ${threadId}: ${String(error)}`);
        told = "failed";
      }
    }
    return { outcome: "merged", method, message: null, told };
  }

  // Host changes that can move a card. The subscription is the server's own,
  // so one signal reaches every open page however many there are.
  let unsubscribe: (() => void) | null = null;
  try {
    unsubscribe = bb.sdk.subscribe({
      event: "thread:changed",
      callback: (event) => {
        if (event.changes.some((change) => PAGE_RELEVANT_CHANGES.has(change))) pageChanged();
      },
    });
  } catch (error) {
    // An older host, or a test host with no realtime: the page still works,
    // it just refreshes when this plugin's own events fire.
    bb.log.warn(`page: no thread change feed, so pages refresh on Follow Up's own events: ${String(error)}`);
  }
  // The subscription is the host's, not this instance's: left alone it keeps
  // delivering to a reloaded plugin, whose timer then publishes on a stale
  // handle. Let go of it, and of the pending signal and lookups, on dispose.
  bb.onDispose(() => {
    disposed = true;
    if (pageTimer !== null) clearTimeout(pageTimer);
    pageTimer = null;
    prQueue.length = 0;
    prQueued.clear();
    try {
      unsubscribe?.();
    } catch {
      // Already gone with the host.
    }
  });
  bb.events.on("interaction.pending", () => pageChanged());
  bb.events.on("thread.archived", () => pageChanged());
  bb.events.on("thread.unarchived", ({ thread }) => {
    archivedThreads.delete(thread.id);
    pageChanged();
  });
  bb.events.on("thread.idle", ({ thread }) => {
    // A turn just ended: whatever it pushed is worth a fresh look.
    const environmentId = (thread as { environmentId?: unknown }).environmentId;
    if (typeof environmentId === "string" && pullRequests.has(environmentId)) {
      queuePullRequest(environmentId, true);
    }
    pageChanged();
  });
  bb.events.on("thread.failed", () => pageChanged());

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
        // A busy thread queues rather than refusing, and that is still a send
        // as far as the caller is concerned — but the card should say which,
        // because a queued turn has not started thinking yet.
        const outcome = await sendAsUser(threadId, [
          { text: SUGGEST_ASK },
          // Reaches the model, never renders in the transcript. See the note
          // on SUGGEST_ASK for why the ask and the method are separate inputs
          // and for the check that this visibility actually holds.
          {
            text: suggestMethod((await settings.get()).suggestHouseStyle),
            agentOnly: true,
          },
        ]);
        bb.log.info(`asked ${threadId} what to pick up next (${outcome})`);
        return { outcome };
      } catch (error) {
        bb.log.error(`suggest-next failed on ${threadId}: ${String(error)}`);
        return { outcome: "failed" as const };
      }
    },
    followups_next_get: async ({ threadId }) => {
      // Off means no buttons, including for an offer stored before the switch
      // was flipped: the setting says what the card shows, not only what agents
      // are allowed to write.
      if (!(await settings.get()).offerNextSteps) return { offer: null };
      return { offer: await readOffer(threadId) };
    },
    followups_next_take: async ({ threadId, offeredAt, index }) => {
      const offer = await readOffer(threadId);
      const step = stepAt(offer, offeredAt, index);
      if (step === null) return { outcome: "stale" as const };
      // Cleared before sending, not after: a double press must not send twice,
      // and the turn the send starts would clear it anyway.
      await writeOffer(threadId, null);
      try {
        // The step itself and nothing else: the button showed exactly this.
        const outcome = await sendAsUser(threadId, [{ text: step }]);
        bb.log.info(`took next step on ${threadId} (${outcome}): ${step}`);
        return { outcome };
      } catch (error) {
        // Put it back, so the button is there to press again.
        await writeOffer(threadId, offer);
        bb.log.error(`next step failed on ${threadId}: ${String(error)}`);
        return { outcome: "failed" as const };
      }
    },
    followups_next_keep: async ({ threadId, offeredAt, index }) => {
      const offer = await readOffer(threadId);
      const step = stepAt(offer, offeredAt, index);
      if (offer === null || step === null) {
        return { outcome: "stale" as const, offer, ...(await bothLists(threadId)) };
      }
      // Recorded as the user's, because keeping it was: the agent offered to do
      // it now, and the person deferred it. That is also what lets the agent
      // be asked for the file and detail when the row is picked up later.
      const { outcome } = await addUserFollowUp(threadId, {
        text: step,
        reason: "deferred",
      });
      // Out of the offer whatever the outcome. A duplicate is already on the
      // list and a dismissed one was deliberately removed from it; either way
      // the button has been answered.
      const next = withoutStep(offer, index);
      await writeOffer(threadId, next);
      return { outcome, offer: next, ...(await bothLists(threadId)) };
    },
    followups_next_clear: async ({ threadId }) => {
      await writeOffer(threadId, null);
      return { ok: true as const };
    },
    followups_destinations: async ({ projectId, threadId }) => ({
      destinations: await readDestinations(),
      defaultId:
        (await readDefaultDestination(projectId ?? (threadId === undefined ? null : await projectOf(threadId))))
          ?.id ?? null,
    }),
    followups_set_destinations: async ({ destinations }) => {
      // Names are what people type after `--to` and pick from a menu, so two
      // destinations may not share one; ids follow the names, made unique.
      const names = new Set<string>();
      for (const destination of destinations) {
        const key = destination.name.trim().toLowerCase();
        if (names.has(key)) {
          return { outcome: "duplicate-name" as const, destinations: await readDestinations() };
        }
        names.add(key);
      }
      const ids = new Set<string>();
      const saved = destinations.map((destination) => {
        let id = destination.id;
        for (let n = 2; ids.has(id); n += 1) id = `${destination.id}-${n}`;
        ids.add(id);
        return { ...destination, id };
      });
      await bb.storage.kv.set(DESTINATIONS_KEY, saved);
      bb.log.info(`saved ${saved.length} destination(s)`);
      bb.realtime.publish(DESTINATIONS_CHANGED, {});
      return { outcome: "saved" as const, destinations: parseDestinations(saved) };
    },
    followups_file: async ({ threadId, ids, destinationId }) => {
      const resolved = await resolveFiling(threadId, ids, destinationId);
      if (resolved.outcome !== "ok") {
        return { outcome: resolved.outcome, destinationId: null, count: 0 };
      }
      const { rows, destination, projectId } = resolved;
      // The first destination someone picks in a project becomes its default:
      // that is what File all then reaches for.
      if (destinationId !== null && projectId !== null) {
        const existing = await bb.storage.kv.get<string>(defaultDestinationKey(projectId));
        if (typeof existing !== "string") {
          await bb.storage.kv.set(defaultDestinationKey(projectId), destination.id);
          bb.realtime.publish(DESTINATIONS_CHANGED, {});
        }
      }
      // Marked before answering, so the rows already say "filing…" when the
      // card refetches on this answer.
      await setFiling(threadId, rows.map((row) => row.id), { by: "user", to: destination.name });
      void fileRows(threadId, rows, destination, "user", true);
      return { outcome: "started" as const, destinationId: destination.id, count: rows.length };
    },
    followups_wrap_up_get: async ({ threadId }) => {
      // Asked here too, so a filing that went quiet settles when anyone looks.
      await settleWrapUp(threadId);
      const record = await readWrapUp(threadId);
      let newWorktree = false;
      let children = { open: 0, running: 0 };
      try {
        newWorktree = (await worktreeFor(await bb.sdk.threads.get({ threadId }))) !== null;
      } catch {
        // Not offered, rather than offered and failing.
      }
      try {
        // An archive takes this thread's children with it, so the popup says
        // so before anyone asks for one.
        const listed = await bb.sdk.threads.list({ parentThreadId: threadId, archived: false });
        children = {
          open: listed.length,
          running: listed.filter((child) => BUSY_STATUSES.has(child.status)).length,
        };
      } catch {
        // Unknown is shown as none: the archive's own confirmation is bb's.
      }
      return { state: await wrapUpView(threadId, record), newWorktree, children };
    },
    followups_wrap_up_state: async ({ threadId }) => {
      await settleWrapUp(threadId);
      return { state: await wrapUpView(threadId, await readWrapUp(threadId)) };
    },
    followups_wrap_up: async ({ threadId, plan, archive }) => await startWrapUp(threadId, plan, archive),
    followups_wrap_up_forget: async ({ threadId }) =>
      await onWrapUpQueue(threadId, async () => {
        const record = await readWrapUp(threadId);
        // Only a held one: one still waiting is not the card's to drop.
        if (record === null || record.held === null) return { forgotten: false };
        await writeWrapUp(threadId, null);
        return { forgotten: true };
      }),
    followups_set_default_destination: async ({ projectId, id }) => {
      if (id === null) {
        await bb.storage.kv.delete(defaultDestinationKey(projectId));
        bb.realtime.publish(DESTINATIONS_CHANGED, {});
        return { defaultId: null };
      }
      const known = (await readDestinations()).some((destination) => destination.id === id);
      if (!known) return { defaultId: (await readDefaultDestination(projectId))?.id ?? null };
      await bb.storage.kv.set(defaultDestinationKey(projectId), id);
      bb.realtime.publish(DESTINATIONS_CHANGED, {});
      return { defaultId: id };
    },
    followups_next_do: async ({ threadId, id }) => {
      const current = await settings.get();
      const row = (await listFollowUps(threadId)).find((entry) => entry.id === id);
      if (row === undefined) return { outcome: "gone" as const };
      try {
        // The visible line reads as something typed; the record goes with it
        // agent-only, as the mention pill's context does.
        const outcome = await sendAsUser(threadId, [
          { text: doAsk(row) },
          { text: rowContext(row, current.backfillAsk), agentOnly: true },
        ]);
        // After the send, unlike a mention, which is claimed as it resolves:
        // a send that failed has handed nothing to anyone.
        if (current.markInProgressOnSend) await markInProgress(threadId, id);
        bb.log.info(`handed the top follow-up to ${threadId} (${outcome}): ${row.text}`);
        return { outcome };
      } catch (error) {
        bb.log.error(`do follow-up failed on ${threadId}: ${String(error)}`);
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
    page_snapshot: async () => {
      const page = await buildPage(true);
      const { cards, moreFinished } = capFinished(page.ranked);
      return {
        cards,
        putAway: page.putAway,
        moreFinished,
        count: page.count,
        running: page.running,
        followUps: page.followUps,
        projects: [...page.projectNames].map(([id, name]) => ({ id, name })),
      };
    },
    page_summary: async () => {
      const page = await buildPage(false);
      // The strip shows what needs you, as the count does: never a finished card.
      return { count: page.count, top: page.ranked.filter((card) => card.tier !== "finished").slice(0, STRIP_MAX) };
    },
    page_answer: async ({ threadId, interactionId, answers }) => {
      try {
        const interaction: unknown = await bb.sdk.threads.interactions.get({ threadId, interactionId });
        const ask = pendingAsk(interaction);
        if (ask === null || ask.kind !== "question") return { outcome: "stale" as const };
        await bb.sdk.threads.interactions.resolve({
          threadId,
          interactionId,
          resolution: { kind: "user_answer", answers },
        });
        bb.log.info(`page: answered ${interactionId} on ${threadId}`);
        pageChanged();
        return { outcome: "answered" as const };
      } catch (error) {
        bb.log.error(`page: answer failed on ${threadId}: ${String(error)}`);
        return { outcome: "failed" as const };
      }
    },
    page_approve: async ({ threadId, interactionId, decision, note }) => {
      let interaction: unknown;
      try {
        interaction = await bb.sdk.threads.interactions.get({ threadId, interactionId });
      } catch (error) {
        bb.log.error(`page: could not read ${interactionId} on ${threadId}: ${String(error)}`);
        return { outcome: "failed" as const, noted: null };
      }
      // The same ask the card was built from, file change diff and all, so a
      // choice the card couldn't offer is refused here too.
      const first = pendingAsk(interaction);
      const ask = namesFileChange(first) ? pendingAsk(interaction, await readFileChanges(threadId)) : first;
      if (ask === null || ask.kind !== "approval" || ask.interactionId !== interactionId) {
        return { outcome: "stale" as const, noted: null };
      }
      if (!ask.decisions.includes(decision)) return { outcome: "refused" as const, noted: null };
      try {
        await bb.sdk.threads.interactions.resolve({
          threadId,
          interactionId,
          resolution: approvalResolution(interaction, decision) as never,
        });
      } catch (error) {
        bb.log.error(`page: approval ${interactionId} failed on ${threadId}: ${String(error)}`);
        return { outcome: "failed" as const, noted: null };
      }
      bb.log.info(`page: ${decision} on ${interactionId} (${ask.subject}) on ${threadId}`);
      pageChanged();
      // Only Keep planning takes a note: the plan's agent revises with it.
      if (note === undefined || ask.subject !== "plan" || decision !== "deny") {
        return { outcome: "answered" as const, noted: null };
      }
      try {
        return { outcome: "answered" as const, noted: await sendAsUser(threadId, [{ text: note }], "auto") };
      } catch (error) {
        bb.log.error(`page: kept planning on ${threadId} but the note did not go: ${String(error)}`);
        return { outcome: "answered" as const, noted: "failed" as const };
      }
    },
    page_reply: async ({ threadId, text }) => {
      try {
        const outcome = await sendAsUser(threadId, [{ text }]);
        bb.log.info(`page: sent a reply to ${threadId} (${outcome})`);
        return { outcome };
      } catch (error) {
        bb.log.error(`page: reply failed on ${threadId}: ${String(error)}`);
        return { outcome: "failed" as const };
      }
    },
    page_mark_read: async ({ threadId }) => {
      try {
        await bb.sdk.threads.markRead({ threadId });
        pageChanged();
        return { outcome: "done" as const };
      } catch (error) {
        bb.log.error(`page: mark read failed on ${threadId}: ${String(error)}`);
        return { outcome: "failed" as const };
      }
    },
    page_archive: async ({ threadId }) => {
      try {
        await bb.sdk.threads.archive({ threadId });
        pageChanged();
        return { outcome: "done" as const };
      } catch (error) {
        bb.log.error(`page: archive failed on ${threadId}: ${String(error)}`);
        return { outcome: "failed" as const };
      }
    },
    page_hide: async ({ threadId, at, pr }) => {
      await bb.storage.kv.set(hiddenKey(threadId), pr === undefined ? { at } : { at, pr });
      pageChanged();
      return { outcome: "done" as const };
    },
    page_unhide: async ({ threadIds }) => {
      await Promise.all([...new Set(threadIds)].map((threadId) => bb.storage.kv.delete(hiddenKey(threadId))));
      pageChanged();
      return { outcome: "done" as const };
    },
    page_retry: async ({ threadId }) => {
      try {
        await bb.sdk.threads.retry({ threadId });
        pageChanged();
        return { outcome: "retrying" as const };
      } catch (error) {
        bb.log.error(`page: retry failed on ${threadId}: ${String(error)}`);
        return { outcome: "failed" as const };
      }
    },
    page_stop: async ({ threadId }) => {
      try {
        await bb.sdk.threads.stop({ threadId });
        pageChanged();
        return { outcome: "stopped" as const };
      } catch (error) {
        bb.log.error(`page: stop failed on ${threadId}: ${String(error)}`);
        return { outcome: "failed" as const };
      }
    },
    page_pr_merge: async ({ threadId, method, tell }) => {
      try {
        return await mergeFromPage(threadId, method, tell);
      } catch (error) {
        bb.log.error(`page: merge failed on ${threadId}: ${String(error)}`);
        return { outcome: "failed" as const, method: method ?? null, message: null, told: null };
      }
    },
    page_pr_review: async ({ threadId, prompt }) => {
      try {
        const thread = await bb.sdk.threads.get({ threadId });
        if (thread.environmentId === null) return { outcome: "failed" as const, spawnedThreadId: null };
        const pr = prSummary(await bb.sdk.environments.pullRequest({ environmentId: thread.environmentId }));
        const spawned = await spawnThread(
          {
            projectId: thread.projectId,
            environment: { type: "reuse", environmentId: thread.environmentId },
            prompt,
          },
          threadId,
        );
        if (pr !== null) {
          await bb.storage.kv.set(reviewKey(threadId), { prNumber: pr.number, threadId: spawned.id });
        }
        bb.log.info(`page: started review thread ${spawned.id} for ${threadId}`);
        pageChanged();
        return { outcome: "spawned" as const, spawnedThreadId: spawned.id };
      } catch (error) {
        bb.log.error(`page: review thread failed for ${threadId}: ${String(error)}`);
        return { outcome: "failed" as const, spawnedThreadId: null };
      }
    },
    page_archive_workers: async ({ parentThreadId, threadIds }) => {
      const threads = await listOpenThreads();
      const owners = prOwners(threads);
      const environmentOf = new Map([...owners].map(([environmentId, threadId]) => [threadId, environmentId]));
      let archived = 0;
      let skipped = 0;
      for (const threadId of new Set(threadIds)) {
        const environmentId = environmentOf.get(threadId);
        const pr = environmentId === undefined ? null : (pullRequests.get(environmentId)?.pr ?? null);
        const merged = pr !== null && prAction(pr) === "merged";
        if (familyOf(threadId, threads) !== parentThreadId || !merged) {
          skipped += 1;
          continue;
        }
        try {
          await bb.sdk.threads.archive({ threadId });
          archived += 1;
        } catch (error) {
          bb.log.error(`page: archive failed on ${threadId}: ${String(error)}`);
          skipped += 1;
        }
      }
      bb.log.info(`page: archived ${archived} merged workers of ${parentThreadId} (${skipped} skipped)`);
      pageChanged();
      return { archived, skipped };
    },
    page_handoff: async ({ threadId, id }) => {
      const result = await handoffFollowUp(threadId, id, "thread", { kind: "prompt", skill: null });
      return { outcome: result.outcome, spawnedThreadId: result.spawnedThreadId };
    },
  });

  // Standing rules in every thread's instructions. Synchronous and
  // allocation-free on the hot path: this runs at thread.start and turn.submit,
  // so the four possible answers are built once, whenever a switch moves.
  const standingRules = (values: { captureRule: boolean; offerNextSteps: boolean }) => {
    const rules = [
      values.captureRule ? CAPTURE_RULE : null,
      values.offerNextSteps ? NEXT_RULE : null,
    ].filter((rule): rule is string => rule !== null);
    return rules.length === 0 ? null : rules.join("\n\n");
  };
  let instructions = standingRules(await settings.get());
  settings.onChange((next) => {
    instructions = standingRules(next);
  });
  bb.agents.contributeInstructions(() => instructions);

  // `bb follow-up`, declared rather than parsed by hand: defineCli renders
  // `--help` from these declarations, rejects an option a command does not
  // declare (a misspelt flag used to become part of a follow-up's text), and
  // prints the `{ ok: false, error }` envelope on stdout for any failure when
  // `--json` is passed. Agents and the describe helper drive this command, so
  // what it prints is pinned in tests/server.test.ts.
  const threadOption = {
    type: "string",
    placeholder: "id",
    description: "The thread to act on; defaults to the thread this runs in",
  } as const;
  const jsonResult = {
    type: "boolean",
    description: "Print the result as JSON",
  } as const;
  const jsonFailure = {
    type: "boolean",
    description: "Print a failure as a JSON error on stdout",
  } as const;
  const idArgument = {
    name: "id",
    required: true,
    description: "The follow-up's id, as `bb follow-up show -v` prints it",
  } as const;

  const threadFor = (thread: string | undefined, ctx: PluginCliContext): string => {
    const threadId = thread ?? ctx.threadId;
    if (threadId === undefined) {
      throw new PluginCliError("No thread in context — pass --thread <id>.");
    }
    return threadId;
  };

  const show = cliCommand({
    summary: "Show open follow-ups (-v for detail, --include-done to list finished ones too)",
    options: {
      thread: threadOption,
      json: jsonResult,
      all: {
        type: "boolean",
        description: "List every thread that has open follow-ups, with a count for each",
      },
      verbose: { type: "boolean", short: "v", description: "Add each follow-up's id and detail" },
      // `--sent` named this flag back when a sent row vanished from the open
      // list, and it is in older notes. What it adds now is done rows: `show`
      // already lists in-progress ones, sorted last.
      "include-done": {
        type: "boolean",
        aliases: ["sent"],
        description: "Also list finished follow-ups",
      },
      done: { type: "boolean", hidden: true, description: "List only finished follow-ups" },
    },
    async run({ options }, ctx) {
      if (options.all) {
        // The milestone-1 question in one command: did agents call the tool?
        const keys = await bb.storage.kv.list(ITEMS_PREFIX);
        const rows: { threadId: string; count: number }[] = [];
        for (const key of keys) {
          const id = key.slice(ITEMS_PREFIX.length);
          rows.push({ threadId: id, count: (await listFollowUps(id)).length });
        }
        const live = rows.filter((row) => row.count > 0);
        if (options.json) return { exitCode: 0, stdout: `${JSON.stringify(live)}\n` };
        if (live.length === 0) {
          return { exitCode: 0, stdout: "No thread has recorded a follow-up yet.\n" };
        }
        const text = live.map((row) => `${row.threadId}  ${row.count}`).join("\n");
        return { exitCode: 0, stdout: `${text}\n` };
      }
      const threadId = threadFor(options.thread, ctx);
      const list = options.done
        ? await listDone(threadId)
        : options["include-done"]
          ? await listIncludingInProgress(threadId)
          : await listFollowUps(threadId);
      if (options.json) return { exitCode: 0, stdout: `${JSON.stringify(list)}\n` };
      return { exitCode: 0, stdout: `${formatList(list, options.verbose)}\n` };
    },
  });

  // Done and reopen are one operation run in two directions.
  /**
   * The destination a name stands for: a configured one by id or name, or
   * else the name as given — someone recording a row they filed by hand, in a
   * place nobody set up as a destination, is still telling the truth.
   */
  async function destinationFor(name: string): Promise<FiledTo> {
    const configured = findDestination(await readDestinations(), name);
    if (configured !== null) return filedToOf(configured);
    const trimmed = name.trim();
    return { id: slugFor(trimmed), name: trimmed };
  }

  const setDoneCommand = (done: boolean) =>
    cliCommand({
      summary: done
        ? "Mark a follow-up finished; it moves to Done"
        : "Move a finished follow-up back to the open list",
      positionals: [idArgument],
      options: { thread: threadOption, json: jsonFailure },
      async run({ options, positionals }, ctx) {
        const threadId = threadFor(options.thread, ctx);
        const target = await setDone(threadId, positionals.id, done);
        if (target === null) {
          throw new PluginCliError(`No follow-up with id ${positionals.id} on ${threadId}.`);
        }
        return {
          exitCode: 0,
          stdout: `${done ? "Done" : "Reopened"}: ${target.text}\n`,
        };
      },
    });

  bb.cli.register(
    defineCli({
      name: "follow-up",
      summary: "Read and reset the follow-ups agents recorded on a thread",
      root: show,
      commands: {
        add: cliCommand({
          summary: "Record a follow-up yourself, the same row the composer records",
          positionals: [
            {
              name: "text",
              required: true,
              variadic: true,
              description:
                `The follow-up, as a title. Past ${TITLE_MAX} characters its start ` +
                "becomes the title and all of it goes in the detail",
            },
          ],
          options: {
            thread: threadOption,
            json: jsonResult,
            reason: {
              type: "enum",
              values: REASONS,
              description: "Why it is not being done now",
            },
            detail: {
              type: "string",
              description: `What a reader would need to act on it, at most ${DETAIL_MAX} characters`,
            },
            file: { type: "string", placeholder: "path", description: "The file it is about" },
          },
          async run({ options, positionals }, ctx) {
            const threadId = threadFor(options.thread, ctx);
            const text = positionals.text.join(" ").trim();
            if (text === "") throw new PluginCliError("add needs the follow-up text.");
            if (options.detail !== undefined && options.detail.length > DETAIL_MAX) {
              throw new PluginCliError(`The detail must be ${DETAIL_MAX} characters or fewer.`);
            }
            const added = await addUserFollowUp(threadId, {
              text,
              ...(options.reason === undefined ? {} : { reason: options.reason }),
              ...(options.detail === undefined ? {} : { detail: options.detail }),
              ...(options.file === undefined ? {} : { file: options.file }),
            });
            if (options.json) return { exitCode: 0, stdout: `${JSON.stringify(added)}\n` };
            switch (added.outcome) {
              case "added":
                return { exitCode: 0, stdout: `Recorded ${added.id}: ${added.text}\n` };
              case "duplicate":
                throw new PluginCliError("This thread already has that follow-up.");
              case "dismissed":
                throw new PluginCliError(
                  "That follow-up was dismissed on this thread and will not come " +
                    "back. `bb follow-up forget` releases dismissed texts.",
                );
              case "filed":
                throw new PluginCliError(
                  "That follow-up was filed elsewhere from this thread, so it is " +
                    "tracked there and will not be added again. " +
                    "`bb follow-up forget --filed` releases filed texts.",
                );
              default:
                throw new PluginCliError("This thread is holding as many follow-ups as it may.");
            }
          },
        }),

        show,

        move: cliCommand({
          summary: "Place a follow-up at the front or the back of the list",
          positionals: [
            idArgument,
            { name: "position", required: true, description: "top or bottom" },
          ],
          options: { thread: threadOption, json: jsonFailure },
          async run({ options, positionals }, ctx) {
            const threadId = threadFor(options.thread, ctx);
            const { id, position } = positionals;
            if (position !== "top" && position !== "bottom") {
              throw new PluginCliError("move needs a follow-up id and top or bottom.");
            }
            const moved = await moveOne(threadId, id, position, "user");
            if (moved === null) {
              throw new PluginCliError(`No open follow-up with id ${id} on ${threadId}.`);
            }
            return { exitCode: 0, stdout: `Moved to the ${position}: ${moved.row.text}\n` };
          },
        }),

        amend: cliCommand({
          summary: "Change a follow-up in place, keeping its id, age and position",
          positionals: [idArgument],
          options: {
            thread: threadOption,
            json: jsonFailure,
            text: { type: "string", description: "New text" },
            detail: { type: "string", description: "New detail" },
            file: { type: "string", placeholder: "path", description: "New file anchor" },
            reason: { type: "enum", values: REASONS, description: "New reason" },
          },
          constraints: [
            { kind: "at-least-one", options: ["text", "detail", "file", "reason"] },
          ],
          async run({ options, positionals }, ctx) {
            const threadId = threadFor(options.thread, ctx);
            const patch: Record<string, string> = {};
            for (const field of ["text", "detail", "file", "reason"] as const) {
              const value = options[field];
              if (value !== undefined) patch[field] = value;
            }
            const result = await amendOne(threadId, positionals.id, patch, "user");
            if (result.outcome === "too-long") {
              throw new PluginCliError(
                `Not amended: the text is a title of at most ${TITLE_MAX} characters. ` +
                  "Put the rest in --detail.",
              );
            }
            if (result.outcome === "filed") {
              throw new PluginCliError(
                `Not amended: that wording was filed to ${result.filedAs?.to ?? "a destination"} ` +
                  "from this thread, so it is tracked there.",
              );
            }
            if (result.outcome !== "amended") {
              throw new PluginCliError(`Not amended (${result.outcome}).`);
            }
            return { exitCode: 0, stdout: `Amended: ${result.row?.text}\n` };
          },
        }),

        done: setDoneCommand(true),
        reopen: setDoneCommand(false),
        file: cliCommand({
          summary:
            "File follow-ups to a destination (this project's default unless --to), and wait for the result",
          positionals: [
            {
              name: "id",
              required: false,
              variadic: true,
              description: "Follow-ups to file; omit with --all",
            },
          ],
          options: {
            thread: threadOption,
            json: jsonResult,
            all: { type: "boolean", description: "File every open follow-up" },
            to: {
              type: "string",
              placeholder: "destination",
              description: "A destination's name or id; see `bb follow-up destinations`",
            },
          },
          async run({ options, positionals }, ctx) {
            const threadId = threadFor(options.thread, ctx);
            const ids = positionals.id ?? [];
            if (options.all !== true && ids.length === 0) {
              throw new PluginCliError("Name the follow-ups to file, or pass --all.");
            }
            const resolved = await resolveFiling(
              threadId,
              options.all === true ? null : ids,
              options.to ?? null,
            );
            if (resolved.outcome === "no-destination") {
              throw new PluginCliError(
                "This project has no default destination. Pass --to, or pick one in the card once.",
              );
            }
            if (resolved.outcome === "unknown-destination") {
              throw new PluginCliError(
                `No destination called ${options.to}. \`bb follow-up destinations\` lists them.`,
              );
            }
            if (resolved.outcome !== "ok") {
              throw new PluginCliError("Nothing to file: no open follow-up matches.");
            }
            // Run from inside a thread, this is how an agent files from its
            // shell, so it meets the same gate as the tool, asked where it
            // runs. From a terminal outside any thread, it is the person.
            let rows = resolved.rows;
            let destination = resolved.destination;
            let by: "agent" | "user" = "user";
            if (ctx.threadId !== undefined && ctx.threadId !== null && ctx.threadId !== "") {
              const fresh = await confirmedFiling(ctx.threadId, threadId, resolved, ctx.signal);
              if (fresh.outcome !== "ok") throw new PluginCliError(CONFIRM_REFUSED[fresh.outcome]);
              rows = fresh.rows;
              destination = fresh.destination;
              by = "agent";
            }
            const reports = await fileRows(threadId, rows, destination, by);
            if (options.json) {
              return { exitCode: 0, stdout: `${JSON.stringify({ reports })}\n` };
            }
            const lines = reports.map((report) =>
              report.outcome === "filed"
                ? `Filed${report.ref ? ` (${report.ref})` : ""}: ${report.text}`
                : report.outcome === "pending"
                  ? `Handed to the ${destination.name} helper: ${report.text}`
                  : `Not filed: ${report.text} — ${report.note}`,
            );
            const failed = reports.some((report) => report.outcome === "failed");
            return failed
              ? { exitCode: 1, stdout: `${lines.join("\n")}\n`, stderr: "" }
              : { exitCode: 0, stdout: `${lines.join("\n")}\n` };
          },
        }),
        destinations: cliCommand({
          summary: "List where follow-ups can be filed, as set up in the plugin's settings",
          options: { thread: threadOption, json: jsonResult },
          async run({ options }, ctx) {
            const destinations = await readDestinations();
            // The default belongs to the thread's project; outside a thread
            // there is no project to ask about, and the list is still useful.
            let projectId: string | null = null;
            const threadId = options.thread ?? ctx.threadId ?? null;
            if (threadId !== null) {
              try {
                projectId = (await bb.sdk.threads.get({ threadId })).projectId ?? null;
              } catch {
                projectId = null;
              }
            }
            const fallback = await readDefaultDestination(projectId);
            if (options.json) {
              return {
                exitCode: 0,
                stdout: `${JSON.stringify({ destinations, defaultId: fallback?.id ?? null })}\n`,
              };
            }
            if (destinations.length === 0) {
              return {
                exitCode: 0,
                stdout: "No destinations yet. Set them up under Settings → Plugins → Follow Up.\n",
              };
            }
            const width = Math.max(...destinations.map((destination) => destination.name.length));
            const lines = destinations.map((destination) => {
              const kind = destination.kind === "command" ? "command" : "agent";
              const mark = destination.id === fallback?.id ? "  (default for this project)" : "";
              return `${destination.name.padEnd(width)}  ${kind}${mark}`;
            });
            return { exitCode: 0, stdout: `${lines.join("\n")}\n` };
          },
        }),
        filed: cliCommand({
          summary:
            "Record that a follow-up was filed somewhere else; it moves to Done and is not recorded here again",
          positionals: [idArgument],
          options: {
            thread: threadOption,
            json: jsonFailure,
            to: {
              type: "string",
              required: true,
              placeholder: "destination",
              description: "Where it was filed",
            },
            ref: {
              type: "string",
              placeholder: "ref",
              description: "What the destination gave back: a URL or a key like ENG-1482",
            },
          },
          async run({ options, positionals }, ctx) {
            const threadId = threadFor(options.thread, ctx);
            const to = await destinationFor(options.to);
            const { outcome, row } = await markFiled(
              threadId,
              positionals.id,
              to,
              options.ref ?? null,
              "user",
            );
            if (outcome === "not-found") {
              throw new PluginCliError(`No follow-up with id ${positionals.id} on ${threadId}.`);
            }
            if (outcome === "already-filed") {
              throw new PluginCliError(
                `Already filed to ${row?.filedTo?.name ?? "a destination"}${row?.filedRef ? ` (${row.filedRef})` : ""}.`,
              );
            }
            return {
              exitCode: 0,
              stdout: `Filed to ${to.name}${options.ref ? ` (${options.ref})` : ""}: ${row?.text}\n`,
            };
          },
        }),

        "clear-done": cliCommand({
          summary: "Empty Done, so finished follow-ups can be recorded again if they recur (filed ones cannot)",
          options: { thread: threadOption, json: jsonFailure },
          async run({ options }, ctx) {
            const cleared = await clearDone(threadFor(options.thread, ctx));
            return {
              exitCode: 0,
              stdout:
                `Cleared ${cleared} finished follow-up${cleared === 1 ? "" : "s"}. ` +
                `They can be recorded again if they recur.\n`,
            };
          },
        }),

        describe: cliCommand({
          summary: "Have a short-lived helper read the thread and write a follow-up's detail",
          positionals: [idArgument],
          options: { thread: threadOption, json: jsonResult },
          // The same call the row's button makes, so the two cannot drift.
          // Without this the expansion path had no route but a click, which is
          // how a retry written around the wrong failure survived review: the
          // spawn does not throw on a dead provider, and nothing short of
          // running the feature would have shown that.
          async run({ options, positionals }, ctx) {
            const threadId = threadFor(options.thread, ctx);
            const { id } = positionals;
            const started = await startExpansion(
              threadId,
              id,
              await readExpansionExecution(),
              false,
            );
            if (options.json) {
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
                throw new PluginCliError(`No follow-up with id ${id} on ${threadId}.`);
              case "disabled":
                throw new PluginCliError(
                  "Describing is switched off. Turn on \"Offer Describe this in " +
                    "more detail\" in the plugin's settings, or run " +
                    "`bb plugin config follow-up set offerDescribe true`.",
                );
              default:
                throw new PluginCliError(`Could not start a helper for ${id}.`);
            }
          },
        }),

        dismiss: cliCommand({
          summary: "Dismiss one follow-up so it is never recorded on this thread again",
          positionals: [idArgument],
          options: { thread: threadOption, json: jsonResult },
          async run({ options, positionals }, ctx) {
            const threadId = threadFor(options.thread, ctx);
            const { dismissed, followUps } = await dismissFollowUp(threadId, positionals.id);
            if (dismissed === null) {
              throw new PluginCliError(`No follow-up with id ${positionals.id} on ${threadId}.`);
            }
            if (options.json) return { exitCode: 0, stdout: `${JSON.stringify(followUps)}\n` };
            return {
              exitCode: 0,
              stdout: `Dismissed: ${dismissed.text}\nIt will not be recorded again on this thread.\n`,
            };
          },
        }),

        handoff: cliCommand({
          summary:
            "Send a follow-up to a new thread, optionally invoking a skill on it (a child of this one unless --new)",
          positionals: [
            idArgument,
            { name: "skill", description: "A skill to invoke on the new thread, as /<skill>" },
          ],
          options: {
            thread: threadOption,
            json: jsonResult,
            new: {
              type: "boolean",
              description: "Start an independent thread rather than a child of this one",
            },
            provider: { type: "string", placeholder: "id", description: "Provider for the new thread" },
            model: { type: "string", placeholder: "model", description: "Model for the new thread" },
            "reasoning-level": {
              type: "enum",
              values: ["low", "medium", "high", "xhigh", "max"],
              description: "Reasoning level for the new thread",
            },
            // Not a list: since SDK 0.6 each provider declares its own tiers,
            // and `bb thread spawn` takes any id the provider lists.
            "service-tier": {
              type: "string",
              placeholder: "tier",
              description: "Any tier id the provider lists for the model (see `bb provider models`)",
            },
            "permission-mode": {
              type: "enum",
              values: ["accept-edits", "auto", "full"],
              description: "Permission mode for the new thread",
            },
          },
          async run({ options, positionals }, ctx) {
            const threadId = threadFor(options.thread, ctx);
            const { id, skill } = positionals;
            // `here` is deliberately absent: it only fills a composer, and
            // there is no composer on the far side of a CLI.
            const target = options.new ? ("thread" as const) : ("child" as const);

            // Build the execution options, and their provenance, from whatever
            // was actually passed. A flag nobody gave contributes nothing, so
            // omitting them all still means project defaults.
            const execution: Record<string, unknown> = {};
            const sources: Record<string, "explicit"> = {};
            for (const flag of EXECUTION_FLAGS) {
              const raw: string | undefined = options[flag.name];
              if (raw === undefined) continue;
              // The same rule the stored expansion tier follows in
              // lib/expansion-execution.ts: trimmed, non-blank, bounded.
              const value = flag.field === "serviceTier" ? raw.trim() : raw;
              if (flag.field === "serviceTier" && value === "") {
                throw new PluginCliError(`--${flag.name} needs a value.`);
              }
              if (flag.field === "serviceTier" && value.length > SERVICE_TIER_MAX) {
                throw new PluginCliError(
                  `--${flag.name} must be ${SERVICE_TIER_MAX} characters or fewer.`,
                );
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
            if (options.json) return { exitCode: 0, stdout: `${JSON.stringify(result)}\n` };
            if (result.outcome !== "spawned") {
              throw new PluginCliError(`Handoff failed: ${result.outcome}`);
            }
            return {
              exitCode: 0,
              stdout: `Handed off to ${result.spawnedThreadId}${skill === undefined ? "" : ` as /${skill}`}${target === "child" ? " (child of this thread)" : ""}\n`,
            };
          },
        }),

        clear: cliCommand({
          summary: "Drop the follow-ups recorded on a thread",
          options: { thread: threadOption, json: jsonFailure },
          async run({ options }, ctx) {
            const threadId = threadFor(options.thread, ctx);
            const count = (await listFollowUps(threadId)).length;
            await bb.storage.kv.delete(itemsKey(threadId));
            bb.realtime.publish(FOLLOWUPS_CHANGED, { threadId });
            return {
              exitCode: 0,
              stdout: `Cleared ${count} follow-up${count === 1 ? "" : "s"} from ${threadId}.\n`,
            };
          },
        }),

        forget: cliCommand({
          summary: "Drop the dismissal record, so dismissed follow-ups can be recorded again",
          options: {
            thread: threadOption,
            json: jsonFailure,
            // Its own flag, not part of the plain command: a filed text is
            // kept out because the work is tracked somewhere else, and letting
            // it back is a separate decision from un-dismissing.
            filed: {
              type: "boolean",
              description: "Release texts filed elsewhere from this thread instead, so they can be recorded here again",
            },
          },
          async run({ options }, ctx) {
            const threadId = threadFor(options.thread, ctx);
            if (options.filed === true) {
              const filed = (await readFiledMarks(threadId)).length;
              await bb.storage.kv.delete(filedKey(threadId));
              return {
                exitCode: 0,
                stdout: `Forgot ${filed} filed text${filed === 1 ? "" : "s"} on ${threadId}.\n`,
              };
            }
            const count = (await readTombstones(threadId)).length;
            await bb.storage.kv.delete(tombsKey(threadId));
            return {
              exitCode: 0,
              stdout: `Forgot ${count} dismissal${count === 1 ? "" : "s"} on ${threadId}.\n`,
            };
          },
        }),
      },
    }),
  );

  bb.onDispose(() => {
    bb.log.info("disposed");
  });
}
