// The Follow Up page: every thread that needs you, in one list.
//
// Pure, like followups.ts and next-steps.ts: no plugin API, so every rule here
// is testable without a running bb. Keep `bb.*` calls in server.ts, which
// gathers the facts and hands them to `cardFor` one thread at a time.
//
// One card per thread, not one per ask. A thread that offered next steps and
// has a pull request ready is one thing to look at, and the count in the
// sidebar is a count of threads that want you, which is what you can act on.
// The card's lead ask — the most urgent thing it holds — decides its tier.
//
// Three tiers, in the order they are worth your time:
//
// - **Blocked**: the agent is stopped mid-turn on a question, an approval or a
//   form, and nothing moves until you answer. Longest-waiting first, because a
//   stalled agent is time already being wasted.
// - **Your turn**: the turn ended with something for you — steps it offered,
//   a wrap-up, a page to answer, a pull request, or a failure. Newest first.
// - **Finished**: the turn ended without asking anything, and you have not
//   read it. Newest first, and capped: past a screenful they are the sidebar's
//   unread dots, not a to-do list.
//
// A thread that is working and asks nothing is not a card. It is in the "In
// motion" lane, which says what it is doing rather than what it wants.
import { z } from "zod";
import { mainActionFor, type FollowUp, type Reason, REASONS } from "./followups.ts";

/** Thread statuses with a turn under way, or about to be. Matches server.ts. */
export const BUSY_STATUSES: ReadonlySet<string> = new Set([
  "active",
  "pending",
  "starting",
  "stopping",
]);

/**
 * How long a thread may sit in `pending` and still count as about to start.
 *
 * `pending` is waiting to start — behind a concurrency limit, or provisioning.
 * A thread left there for a day did not start and is not going to on its own;
 * listing it as in motion would be a spinner that never stops.
 */
export const PENDING_STALE_MS = 24 * 60 * 60 * 1000;

/**
 * Something on the Follow Up page changed: open pages and the sidebar count
 * refetch. Here rather than in server.ts because the page listens for it.
 */
export const PAGE_CHANGED = "followups-page-changed";

/** Finished cards shown before the rest fold into a count. */
export const FINISHED_CAP = 20;

/** The excerpt of a reply a card quotes: its end, where a question would be. */
export const EXCERPT_MAX = 320;

/** How many cards the new-thread page's strip shows. */
export const STRIP_MAX = 3;

/** The longest message the page sends into a thread for you. */
export const REPLY_MAX = 8000;

export type Tier = "blocked" | "turn" | "finished";

/** What the page needs to know about a thread, from one `threads.list` row. */
export interface ThreadFacts {
  id: string;
  title: string;
  projectId: string;
  parentThreadId: string | null;
  status: string;
  archived: boolean;
  lastReadAt: number | null;
  latestAttentionAt: number;
  updatedAt: number;
  /** When the thread was created: the first thread in a worktree opened it. */
  createdAt: number;
  hasPendingInteraction: boolean;
  environmentId: string | null;
  environmentIsWorktree: boolean;
}

/**
 * A `threads.list` row, as loosely as the page reads it. Every field is
 * optional and checked: the list is the host's shape, and a page that threw on
 * a field the host renamed would show nothing at all.
 */
export function threadFacts(row: Record<string, unknown>): ThreadFacts | null {
  const id = typeof row.id === "string" ? row.id : null;
  const projectId = typeof row.projectId === "string" ? row.projectId : null;
  if (id === null || projectId === null) return null;
  const text = (value: unknown) =>
    typeof value === "string" && value.trim() !== "" ? value.trim() : null;
  const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
  return {
    id,
    title: text(row.title) ?? text(row.titleFallback) ?? "Untitled thread",
    projectId,
    parentThreadId: text(row.parentThreadId),
    status: typeof row.status === "string" ? row.status : "idle",
    archived: num(row.archivedAt) !== null,
    lastReadAt: num(row.lastReadAt),
    latestAttentionAt: num(row.latestAttentionAt) ?? 0,
    updatedAt: num(row.updatedAt) ?? 0,
    createdAt: num(row.createdAt) ?? 0,
    hasPendingInteraction: row.hasPendingInteraction === true,
    environmentId: text(row.environmentId),
    environmentIsWorktree: row.environmentIsWorktree === true,
  };
}

export function isUnread(thread: ThreadFacts): boolean {
  return thread.latestAttentionAt > (thread.lastReadAt ?? 0);
}

export function isBusy(status: string): boolean {
  return BUSY_STATUSES.has(status);
}

/** Working right now, or about to be — the "In motion" lane. */
export function inMotion(thread: ThreadFacts, now: number): boolean {
  if (thread.archived || thread.hasPendingInteraction) return false;
  if (thread.status === "pending") return now - thread.updatedAt < PENDING_STALE_MS;
  return isBusy(thread.status);
}

// ---------------------------------------------------------------------------
// Pending asks

const questionSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  shortLabel: z.string().nullable(),
  multiSelect: z.boolean(),
  allowFreeText: z.boolean(),
  options: z.array(
    z.object({ label: z.string(), value: z.string(), description: z.string().nullable() }),
  ),
});
export type Question = z.infer<typeof questionSchema>;

export const APPROVAL_SUBJECTS = [
  "command",
  "file_change",
  "permission_grant",
  "plan",
  "tool_use",
] as const;

export const DECISIONS = ["allow_once", "allow_for_session", "deny"] as const;
export type Decision = (typeof DECISIONS)[number];

/** What an approval would let the agent touch: paths it reads and writes, and the network. */
const grantSchema = z.object({
  read: z.array(z.string()),
  write: z.array(z.string()),
  network: z.boolean(),
});
export type Grant = z.infer<typeof grantSchema>;

/**
 * The most of a file change a card carries. One bigger than this is answered
 * in the thread, since the page answers only what it can show whole.
 */
export const PATCH_MAX = 40_000;
export const PATCH_FILES_MAX = 10;

/**
 * Everything an approval card shows, by kind: what bb's own approval card
 * shows, so answering from the page is answering the same question.
 */
export const approvalDetailSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("command"),
    command: z.string(),
    cwd: z.string().nullable(),
    /** What the command reads, lists or searches, when bb could tell. */
    actions: z.array(z.string()),
    /** What "Allow for session" would also allow, when it is on offer. */
    sessionGrant: grantSchema.nullable(),
  }),
  z.object({
    kind: z.literal("file_change"),
    itemId: z.string(),
    writeScope: z.string().nullable(),
    sessionGrant: grantSchema.nullable(),
    /** The change itself, looked up from the thread's events; empty when it could not be. */
    files: z.array(
      z.object({
        path: z.string(),
        change: z.string(),
        /** Where a renamed file goes. */
        movedTo: z.string().nullable(),
        patch: z.string(),
        cut: z.boolean(),
        /** Its path or diff held characters that don't draw; see `unseen` on the ask. */
        unseen: z.boolean(),
      }),
    ),
  }),
  z.object({
    kind: z.literal("permission_grant"),
    toolName: z.string().nullable(),
    asked: grantSchema,
  }),
  z.object({
    kind: z.literal("plan"),
    plan: z.string(),
    planFilePath: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("tool_use"),
    tool: z.string(),
    title: z.string().nullable(),
    detail: z.string().nullable(),
    /** bb marks some tools destructive; the card says so in red. */
    destructive: z.boolean(),
    badge: z.string().nullable(),
  }),
]);
export type ApprovalDetail = z.infer<typeof approvalDetailSchema>;
export type ChangedFile = Extract<ApprovalDetail, { kind: "file_change" }>["files"][number];

export const pendingAskSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("question"),
    interactionId: z.string(),
    createdAt: z.number(),
    questions: z.array(questionSchema),
  }),
  z.object({
    kind: z.literal("approval"),
    interactionId: z.string(),
    createdAt: z.number(),
    subject: z.enum(APPROVAL_SUBJECTS),
    /** One line saying what is being approved: the command, the path, the tool. */
    summary: z.string(),
    /** The choices this approval offers, in bb's order. */
    decisions: z.array(z.enum(DECISIONS)),
    /** Why the agent asked, when it said. */
    reason: z.string().nullable(),
    detail: approvalDetailSchema,
    /**
     * Some of its text held characters that draw nothing or reorder what is
     * around them. They are shown as ⟦U+…⟧ rather than removed, and the card
     * says so: removing them would show something other than what runs.
     */
    unseen: z.boolean(),
    /**
     * Why the page won't answer it, when it won't: the page answers only an
     * approval whose card shows all that answering does. Then `decisions` is
     * empty and the card sends you to the thread.
     */
    held: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("form"),
    interactionId: z.string(),
    createdAt: z.number(),
    title: z.string(),
  }),
]);
export type PendingAsk = z.infer<typeof pendingAskSchema>;

const SUMMARY_MAX = 200;

function oneLine(text: string, max = SUMMARY_MAX): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * One pending interaction, as the page shows it, or null for one that is not
 * pending or that the page cannot read.
 *
 * Read defensively for the same reason `threadFacts` is: an interaction kind
 * this code has not seen still makes the thread blocked — `hasPendingInteraction`
 * says so — so an unreadable one becomes a generic form that opens the thread,
 * never a thread that silently drops off the list.
 */
/**
 * The ask an interaction makes, or null when it is not pending. `events` are
 * the thread's started items, where a file change's diff is: without them a
 * file change's approval is held for the thread.
 */
export function pendingAsk(interaction: unknown, events?: readonly unknown[]): PendingAsk | null {
  const row = record(interaction);
  if (row === null || row.status !== "pending") return null;
  const interactionId = typeof row.id === "string" ? row.id : null;
  if (interactionId === null) return null;
  const createdAt = typeof row.createdAt === "number" ? row.createdAt : 0;
  const payload = record(row.payload);
  const kind = payload?.kind;

  if (kind === "user_question" && Array.isArray(payload?.questions)) {
    const questions: Question[] = [];
    for (const raw of payload.questions) {
      const q = record(raw);
      if (q === null || typeof q.id !== "string" || typeof q.prompt !== "string") continue;
      const options = Array.isArray(q.options) ? q.options : [];
      questions.push({
        id: q.id,
        prompt: q.prompt,
        shortLabel: typeof q.shortLabel === "string" ? q.shortLabel : null,
        multiSelect: q.multiSelect === true,
        allowFreeText: q.allowFreeText === true,
        options: options.flatMap((rawOption) => {
          const option = record(rawOption);
          if (option === null || typeof option.label !== "string") return [];
          return [
            {
              label: option.label,
              value: typeof option.value === "string" ? option.value : option.label,
              description: typeof option.description === "string" ? option.description : null,
            },
          ];
        }),
      });
    }
    if (questions.length > 0) return { kind: "question", interactionId, createdAt, questions };
  }

  if (kind === "approval") {
    const subject = record(payload?.subject);
    const subjectKind = subject?.kind;
    if (typeof subjectKind === "string" && (APPROVAL_SUBJECTS as readonly string[]).includes(subjectKind)) {
      const offered = Array.isArray(payload?.availableDecisions) ? payload.availableDecisions : [];
      const reason = typeof payload?.reason === "string" && payload.reason.trim() !== "" ? payload.reason.trim() : null;
      const shown = approvalDetail(subject ?? {});
      const changes =
        shown.kind === "file_change" && shown.itemId !== "" && events !== undefined
          ? fileChangesFor(shown.itemId, events)
          : null;
      const detail = shown.kind === "file_change" && changes !== null ? { ...shown, files: changes.files } : shown;
      // Only choices bb offers, and of those only ones whose effect the card
      // shows: Allow for session sends a session grant, so it goes when the
      // grant holds anything the card can't list.
      const choices = DECISIONS.filter(
        (decision) =>
          offered.includes(decision) &&
          (decision !== "allow_for_session" || !("sessionGrant" in (subject ?? {})) || grantShown(subject?.sessionGrant)),
      );
      const held = holdOf(subject ?? {}, detail, changes) ?? (choices.length === 0 ? "It offers no choice the page can make." : null);
      return {
        kind: "approval",
        interactionId,
        createdAt,
        subject: subjectKind as (typeof APPROVAL_SUBJECTS)[number],
        summary: reveal(approvalSummary(subject ?? {})),
        decisions: held === null ? choices : [],
        reason: reason === null ? null : reveal(reason),
        detail,
        unseen:
          hasUnseen(subject) ||
          (reason !== null && hasUnseen(reason)) ||
          (changes?.files.some((file) => file.unseen) ?? false),
        held,
      };
    }
  }

  const title =
    typeof payload?.title === "string" && payload.title.trim() !== ""
      ? oneLine(payload.title)
      : "A form is waiting";
  return { kind: "form", interactionId, createdAt, title };
}

/**
 * The asks a thread is shown with. bb says the thread is waiting on you
 * (`hasPendingInteraction`) but none could be read — the read failed, or
 * came back empty in a race — so it gets one generic ask that opens the
 * thread. A thread bb says is stopped on you never drops off the page: a
 * busy one would otherwise be on neither the cards nor In motion.
 */
export function asksFor(thread: ThreadFacts, read: readonly PendingAsk[]): PendingAsk[] {
  if (read.length > 0 || !thread.hasPendingInteraction) return [...read];
  return [{ kind: "form", interactionId: "", createdAt: thread.updatedAt, title: "Waiting on you in the thread" }];
}

function approvalSummary(subject: Record<string, unknown>): string {
  switch (subject.kind) {
    case "command":
      return typeof subject.command === "string" ? oneLine(subject.command) : "Run a command";
    case "file_change":
      return typeof subject.writeScope === "string" && subject.writeScope !== ""
        ? `Change files in ${oneLine(subject.writeScope)}`
        : "Change files";
    case "permission_grant":
      return typeof subject.toolName === "string" && subject.toolName !== ""
        ? `Grant permissions to ${oneLine(subject.toolName)}`
        : "Grant permissions";
    case "plan":
      return typeof subject.plan === "string" && subject.plan.trim() !== ""
        ? oneLine(firstLine(subject.plan))
        : "Approve a plan";
    case "tool_use": {
      const presentation = record(subject.presentation);
      const title = typeof presentation?.title === "string" ? presentation.title : null;
      const tool = typeof subject.tool === "string" ? subject.tool : "a tool";
      return oneLine(title ?? `Use ${tool}`);
    }
    default:
      return "Approve";
  }
}

/**
 * Characters that draw nothing, or change how what is around them draws: the
 * set next steps refuse (lib/next-steps.ts), less the newline and tab that a
 * command or a plan legitimately holds. A bidi override can make a command
 * read differently from what runs, and a zero-width character can hide part
 * of a path, so in an approval each is shown, as ⟦U+202E⟧, never dropped.
 */
const UNSEEN = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/u;
const PICTOGRAPH = /[\p{Extended_Pictographic}\p{Emoji_Modifier}]/u;

/** Whether the character at `index` (of code points) draws nothing. */
function unseenAt(chars: readonly string[], index: number): boolean {
  const char = chars[index]!;
  if (char === "\n" || char === "\t" || !UNSEEN.test(char)) return false;
  // An emoji is drawn with these: a variation selector after a pictograph,
  // and a joiner between two, belong to a symbol that does show.
  const before = chars[index - 1] ?? "";
  const after = chars[index + 1] ?? "";
  if ((char === "\uFE0F" || char === "\uFE0E") && PICTOGRAPH.test(before)) return false;
  if (char === "\u200D" && PICTOGRAPH.test(after)) {
    return !(PICTOGRAPH.test(before) || (before === "\uFE0F" && PICTOGRAPH.test(chars[index - 2] ?? "")));
  }
  return true;
}

/** Text with every unseen character shown as ⟦U+XXXX⟧. */
export function reveal(text: string): string {
  const chars = [...text];
  return chars
    .map((char, index) =>
      unseenAt(chars, index) ? `⟦U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}⟧` : char,
    )
    .join("");
}

/** Whether any string anywhere in a value holds an unseen character. */
export function hasUnseen(value: unknown): boolean {
  if (typeof value === "string") {
    const chars = [...value];
    return chars.some((_, index) => unseenAt(chars, index));
  }
  if (Array.isArray(value)) return value.some(hasUnseen);
  const row = record(value);
  return row !== null && Object.values(row).some(hasUnseen);
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string").map(reveal)
    : [];
}

/** A permission object (`{ fileSystem: { read, write }, network: { enabled } }`) as a card shows it. */
/**
 * Why the page won't answer an approval, or null when its card shows all that
 * answering it does. A card that can't show the command, the plan or the tool
 * shows nothing to approve; a file change needs every file's whole diff; and
 * a permission grant sends its permissions, so they must all be listable.
 */
function holdOf(subject: Record<string, unknown>, detail: ApprovalDetail, changes: FileChanges | null): string | null {
  switch (detail.kind) {
    case "command":
      return detail.command === "" ? "Its command couldn't be read here." : null;
    case "plan":
      return detail.plan === "" ? "Its plan couldn't be read here." : null;
    case "tool_use":
      return typeof subject.tool === "string" && subject.tool.trim() !== "" ? null : "Its tool couldn't be read here.";
    case "permission_grant":
      return grantShown(subject.permissions) ? null : "It asks for more than the page can list.";
    case "file_change":
      if (changes === null || changes.files.length === 0) return "Its diff couldn't be read here.";
      return changes.whole ? null : "Its change is too big to show whole here.";
  }
}

/**
 * Whether the card lists all of a grant: bb's own shape, `{ network:
 * { enabled }, fileSystem: { read, write } }` with paths for strings, and
 * nothing else. A grant is sent as it came, so anything the card can't list
 * would be granted unseen.
 */
function grantShown(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  const only = (row: Record<string, unknown>, keys: readonly string[]) => Object.keys(row).every((key) => keys.includes(key));
  const grant = record(value);
  if (grant === null || !only(grant, ["network", "fileSystem"])) return false;
  if (grant.network !== null && grant.network !== undefined) {
    const network = record(grant.network);
    if (network === null || !only(network, ["enabled"])) return false;
    if (network.enabled !== null && network.enabled !== undefined && typeof network.enabled !== "boolean") return false;
  }
  if (grant.fileSystem !== null && grant.fileSystem !== undefined) {
    const fileSystem = record(grant.fileSystem);
    if (fileSystem === null || !only(fileSystem, ["read", "write"])) return false;
    for (const paths of [fileSystem.read, fileSystem.write]) {
      if (paths === null || paths === undefined) continue;
      if (!Array.isArray(paths) || !paths.every((path) => typeof path === "string")) return false;
    }
  }
  return true;
}

function grantOf(value: unknown): Grant | null {
  const permissions = record(value);
  if (permissions === null) return null;
  const fileSystem = record(permissions.fileSystem);
  return {
    read: strings(fileSystem?.read),
    write: strings(fileSystem?.write),
    network: record(permissions.network)?.enabled === true,
  };
}

function actionLabel(action: unknown): string | null {
  const row = record(action);
  switch (row?.type) {
    case "read":
      return typeof row.name === "string" || typeof row.path === "string"
        ? reveal(`Reads ${String(row.name ?? row.path)}`)
        : null;
    case "listFiles":
      return typeof row.path === "string" ? reveal(`Lists ${row.path}`) : "Lists files";
    case "search": {
      const query = typeof row.query === "string" ? ` for "${row.query}"` : "";
      const where = typeof row.path === "string" ? ` in ${row.path}` : "";
      return reveal(`Searches${query}${where}`);
    }
    default:
      return null;
  }
}

/** An approval subject's detail, read defensively like everything from the host. */
export function approvalDetail(subject: Record<string, unknown>): ApprovalDetail {
  // Every string a card shows goes through reveal, so nothing it approves
  // can hide behind a character that doesn't draw.
  const text = (value: unknown) => (typeof value === "string" && value.trim() !== "" ? reveal(value) : null);
  switch (subject.kind) {
    case "command":
      return {
        kind: "command",
        command: text(subject.command) ?? "",
        cwd: text(subject.cwd),
        actions: (Array.isArray(subject.actions) ? subject.actions : [])
          .map(actionLabel)
          .filter((label): label is string => label !== null),
        sessionGrant: grantOf(subject.sessionGrant),
      };
    case "file_change":
      return {
        kind: "file_change",
        // Not shown, only matched against the thread's events, so left as is.
        itemId: typeof subject.itemId === "string" ? subject.itemId : "",
        writeScope: text(subject.writeScope),
        sessionGrant: grantOf(subject.sessionGrant),
        files: [],
      };
    case "permission_grant":
      return {
        kind: "permission_grant",
        toolName: text(subject.toolName),
        asked: grantOf(subject.permissions) ?? { read: [], write: [], network: false },
      };
    case "plan":
      return { kind: "plan", plan: text(subject.plan) ?? "", planFilePath: text(subject.planFilePath) };
    default: {
      const presentation = record(subject.presentation);
      const badge = record(presentation?.badge);
      return {
        kind: "tool_use",
        tool: text(subject.tool) ?? "a tool",
        title: text(presentation?.title),
        detail: text(presentation?.detail),
        destructive: badge?.tone === "destructive",
        badge: text(badge?.label),
      };
    }
  }
}

/** A file change as the card shows it, and whether that is all of it. */
export interface FileChanges {
  files: ChangedFile[];
  /**
   * Every file is there with its whole diff. Not when a file was past
   * PATCH_FILES_MAX, its diff past PATCH_MAX, or anything about it unreadable.
   */
  whole: boolean;
}

/**
 * A file change's diff, from the thread's started items: the one whose id the
 * approval names, or null when none does.
 */
export function fileChangesFor(itemId: string, events: readonly unknown[]): FileChanges | null {
  for (const event of events) {
    const item = record(record(record(event)?.data)?.item);
    if (item === null || item.id !== itemId || item.type !== "fileChange") continue;
    const changes = Array.isArray(item.changes) ? item.changes : [];
    let whole = changes.length > 0 && changes.length <= PATCH_FILES_MAX;
    const files = changes.slice(0, PATCH_FILES_MAX).flatMap((raw): ChangedFile[] => {
      const change = record(raw);
      const kind = typeof change?.kind === "string" ? change.kind : null;
      const diff = typeof change?.diff === "string" ? change.diff : null;
      if (change === null || typeof change.path !== "string" || kind === null) {
        whole = false;
        return [];
      }
      // A deletion is all there in its name; anything else needs its diff.
      if (diff === null && kind !== "delete") whole = false;
      if (change.movePath !== undefined && typeof change.movePath !== "string") whole = false;
      const patch = reveal(diff ?? "");
      const cut = patch.length > PATCH_MAX;
      if (cut) whole = false;
      return [
        {
          path: reveal(change.path),
          change: kind,
          movedTo: typeof change.movePath === "string" ? reveal(change.movePath) : null,
          patch: cut ? patch.slice(0, PATCH_MAX) : patch,
          cut,
          unseen: hasUnseen(change.path) || hasUnseen(diff) || hasUnseen(change.movePath),
        },
      ];
    });
    return { files, whole };
  }
  return null;
}

/**
 * What answering an approval sends, exactly as bb's own approval card builds
 * it (the app's resolution helpers, read from bb 0.45): a deny sends only the
 * decision. Otherwise the grant goes with it — a permission grant's own
 * permissions, normalized; for "Allow for session" on a command or a file
 * change, that subject's session grant; and nothing for anything else.
 */
export function approvalResolution(
  interaction: unknown,
  decision: Decision,
):
  | { decision: "deny" }
  | { decision: "allow_once" | "allow_for_session"; grantedPermissions: Record<string, unknown> | null } {
  if (decision === "deny") return { decision };
  const subject = record(record(record(interaction)?.payload)?.subject);
  let grantedPermissions: Record<string, unknown> | null = null;
  if (subject?.kind === "permission_grant") {
    const permissions = record(subject.permissions) ?? {};
    const fileSystem = record(permissions.fileSystem);
    grantedPermissions = {
      network: record(permissions.network)?.enabled === true ? { enabled: true } : null,
      fileSystem: fileSystem === null ? null : { read: fileSystem.read, write: fileSystem.write },
    };
  } else if (decision === "allow_for_session" && (subject?.kind === "command" || subject?.kind === "file_change")) {
    grantedPermissions = record(subject.sessionGrant);
  }
  return { decision, grantedPermissions };
}

function firstLine(text: string): string {
  const line = text.split("\n").find((entry) => entry.replace(/^#+\s*/, "").trim() !== "");
  return (line ?? text).replace(/^#+\s*/, "");
}

// ---------------------------------------------------------------------------
// Pull requests

export const prSummarySchema = z.object({
  number: z.number(),
  title: z.string(),
  url: z.string(),
  state: z.string(),
  attention: z.string(),
  headRefName: z.string(),
  baseRefName: z.string(),
  checks: z.object({
    state: z.string(),
    passed: z.number(),
    failed: z.number(),
    pending: z.number(),
    total: z.number(),
  }),
  mergeability: z.string(),
});
export type PrSummary = z.infer<typeof prSummarySchema>;

/**
 * An `environments.pullRequest` answer, narrowed to what a card shows. Null
 * when there is no pull request, the lookup failed, or the shape is not one
 * this code knows — all three mean "nothing to show", never an error.
 */
export function prSummary(response: unknown): PrSummary | null {
  const top = record(response);
  if (top === null || top.outcome !== "available") return null;
  const pr = record(top.pullRequest);
  if (pr === null || typeof pr.number !== "number" || typeof pr.url !== "string") return null;
  const checks = record(pr.checks) ?? {};
  const count = (value: unknown) => (typeof value === "number" ? value : 0);
  return {
    number: pr.number,
    title: typeof pr.title === "string" ? pr.title : `#${pr.number}`,
    url: pr.url,
    state: typeof pr.state === "string" ? pr.state : "open",
    attention: typeof pr.attention === "string" ? pr.attention : "none",
    headRefName: typeof pr.headRefName === "string" ? pr.headRefName : "",
    baseRefName: typeof pr.baseRefName === "string" ? pr.baseRefName : "",
    checks: {
      state: typeof checks.state === "string" ? checks.state : "unknown",
      passed: count(checks.passedCount),
      failed: count(checks.failedCount),
      pending: count(checks.pendingCount),
      total: count(checks.totalCount),
    },
    mergeability: typeof record(pr.mergeability)?.state === "string"
      ? (record(pr.mergeability)?.state as string)
      : "unknown",
  };
}

export const PR_ACTIONS = ["merge", "review", "fix", "rebase", "merged"] as const;
export type PrAction = (typeof PR_ACTIONS)[number];

/**
 * What a pull request wants from you, from bb's own roll-up of its checks,
 * review and mergeability. Null for the states that want nothing yet: a draft,
 * checks still running, a merge queue, or one closed without merging.
 */
export function prAction(pr: PrSummary): PrAction | null {
  switch (pr.attention) {
    case "ready_to_merge":
      return "merge";
    case "review_requested":
      return "review";
    case "changes_requested":
    case "checks_failed":
      return "fix";
    case "conflicts":
      return "rebase";
    case "merged":
      return "merged";
    default:
      return null;
  }
}

/**
 * Which thread owns each worktree's pull request.
 *
 * Only worktrees: a shared checkout's branch belongs to no one thread, and
 * asking for its pull request would hang the same one on every thread in the
 * project. And only one thread per worktree: the one that opened it, the
 * earliest created. Not the most recently active — a review thread or a
 * hand-off started in the same worktree is newer and busier, and owning the
 * PR would send it "fix this" and "I merged it" meant for the author.
 */
export function prOwners(threads: readonly ThreadFacts[]): Map<string, string> {
  const best = new Map<string, ThreadFacts>();
  for (const thread of threads) {
    if (thread.archived || !thread.environmentIsWorktree || thread.environmentId === null) continue;
    const current = best.get(thread.environmentId);
    if (
      current === undefined ||
      thread.createdAt < current.createdAt ||
      (thread.createdAt === current.createdAt && thread.id < current.id)
    ) {
      best.set(thread.environmentId, thread);
    }
  }
  return new Map([...best].map(([environmentId, thread]) => [environmentId, thread.id]));
}

// ---------------------------------------------------------------------------
// Replies

/** The path bb serves a session's Thread Page at, on its own origin. */
export function threadPagePath(threadId: string): string {
  return `/api/v1/plugins/thread-pages/http/page?session=${encodeURIComponent(threadId)}`;
}

/**
 * Whether the thread's last reply links to its own Thread Page, which is how
 * Thread Pages asks agents to end a turn: chat carries only the link. Only
 * this thread's own page counts — a reply that links to another session's
 * page is pointing somewhere, not asking here.
 *
 * The answer is the page's path, built from the thread id, never the URL the
 * reply wrote. The reply is the model's output: a link it wrote could name
 * any host, and the card's button says it opens this thread's page, so it
 * must open bb's own and nothing else. The page puts the path on its own
 * origin.
 */
export function pageLinkIn(reply: string | null, threadId: string): string | null {
  if (reply === null) return null;
  const pattern =
    /(?:https?:\/\/[^\s)<>\]"']+)?\/api\/v1\/plugins\/thread-pages\/http\/page\?[^\s)<>\]"']*/g;
  for (const match of reply.matchAll(pattern)) {
    const url = match[0];
    const query = url.slice(url.indexOf("?") + 1);
    if (new URLSearchParams(query).get("session") === threadId) return threadPagePath(threadId);
  }
  return null;
}

/**
 * The end of a reply, as a card quotes it: the last paragraph, cut from the
 * front, because a reply's question — or its conclusion — is at the end.
 * Markdown link syntax is reduced to its text so the quote reads as prose.
 */
export function excerptOf(reply: string | null, max = EXCERPT_MAX): string | null {
  if (reply === null) return null;
  const paragraphs = reply
    // A Thread Page link is the card's own button, not something to quote:
    // a reply that is only the link has nothing else to say.
    .replace(/\[[^\]]*\]\([^)]*\/api\/v1\/plugins\/thread-pages\/http\/page\?[^)]*\)/g, "")
    .replace(/(?:https?:\/\/[^\s)<>\]"']+)?\/api\/v1\/plugins\/thread-pages\/http\/page\?[^\s)<>\]"']*/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .split(/\n\s*\n/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => part !== "");
  const last = paragraphs.at(-1);
  if (last === undefined) return null;
  return last.length > max ? `…${last.slice(last.length - (max - 1))}` : last;
}

// ---------------------------------------------------------------------------
// Cards

export const LEADS = [
  "question",
  "approval",
  "form",
  "stopped",
  "wrap-up",
  "next",
  "page",
  "pr",
  "finished",
  /** A parent with no ask of its own, carrying its workers' cards. */
  "workers",
] as const;
export type Lead = (typeof LEADS)[number];

export const offerSchema = z.object({
  steps: z.array(z.string()),
  goalMet: z.boolean(),
  offeredAt: z.string(),
});

export const laneRowSchema = z.object({
  id: z.string(),
  text: z.string(),
  reason: z.enum(REASONS).nullable(),
  /** The row's lead action on the page: send it to its thread, or hand it off. */
  lead: z.enum(["do", "handoff"]),
  inProgress: z.boolean(),
});
export type LaneRow = z.infer<typeof laneRowSchema>;

/**
 * One open follow-up as the page shows it. An archived thread has no turn to
 * send a row into, so its rows lead with a hand-off; so does an out-of-scope
 * row anywhere.
 */
export function laneRow(row: FollowUp, archived: boolean): LaneRow {
  return {
    id: row.id,
    text: row.text,
    reason: row.reason,
    lead: archived || mainActionFor(row.reason as Reason | null) === "handoff" ? "handoff" : "do",
    inProgress: row.sentAt != null,
  };
}

/** One thread's card, as it stands before families are combined. */
export const baseCardSchema = z.object({
  threadId: z.string(),
  title: z.string(),
  projectId: z.string(),
  parentThreadId: z.string().nullable(),
  parentTitle: z.string().nullable(),
  tier: z.enum(["blocked", "turn", "finished"]),
  lead: z.enum(LEADS),
  /** Epoch ms: when the oldest ask arrived, or the turn ended. */
  since: z.number(),
  /**
   * The thread's own attention mark, which "Not now" hides it at. Not always
   * `since`: a family card's `since` can be a worker's, and hiding the parent
   * at that would bring the parent straight back.
   */
  attentionAt: z.number(),
  asks: z.array(pendingAskSchema),
  offer: offerSchema.nullable(),
  openFollowUps: z.number(),
  /**
   * The thread's open follow-ups, so a card offering to close the thread out —
   * merge its PR, archive it — shows what would be left behind.
   */
  followUps: z.array(laneRowSchema),
  wrapUp: z.object({ held: z.string().nullable(), running: z.boolean() }).nullable(),
  pr: prSummarySchema.extend({ action: z.enum(PR_ACTIONS) }).nullable(),
  pageUrl: z.string().nullable(),
  excerpt: z.string().nullable(),
  unread: z.boolean(),
  status: z.string(),
  /** The review thread started from this card for its current pull request. */
  reviewThreadId: z.string().nullable(),
  /**
   * Put away with "Not now": listed in the page's Put away fold rather than
   * among the cards, and not counted, until something brings it back.
   */
  putAway: z.boolean(),
  /**
   * The state of the thread's pull request as "Not now" records it, whatever
   * that state is, so a change to it — checks failing, a review landing, a
   * merge — brings the card back. Null when the thread has none.
   */
  prKey: z.string().nullable(),
});
export type WorkerCard = z.infer<typeof baseCardSchema>;

export const cardSchema = baseCardSchema.extend({
  /**
   * The cards of this thread's workers — child threads, at any depth — that
   * want something other than an answer to a stopped agent. See
   * `combineFamilies`.
   */
  workers: z.array(baseCardSchema),
});
export type Card = z.infer<typeof cardSchema>;

/** Everything `cardFor` reads about one thread. */
export interface ThreadInputs {
  thread: ThreadFacts;
  /** Pending asks only. */
  asks: PendingAsk[];
  /** Null when there is none, or offers are switched off. */
  offer: { steps: string[]; goalMet: boolean; offeredAt: string } | null;
  openFollowUps: number;
  /** The open rows themselves, in the thread's own order. */
  rows?: readonly FollowUp[];
  wrapUp: { held: string | null; running: boolean } | null;
  pr: PrSummary | null;
  /** The thread's last reply, from `threads.output`. */
  reply: string | null;
  /** What "Not now" recorded for this thread, if anything. See `PutAway`. */
  hidden: PutAway | null;
  parentTitle: string | null;
  /** A review thread started for this pull request number, if any. */
  review: { prNumber: number; threadId: string } | null;
}

/**
 * What "Not now" records: the thread's attention mark when it was pressed, and
 * its pull request's state then. The card stays put away until something new
 * happens on the thread or its pull request changes. `pr` is undefined on a
 * record written before PR changes counted, which then only attention ends.
 */
export interface PutAway {
  at: number;
  pr?: string | null;
}

/** A pull request's state, in the form "Not now" compares. */
export function prKey(pr: PrSummary | null): string | null {
  return pr === null ? null : `${pr.number}:${pr.attention}`;
}

/** A stored put-away record, in its old form (a bare number) or its new one. */
export function parsePutAway(stored: unknown): PutAway | null {
  if (typeof stored === "number" && Number.isFinite(stored)) return { at: stored };
  const row = record(stored);
  if (row === null || typeof row.at !== "number") return null;
  return typeof row.pr === "string" || row.pr === null ? { at: row.at, pr: row.pr } : { at: row.at };
}

/** Whether a record still holds: nothing new on the thread, and its PR as it was. */
export function stillPutAway(hidden: PutAway | null, thread: ThreadFacts, pr: PrSummary | null): boolean {
  if (hidden === null || hidden.at < thread.latestAttentionAt) return false;
  return hidden.pr === undefined || hidden.pr === prKey(pr);
}

/**
 * The card for one thread, or null when it wants nothing from you.
 *
 * Blocked comes first and cannot be hidden: the agent is stopped, and "not
 * now" on a stopped agent is a thread nobody is coming back to. Everything
 * else is in the order a person would deal with it: a failure before a
 * wrap-up, a wrap-up before more steps, steps before a page, a page before a
 * pull request, and an unread reply last.
 */
export function cardFor(input: ThreadInputs): Card | null {
  const { thread } = input;
  if (thread.archived) return null;

  const blocked = input.asks.length > 0;
  if (!blocked && isBusy(thread.status)) return null;
  const putAway = !blocked && stillPutAway(input.hidden, thread, input.pr);

  const action = input.pr === null ? null : prAction(input.pr);
  const pr = input.pr !== null && action !== null ? { ...input.pr, action } : null;
  const pageUrl = pageLinkIn(input.reply, thread.id);
  const offer = input.offer !== null && (input.offer.steps.length > 0 || input.offer.goalMet)
    ? input.offer
    : null;
  const wrapsUp =
    input.wrapUp?.held != null || (offer?.goalMet === true && input.openFollowUps > 0);

  let lead: Lead | null;
  if (blocked) lead = oldest(input.asks).kind;
  else if (thread.status === "error") lead = "stopped";
  else if (wrapsUp) lead = "wrap-up";
  else if (offer !== null && offer.steps.length > 0) lead = "next";
  else if (pageUrl !== null) lead = "page";
  else if (pr !== null) lead = "pr";
  else if (isUnread(thread)) lead = "finished";
  else lead = null;
  if (lead === null) return null;

  // A merged pull request asks nothing: the thread is done, and archiving it
  // is tidying up. It sits with the finished turns, out of the count.
  const asksNothing = lead === "finished" || (lead === "pr" && pr?.action === "merged");
  const tier: Tier = blocked ? "blocked" : asksNothing ? "finished" : "turn";
  return {
    threadId: thread.id,
    title: thread.title,
    projectId: thread.projectId,
    parentThreadId: thread.parentThreadId,
    parentTitle: input.parentTitle,
    tier,
    lead,
    since: blocked ? oldest(input.asks).createdAt : thread.latestAttentionAt,
    attentionAt: thread.latestAttentionAt,
    asks: [...input.asks].sort((a, b) => a.createdAt - b.createdAt),
    offer,
    openFollowUps: input.openFollowUps,
    followUps: (input.rows ?? []).map((row) => laneRow(row, false)),
    wrapUp: input.wrapUp,
    pr,
    pageUrl,
    excerpt: excerptOf(input.reply),
    unread: isUnread(thread),
    status: thread.status,
    reviewThreadId:
      pr !== null && input.review !== null && input.review.prNumber === pr.number
        ? input.review.threadId
        : null,
    putAway,
    prKey: prKey(input.pr),
    workers: [],
  };
}

function oldest(asks: readonly PendingAsk[]): PendingAsk {
  return asks.reduce((a, b) => (b.createdAt < a.createdAt ? b : a));
}

const TIER_ORDER: Record<Tier, number> = { blocked: 0, turn: 1, finished: 2 };

/** Blocked longest-waiting first; your turn and finished newest first. */
export function rank(cards: readonly Card[]): Card[] {
  return [...cards].sort((a, b) => {
    if (a.tier !== b.tier) return TIER_ORDER[a.tier] - TIER_ORDER[b.tier];
    if (a.since !== b.since) return a.tier === "blocked" ? a.since - b.since : b.since - a.since;
    return a.threadId.localeCompare(b.threadId);
  });
}

/**
 * The topmost open ancestor a thread folds into, or null when its parent is
 * not open (archived, deleted, hidden) and it stands on its own.
 */
function familyRoot(thread: ThreadFacts, open: ReadonlyMap<string, ThreadFacts>): ThreadFacts | null {
  let root: ThreadFacts | null = null;
  const seen = new Set<string>([thread.id]);
  let parentId = thread.parentThreadId;
  while (parentId !== null && !seen.has(parentId)) {
    const parent = open.get(parentId);
    if (parent === undefined) break;
    root = parent;
    seen.add(parentId);
    parentId = parent.parentThreadId;
  }
  return root;
}

/**
 * One card per family. A worker — a child thread, at any depth — folds into
 * its topmost open ancestor's card, so an orchestrator and the six workers it
 * spawned are one thing to look at rather than seven.
 *
 * A blocked worker keeps a card of its own: its agent is stopped, and a
 * question folded into a list is a question nobody answers. A worker whose
 * parent is not open stands alone, as there is no card to fold into. A parent
 * with no ask of its own still gets a card, led by its workers.
 *
 * The family sits in the most urgent tier any of it is in, so the count —
 * which counts cards — counts a family once.
 */
export function combineFamilies(cards: readonly Card[], threads: readonly ThreadFacts[]): Card[] {
  const open = new Map(threads.filter((thread) => !thread.archived).map((thread) => [thread.id, thread]));
  const own = new Map(cards.map((card) => [card.threadId, card]));
  const folded = new Map<string, WorkerCard[]>();
  const standing: Card[] = [];
  for (const card of cards) {
    const thread = open.get(card.threadId);
    const root = card.tier === "blocked" || thread === undefined ? null : familyRoot(thread, open);
    if (root === null) {
      standing.push(card);
      continue;
    }
    const { workers: _nested, ...worker } = card;
    const list = folded.get(root.id) ?? [];
    list.push(worker);
    folded.set(root.id, list);
  }

  const result = standing.filter((card) => !folded.has(card.threadId));
  for (const [rootId, workers] of folded) {
    const root = open.get(rootId) as ThreadFacts;
    const parent = own.get(rootId) ?? null;
    const ranked = rank(workers.map((worker) => ({ ...worker, workers: [] }))).map(
      ({ workers: _none, ...worker }) => worker,
    );
    const tiers = [...(parent === null ? [] : [parent.tier]), ...ranked.map((worker) => worker.tier)];
    const tier = tiers.reduce((a, b) => (TIER_ORDER[b] < TIER_ORDER[a] ? b : a));
    const inTier = ranked.filter((worker) => worker.tier === tier).map((worker) => worker.since);
    const since =
      parent !== null && parent.tier === tier
        ? parent.since
        : tier === "blocked"
          ? Math.min(...inTier)
          : Math.max(...inTier);
    if (parent !== null) {
      result.push({ ...parent, tier, since, workers: ranked });
      continue;
    }
    result.push({
      threadId: root.id,
      title: root.title,
      projectId: root.projectId,
      parentThreadId: null,
      parentTitle: null,
      tier,
      lead: "workers",
      since,
      attentionAt: root.latestAttentionAt,
      asks: [],
      offer: null,
      openFollowUps: 0,
      followUps: [],
      wrapUp: null,
      pr: null,
      pageUrl: null,
      excerpt: null,
      unread: false,
      status: root.status,
      reviewThreadId: null,
      putAway: ranked.every((worker) => worker.putAway),
      prKey: null,
      workers: ranked,
    });
  }
  return result;
}

/** The id of the family a thread folds into, or null when it stands alone. */
export function familyOf(threadId: string, threads: readonly ThreadFacts[]): string | null {
  const open = new Map(threads.filter((thread) => !thread.archived).map((thread) => [thread.id, thread]));
  const thread = open.get(threadId);
  return thread === undefined ? null : (familyRoot(thread, open)?.id ?? null);
}

/**
 * The workers whose pull request merged: what "Archive the merged workers"
 * archives. Only those, so the button never takes a worker still in flight.
 */
export function mergedWorkers(card: Card): WorkerCard[] {
  return card.workers.filter((worker) => worker.pr?.action === "merged");
}

/** The sidebar's number: threads that want something from you. Not finished ones. */
export function countOf(cards: readonly Card[]): number {
  return cards.filter((card) => card.tier !== "finished").length;
}

/** Ranked cards with finished ones past the cap folded into a number. */
export function capFinished(
  ranked: readonly Card[],
  cap = FINISHED_CAP,
): { cards: Card[]; moreFinished: number } {
  const cards: Card[] = [];
  let seen = 0;
  for (const card of ranked) {
    if (card.tier === "finished" && seen++ >= cap) continue;
    cards.push(card);
  }
  return { cards, moreFinished: ranked.length - cards.length };
}

// ---------------------------------------------------------------------------
// In motion

export const baseRunningSchema = z.object({
  threadId: z.string(),
  title: z.string(),
  projectId: z.string(),
  status: z.string(),
  /** Epoch ms the current turn started, when the page could tell. */
  startedAt: z.number().nullable(),
  /** What it is doing now: "Running npm test", "Editing app.tsx". */
  now: z.string(),
  openFollowUps: z.number(),
  doneFollowUps: z.number(),
});
export type RunningWorker = z.infer<typeof baseRunningSchema>;

export const runningSchema = baseRunningSchema.extend({
  /** This thread's workers that are running too, folded under it. */
  workers: z.array(baseRunningSchema),
});
export type Running = z.infer<typeof runningSchema>;

/**
 * The In motion lane, one row per family, as the cards are: running workers
 * fold under their topmost open ancestor. A parent that is not running itself
 * still gets a row, saying how many of its workers are.
 */
export function foldRunning(rows: readonly RunningWorker[], threads: readonly ThreadFacts[]): Running[] {
  const open = new Map(threads.filter((thread) => !thread.archived).map((thread) => [thread.id, thread]));
  const folded = new Map<string, RunningWorker[]>();
  const standing: RunningWorker[] = [];
  for (const row of rows) {
    const thread = open.get(row.threadId);
    const root = thread === undefined ? null : familyRoot(thread, open);
    if (root === null) standing.push(row);
    else folded.set(root.id, [...(folded.get(root.id) ?? []), row]);
  }
  const result: Running[] = standing.map((row) => ({ ...row, workers: folded.get(row.threadId) ?? [] }));
  for (const [rootId, workers] of folded) {
    if (standing.some((row) => row.threadId === rootId)) continue;
    const root = open.get(rootId) as ThreadFacts;
    const starts = workers.map((worker) => worker.startedAt).filter((at): at is number => at !== null);
    result.push({
      threadId: root.id,
      title: root.title,
      projectId: root.projectId,
      status: root.status,
      startedAt: starts.length === 0 ? null : Math.min(...starts),
      now: workers.length === 1 ? "1 worker running" : `${workers.length} workers running`,
      openFollowUps: 0,
      doneFollowUps: 0,
      workers,
    });
  }
  return result;
}

const LABEL_MAX = 80;

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter((part) => part !== "");
  return parts.at(-1) ?? path;
}

/**
 * One line for what a started item is doing. bb's own presentation wins when
 * the item carries one — it is what the timeline itself shows — and the rest
 * are named from their kind. Reasoning is "Thinking": its text is the model's,
 * not something to quote on a dashboard.
 */
export function activityLabel(item: unknown): string {
  const row = record(item);
  if (row === null) return "Working";
  const presentation = record(row.presentation);
  const label = record(presentation?.label);
  if (typeof label?.pending === "string") {
    const title = typeof presentation?.title === "string" ? presentation.title : null;
    return oneLine(title === null ? label.pending : `${label.pending} · ${title}`, LABEL_MAX);
  }
  switch (row.type) {
    case "commandExecution":
      return typeof row.command === "string"
        ? oneLine(`Running ${firstLine(row.command)}`, LABEL_MAX)
        : "Running a command";
    case "fileChange": {
      const changes = Array.isArray(row.changes) ? row.changes : [];
      const first = record(changes[0]);
      const path = typeof first?.path === "string" ? basename(first.path) : null;
      return path === null ? "Editing files" : oneLine(`Editing ${path}`, LABEL_MAX);
    }
    case "fileRead":
      return typeof row.path === "string" ? oneLine(`Reading ${basename(row.path)}`, LABEL_MAX) : "Reading files";
    case "agentMessage":
      return "Writing a reply";
    case "reasoning":
      return "Thinking";
    default:
      return "Working";
  }
}

// ---------------------------------------------------------------------------
// Follow-ups lane

export const laneThreadSchema = z.object({
  threadId: z.string(),
  title: z.string(),
  archived: z.boolean(),
  rows: z.array(laneRowSchema),
});

export const laneGroupSchema = z.object({
  projectId: z.string(),
  projectName: z.string(),
  threads: z.array(laneThreadSchema),
});
export type LaneGroup = z.infer<typeof laneGroupSchema>;

export interface LaneInput {
  threadId: string;
  title: string;
  projectId: string;
  archived: boolean;
  updatedAt: number;
  /** Open rows only, in the thread's own order. */
  rows: readonly FollowUp[];
}

/**
 * Every open follow-up, grouped by project and then thread.
 *
 * Archived threads are included: their rows were never closed, and archiving
 * a thread is not deciding about its follow-ups. They sort after the open
 * threads of their project, which sort most recently active first, and their
 * rows lead with a handoff. A thread with nothing open is left out.
 */
export function groupFollowUps(
  inputs: readonly LaneInput[],
  projectNames: ReadonlyMap<string, string>,
): LaneGroup[] {
  const byProject = new Map<string, LaneInput[]>();
  for (const input of inputs) {
    if (input.rows.length === 0) continue;
    const list = byProject.get(input.projectId) ?? [];
    list.push(input);
    byProject.set(input.projectId, list);
  }
  return [...byProject]
    .map(([projectId, threads]) => ({
      projectId,
      projectName: projectNames.get(projectId) ?? "Other",
      threads: [...threads]
        .sort((a, b) => Number(a.archived) - Number(b.archived) || b.updatedAt - a.updatedAt)
        .map((thread) => ({
          threadId: thread.threadId,
          title: thread.title,
          archived: thread.archived,
          rows: thread.rows.map((row) => laneRow(row, thread.archived)),
        })),
    }))
    .sort((a, b) => a.projectName.localeCompare(b.projectName));
}

// ---------------------------------------------------------------------------
// Messages the page sends for you

/**
 * What "Ask the thread to fix" sends, prefilled in a box you can edit before
 * it goes. The box's text is exactly what is sent: the same rule as a
 * next-step button, because these words go into the thread under your name.
 */
export function prFixMessage(pr: PrSummary): string {
  if (pr.attention === "changes_requested") {
    return `Changes were requested on PR #${pr.number}. Read the review comments, address them, and push.`;
  }
  const failed = pr.checks.failed;
  const which = failed === 1 ? "1 check is" : `${failed} checks are`;
  return `CI failed on PR #${pr.number}: ${which} failing. Find out why, fix it, and push.`;
}

export function prRebaseMessage(pr: PrSummary): string {
  const base = pr.baseRefName === "" ? "the base branch" : pr.baseRefName;
  return `PR #${pr.number} has conflicts with ${base}. Rebase onto the latest ${base}, resolve them, and push.`;
}

/**
 * What a merge from the page tells the thread that opened the pull request.
 * Shown beside the Merge button, so pressing it sends nothing unseen. An agent
 * that opened a pull request is often waiting to hear it merged.
 */
export function prMergedMessage(pr: PrSummary): string {
  return `I merged PR #${pr.number}.`;
}

/** The prompt a review thread starts with, also shown for editing first. */
export function reviewPrompt(pr: PrSummary): string {
  return [
    `Review PR #${pr.number}, "${pr.title}" (${pr.url}).`,
    pr.headRefName === "" ? null : `Its branch is ${pr.headRefName}${pr.baseRefName === "" ? "" : `, against ${pr.baseRefName}`}.`,
    "Read the whole diff and report findings ranked by severity, each with the file and line and why it matters.",
    "Do not change any code. Say plainly if you found nothing worth fixing.",
  ]
    .filter((line): line is string => line !== null)
    .join(" ");
}

export const MERGE_METHODS = ["merge", "squash", "rebase"] as const;
export type MergeMethod = (typeof MERGE_METHODS)[number];
