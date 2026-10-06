// Promote Side Chat — server.
//
// Promotion forks a side chat as a visible thread with no lifecycle owner,
// then archives the side chat. Un-hiding the side chat instead would leave it
// owned by the main thread, which bb never lets go of: archive the main thread
// and the "promoted" thread goes with it. A fork carries the side chat's
// conversation in both its timeline and its agent's context, so nothing is
// lost by moving to a new thread.
//
// The header control (app.tsx) and `bb promote-side-chat` both end here.
import {
  cliCommand,
  defineCli,
  PluginCliError,
  type BbPluginApi,
  type PluginCliContext,
} from "@get-bb/plugin-sdk";
import {
  LIST_LIMIT,
  rpcContract,
  type EnvironmentChoice,
  type Promotion,
  type SideChatSummary,
} from "./lib/contract.ts";
import {
  firstUserText,
  isSideChat,
  isTabFor,
  oneLine,
  refusalFor,
  SIDE_CHAT_PLUGIN_ID,
  SIDE_CHATS_CHANGED,
  titleFor,
  type ThreadFacts,
  type TimelineRowLike,
} from "./lib/promotion.ts";

export { rpcContract };

/** kv key recording which thread a side chat was promoted to. */
const promotedKey = (sideChatId: string) => `promoted:${sideChatId}`;

type Thread = ThreadFacts & {
  environmentId: string | null;
  updatedAt: number;
};

export default async function plugin(bb: BbPluginApi) {
  const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

  // ------------------------------------------------------------------ reads

  async function getThread(threadId: string): Promise<Thread> {
    return (await bb.sdk.threads.get({ threadId })) as unknown as Thread;
  }

  /** The first user message, or null when there is none or it cannot be read. */
  async function firstUserMessage(threadId: string): Promise<string | null> {
    try {
      const timeline = await bb.sdk.threads.timeline({ threadId, includeNestedRows: "true" });
      return firstUserText(timeline.rows as unknown as TimelineRowLike[]);
    } catch (cause) {
      bb.log.warn(`timeline read failed for ${threadId}: ${message(cause)}`);
      return null;
    }
  }

  /**
   * A thread's live side chats that have something in them. One opened and
   * never written in is not worth a thread, and the side-chat plugin sweeps
   * those away itself.
   */
  async function listSideChats(threadId: string): Promise<SideChatSummary[]> {
    const rows = (await bb.sdk.threads.list({
      includeHidden: true,
      originKind: "fork",
      originPluginId: SIDE_CHAT_PLUGIN_ID,
      sourceThreadId: threadId,
      archived: false,
      limit: LIST_LIMIT,
    })) as unknown as Thread[];
    const live = rows.filter((row) => isSideChat(row) && row.archivedAt === null);
    const summaries = await Promise.all(
      live.map(async (row) => {
        const asked = await firstUserMessage(row.id);
        if (asked === null) return null;
        return { id: row.id, preview: oneLine(asked, 80), updatedAt: row.updatedAt };
      }),
    );
    return summaries
      .filter((summary): summary is SideChatSummary => summary !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  // -------------------------------------------------------------- promotion

  /** Where the promoted thread runs: beside the main thread, or a new worktree on its host. */
  async function environmentFor(sideChat: Thread, choice: EnvironmentChoice) {
    if (choice === "shared") {
      return sideChat.environmentId === null
        ? undefined
        : ({ type: "reuse", environmentId: sideChat.environmentId } as const);
    }
    let hostId: string | undefined;
    if (sideChat.environmentId !== null) {
      try {
        hostId = (await bb.sdk.environments.get({ environmentId: sideChat.environmentId })).hostId;
      } catch (cause) {
        bb.log.warn(`environment read failed, using the default host: ${message(cause)}`);
      }
    }
    return {
      type: "host",
      ...(hostId === undefined ? {} : { hostId }),
      workspace: { type: "managed-worktree", baseBranch: { kind: "default" } },
    } as const;
  }

  /**
   * Archive the side chat and close its panel tab on the main thread. Both are
   * best-effort: the promoted thread already exists, so a failure here is a
   * warning to report, not a reason to fail the promotion.
   */
  async function retire(sideChat: Thread): Promise<string[]> {
    const warnings: string[] = [];
    if (sideChat.archivedAt === null) {
      try {
        await bb.sdk.threads.archive({ threadId: sideChat.id });
      } catch (cause) {
        warnings.push(`The side chat was not archived: ${message(cause)}`);
      }
    }
    const mainId = sideChat.sourceThreadId;
    if (mainId !== null) {
      try {
        const current = await bb.sdk.threads.tabs.get({ threadId: mainId });
        const kept = current.tabs.filter((tab) => !isTabFor(tab, sideChat.id));
        if (kept.length !== current.tabs.length) {
          await bb.sdk.threads.tabs.update({
            threadId: mainId,
            expectedRevision: current.revision,
            tabs: kept,
          });
        }
      } catch (cause) {
        // A revision conflict means someone moved tabs meanwhile; the stale
        // tab only shows an archived side chat, so it is not worth a retry.
        bb.log.warn(`side-chat tab not closed on ${mainId}: ${message(cause)}`);
      }
      bb.realtime.publish(SIDE_CHATS_CHANGED, { threadId: mainId });
    }
    return warnings;
  }

  async function promoteOnce(
    sideChatId: string,
    choice: EnvironmentChoice,
    requestedTitle: string | undefined,
  ): Promise<Promotion> {
    // A side chat promoted before returns the same thread: a retry or a second
    // click must never fork twice. Retiring again finishes what a failed
    // archive left behind.
    const previous = await bb.storage.kv.get<{ threadId: string; title: string }>(promotedKey(sideChatId));
    if (previous !== undefined) {
      const sideChat = await getThread(sideChatId);
      const warnings = await retire(sideChat);
      return { threadId: previous.threadId, title: previous.title, alreadyPromoted: true, warnings };
    }

    const sideChat = await getThread(sideChatId);
    const asked = isSideChat(sideChat) ? await firstUserMessage(sideChatId) : null;
    const refusal = refusalFor(sideChat, asked !== null);
    if (refusal !== null || asked === null) throw new Error(refusal ?? `${sideChatId} has no messages yet.`);

    const title = requestedTitle ?? titleFor(asked);
    const environment = await environmentFor(sideChat, choice);
    const promoted = await bb.sdk.threads.fork({
      sourceThreadId: sideChatId,
      origin: "plugin",
      originPluginId: bb.pluginId,
      visibility: "visible",
      title,
      ...(environment === undefined ? {} : { environment }),
      // The way back. Plugin metadata, not a parent link: a child would report
      // its every turn to the main thread's agent.
      pluginMetadata: { promotedFrom: sideChatId, mainThreadId: sideChat.sourceThreadId },
    });
    // Recorded before anything else can fail, so a retry finds it.
    await bb.storage.kv.set(promotedKey(sideChatId), { threadId: promoted.id, title });
    bb.log.info(`promoted side chat ${sideChatId} to ${promoted.id}`);
    const warnings = await retire(sideChat);
    return { threadId: promoted.id, title, alreadyPromoted: false, warnings };
  }

  // Two clicks in flight would both pass the kv check before either wrote it.
  const inFlight = new Map<string, Promise<Promotion>>();
  function promote(sideChatId: string, choice: EnvironmentChoice, title?: string): Promise<Promotion> {
    const running = inFlight.get(sideChatId);
    if (running !== undefined) return running;
    const work = promoteOnce(sideChatId, choice, title).finally(() => inFlight.delete(sideChatId));
    inFlight.set(sideChatId, work);
    return work;
  }

  // -------------------------------------------------------------------- rpc

  bb.rpc.register(rpcContract, {
    async listSideChats({ threadId }) {
      return { sideChats: await listSideChats(threadId) };
    },
    async promoteSideChat({ sideChatThreadId, environment, title }) {
      return promote(sideChatThreadId, environment, title);
    },
  });

  // ------------------------------------------------------------ live count

  // The header shows a count, so tell it when a thread's side chats change:
  // one is opened, written in (an empty one is not listed), or archived,
  // including by the cascade when its main thread is archived.
  const changed = ({ thread }: { thread: Thread }) => {
    if (thread.originPluginId !== SIDE_CHAT_PLUGIN_ID || thread.sourceThreadId === null) return;
    bb.realtime.publish(SIDE_CHATS_CHANGED, { threadId: thread.sourceThreadId });
  };
  bb.events.on("thread.created", (event) => changed(event as unknown as { thread: Thread }));
  bb.events.on("thread.idle", (event) => changed(event as unknown as { thread: Thread }));
  bb.events.on("thread.archived", (event) => changed(event as unknown as { thread: Thread }));

  // -------------------------------------------------------------------- cli

  const threadFor = (thread: string | undefined, ctx: PluginCliContext): string => {
    const threadId = thread ?? ctx.threadId;
    if (threadId === undefined) {
      throw new PluginCliError("No thread in context — pass --thread <id>.");
    }
    return threadId;
  };

  const list = cliCommand({
    summary: "List a thread's side chats that can be promoted",
    options: {
      thread: {
        type: "string",
        placeholder: "id",
        description: "The main thread; defaults to the thread this runs in",
      },
      json: { type: "boolean", description: "Print the result as JSON" },
    },
    async run({ options }, ctx) {
      const sideChats = await listSideChats(threadFor(options.thread, ctx));
      if (options.json) return { exitCode: 0, stdout: `${JSON.stringify({ sideChats })}\n` };
      if (sideChats.length === 0) return { exitCode: 0, stdout: "No side chats to promote.\n" };
      return {
        exitCode: 0,
        stdout: sideChats.map((chat) => `${chat.id}  ${chat.preview}\n`).join(""),
      };
    },
  });

  bb.cli.register(
    defineCli({
      name: "promote-side-chat",
      summary: "Turn a side chat into an ordinary thread of its own",
      root: list,
      commands: {
        list,
        promote: cliCommand({
          summary: "Fork a side chat into a visible thread and archive the side chat",
          positionals: [
            {
              name: "id",
              required: true,
              description: "The side chat's thread id, as `bb promote-side-chat list` prints it",
            },
          ],
          options: {
            worktree: {
              type: "boolean",
              description: "Run the new thread in a new worktree instead of the main thread's environment",
            },
            title: { type: "string", description: "Title for the new thread" },
            json: { type: "boolean", description: "Print the result as JSON" },
          },
          async run({ options, positionals }) {
            let promoted: Promotion;
            try {
              promoted = await promote(
                positionals.id,
                options.worktree ? "worktree" : "shared",
                options.title?.trim() || undefined,
              );
            } catch (cause) {
              throw new PluginCliError(message(cause));
            }
            if (options.json) return { exitCode: 0, stdout: `${JSON.stringify(promoted)}\n` };
            const verb = promoted.alreadyPromoted ? "Already promoted" : "Promoted";
            const lines = [`${verb} ${positionals.id} to ${promoted.threadId}: ${promoted.title}`];
            for (const warning of promoted.warnings) lines.push(`Warning: ${warning}`);
            return { exitCode: 0, stdout: `${lines.join("\n")}\n` };
          },
        }),
      },
    }),
  );
}
