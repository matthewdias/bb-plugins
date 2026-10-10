// What Follow Up offers Thread Pages: one read.
//
// Pure, like the other rules modules: no plugin API. Thread Pages (unifedev's
// bb-thread-pages) lets other plugins give its pages capabilities. A
// contributor answers two plugin RPC methods: `threadPagesContributions`, its
// declaration, and `threadPagesInvoke`, one call. Thread Pages runs a
// contributed call with no dialog, from any session's page, which is why
// Follow Up contributes a read and nothing else: nothing here records,
// closes, files or answers anything.
//
// `follow-up.list` gives a session's page that session's own follow-ups. It
// takes no thread to read: the session is whichever Thread Pages says is
// calling, so a page cannot read another thread's list, and the home page,
// which belongs to no session, is refused.
import type { FollowUp } from "./followups.ts";

/** The declaration's own version: moved when a method's shape changes. */
export const THREAD_PAGES_VERSION = "1.0.0";
export const LIST_METHOD = "follow-up.list";

const nullable = (type: string) => ({ type: [type, "null"] });

/**
 * The declaration Thread Pages reads. Its schemas use only the subset Thread
 * Pages compiles (spec 05, Contributed capabilities): a parameter object is
 * closed, and a result is projected onto what is declared here.
 */
export const THREAD_PAGES_DECLARATION = {
  version: THREAD_PAGES_VERSION,
  instruction:
    "A page may call follow-up.list to show this session's open follow-ups. It only reads: follow-ups are recorded and closed with the follow-up tools, not from a page.",
  guide:
    "follow-up.list takes no parameters and returns the calling session's follow-ups: { followUps: [{ id, text, reason, file, detail, createdAt, inProgress }], open, done }. " +
    "followUps holds the open ones, in the order the thread shows them; reason is why the agent did not do it then (out-of-scope, blocked, deferred, risk, cleanup) or null for one a person wrote; inProgress means it was handed to an agent. " +
    "open and done are counts. It fails with reason no_session on the home page, which has no session.",
  methods: [
    {
      name: LIST_METHOD,
      description: "List the calling session's open follow-ups, with how many are open and done.",
      effect: "read",
      params: { type: "object", properties: {}, additionalProperties: false },
      result: {
        type: "object",
        properties: {
          followUps: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                text: { type: "string" },
                reason: nullable("string"),
                file: nullable("string"),
                detail: nullable("string"),
                createdAt: { type: "string" },
                inProgress: { type: "boolean" },
              },
              required: ["id", "text", "reason", "file", "detail", "createdAt", "inProgress"],
            },
          },
          open: { type: "integer" },
          done: { type: "integer" },
        },
        required: ["followUps", "open", "done"],
      },
      reasons: { no_session: {} },
    },
  ],
} as const;

export type PageReply =
  | { ok: true; result: unknown }
  | { ok: false; error: { code: string; message: string; reason?: string } };

/** The session a call says it comes from, or null for the home page or a call that names none. */
export function callingSession(call: unknown): string | null {
  const caller = typeof call === "object" && call !== null ? (call as { caller?: unknown }).caller : null;
  const sessionId = typeof caller === "object" && caller !== null ? (caller as { sessionId?: unknown }).sessionId : null;
  return typeof sessionId === "string" && sessionId !== "" ? sessionId : null;
}

export function calledMethod(call: unknown): string | null {
  const method = typeof call === "object" && call !== null ? (call as { method?: unknown }).method : null;
  return typeof method === "string" ? method : null;
}

/** What `follow-up.list` answers for a session's rows. */
export function listReply(open: readonly FollowUp[], done: number): PageReply {
  return {
    ok: true,
    result: {
      followUps: open.map((row) => ({
        id: row.id,
        text: row.text,
        reason: row.reason,
        file: row.file,
        detail: row.detail,
        createdAt: row.createdAt,
        inProgress: row.sentAt != null,
      })),
      open: open.length,
      done,
    },
  };
}

export const NO_SESSION: PageReply = {
  ok: false,
  error: { code: "unavailable", message: "Follow-ups belong to a session; the home page has none.", reason: "no_session" },
};

export function unknownMethod(method: string | null): PageReply {
  return { ok: false, error: { code: "unknown_method", message: `follow-up has no ${method ?? "such method"}` } };
}
