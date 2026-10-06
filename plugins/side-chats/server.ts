// Side Chats — server.
//
// Lists a thread's side chats with what each is doing, archives one (and
// brings it back), and promotes one. Promotion forks a side chat as a visible thread with no lifecycle owner,
// then archives the side chat. Un-hiding the side chat instead would leave it
// owned by the main thread, which bb never lets go of: archive the main thread
// and the "promoted" thread goes with it. A fork carries the side chat's
// conversation in both its timeline and its agent's context, so nothing is
// lost by moving to a new thread.
//
// The header control, the panel (app.tsx) and `bb side-chats` all end
// here.
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
  type Archive,
  type EnvironmentChoice,
  type Promotion,
  type SideChatSummary,
} from "./lib/contract.ts";
import {
  anchorFrom,
  archiveRefusalFor,
  firstUserText,
  isSideChat,
  isTabFor,
  oneLine,
  refusalFor,
  SIDE_CHAT_PLUGIN_ID,
  SIDE_CHATS_CHANGED,
  sideChatState,
  titleFor,
  unarchiveRefusalFor,
  type ThreadFacts,
  type TimelineRowLike,
} from "./lib/promotion.ts";

export { rpcContract };

/** kv key recording which thread a side chat was promoted to. */
const promotedKey = (sideChatId: string) => `promoted:${sideChatId}`;

type Thread = ThreadFacts & {
  environmentId: string | null;
  titleFallback: string | null;
  lastReadAt: number | null;
  latestAttentionAt: number | null;
  updatedAt: number;
};

export default async function plugin(bb: BbPluginApi) {
  const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

  // ------------------------------------------------------------------ reads

  async function getThread(threadId: string): Promise<Thread> {
    return (await bb.sdk.threads.get({ threadId })) as unknown as Thread;
  }

  // A side chat's first message never changes once written, and the header
  // lists side chats often (it rechecks while a reply is unread), so each is
  // read from the timeline once. Bounded: a cache of strings per side chat
  // that has ever been listed since the server started.
  const firstMessages = new Map<string, string>();

  /** The first user message, or null when there is none or it cannot be read. */
  async function firstUserMessage(threadId: string): Promise<string | null> {
    const known = firstMessages.get(threadId);
    if (known !== undefined) return known;
    try {
      const timeline = await bb.sdk.threads.timeline({ threadId, includeNestedRows: "true" });
      const first = firstUserText(timeline.rows as unknown as TimelineRowLike[]);
      if (first !== null) firstMessages.set(threadId, first);
      return first;
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
        return {
          id: row.id,
          preview: oneLine(asked, 80),
          anchor: anchorFrom(row.titleFallback),
          state: sideChatState(row),
          updatedAt: row.updatedAt,
        };
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
   * Close the side chat's panel tabs on the main thread, the side-chat
   * plugin's and this plugin's, and tell the main thread's list. Best-effort:
   * a stale tab only shows an archived side chat.
   */
  async function closeTabs(sideChat: Thread): Promise<void> {
    const mainId = sideChat.sourceThreadId;
    if (mainId !== null) {
      try {
        const current = await bb.sdk.threads.tabs.get({ threadId: mainId });
        const kept = current.tabs.filter((tab) => !isTabFor(tab, sideChat.id, bb.pluginId));
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
  }

  /**
   * After a promotion: archive the side chat and close its tabs. Both are
   * best-effort, because the promoted thread already exists, so a failure here
   * is a warning to report, not a reason to fail the promotion.
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
    await closeTabs(sideChat);
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

  // ---------------------------------------------------------------- archive

  /** Discard a side chat without promoting it. Archiving one mid-reply stops it. */
  async function archive(sideChatId: string): Promise<Archive> {
    const sideChat = await getThread(sideChatId);
    const refusal = archiveRefusalFor(sideChat);
    if (refusal !== null) throw new Error(refusal);
    await bb.sdk.threads.archive({ threadId: sideChatId });
    bb.log.info(`archived side chat ${sideChatId}`);
    await closeTabs(sideChat);
    return { sideChatThreadId: sideChatId };
  }

  /** Undo an archive. Its tabs are not reopened: the panel's Undo does that itself. */
  async function unarchive(sideChatId: string): Promise<Archive> {
    const sideChat = await getThread(sideChatId);
    const promoted = await bb.storage.kv.get<{ threadId: string }>(promotedKey(sideChatId));
    // The main thread only matters for a side chat that could otherwise come back.
    const mainArchived =
      isSideChat(sideChat) && sideChat.archivedAt !== null && sideChat.sourceThreadId !== null
        ? (await getThread(sideChat.sourceThreadId)).archivedAt !== null
        : false;
    const refusal = unarchiveRefusalFor(sideChat, {
      mainArchived,
      promotedTo: promoted?.threadId ?? null,
    });
    if (refusal !== null) throw new Error(refusal);
    await bb.sdk.threads.unarchive({ threadId: sideChatId });
    bb.log.info(`unarchived side chat ${sideChatId}`);
    if (sideChat.sourceThreadId !== null) {
      bb.realtime.publish(SIDE_CHATS_CHANGED, { threadId: sideChat.sourceThreadId });
    }
    return { sideChatThreadId: sideChatId };
  }

  // -------------------------------------------------------------------- rpc

  bb.rpc.register(rpcContract, {
    async listSideChats({ threadId }) {
      return { sideChats: await listSideChats(threadId) };
    },
    async promoteSideChat({ sideChatThreadId, environment, title }) {
      return promote(sideChatThreadId, environment, title);
    },
    async archiveSideChat({ sideChatThreadId }) {
      return archive(sideChatThreadId);
    },
    async unarchiveSideChat({ sideChatThreadId }) {
      return unarchive(sideChatThreadId);
    },
  });

  // ------------------------------------------------------------ live count

  // The header shows a count and what each side chat is doing, so tell it when
  // a thread's side chats change: one is opened, starts or finishes a reply
  // (an empty one is not listed until its first), is archived, including by
  // the cascade when its main thread is archived, or is unarchived. Being read
  // raises no event at all, so the frontend rechecks that itself.
  const changed = ({ thread }: { thread: Thread }) => {
    if (thread.originPluginId !== SIDE_CHAT_PLUGIN_ID || thread.sourceThreadId === null) return;
    bb.realtime.publish(SIDE_CHATS_CHANGED, { threadId: thread.sourceThreadId });
  };
  bb.events.on("thread.created", (event) => changed(event as unknown as { thread: Thread }));
  bb.events.on("thread.active", (event) => changed(event as unknown as { thread: Thread }));
  bb.events.on("thread.idle", (event) => changed(event as unknown as { thread: Thread }));
  bb.events.on("thread.archived", (event) => changed(event as unknown as { thread: Thread }));
  bb.events.on("thread.unarchived", (event) => changed(event as unknown as { thread: Thread }));

  // -------------------------------------------------------------------- cli

  const threadFor = (thread: string | undefined, ctx: PluginCliContext): string => {
    const threadId = thread ?? ctx.threadId;
    if (threadId === undefined) {
      throw new PluginCliError("No thread in context — pass --thread <id>.");
    }
    return threadId;
  };

  const list = cliCommand({
    summary: "List a thread's side chats, newest first, with any reply in progress or unread",
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
      const marker = { working: "[replying] ", unread: "[new reply] ", read: "" } as const;
      return {
        exitCode: 0,
        stdout: sideChats.map((chat) => `${chat.id}  ${marker[chat.state]}${chat.preview}\n`).join(""),
      };
    },
  });

  bb.cli.register(
    defineCli({
      name: "side-chats",
      summary: "List, promote, archive and unarchive a thread's side chats",
      root: list,
      commands: {
        list,
        promote: cliCommand({
          summary: "Fork a side chat into a visible thread and archive the side chat",
          positionals: [
            {
              name: "id",
              required: true,
              description: "The side chat's thread id, as `bb side-chats list` prints it",
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
        archive: cliCommand({
          summary: "Archive a side chat without promoting it; one mid-reply is stopped",
          positionals: [
            {
              name: "id",
              required: true,
              description: "The side chat's thread id, as `bb side-chats list` prints it",
            },
          ],
          options: { json: { type: "boolean", description: "Print the result as JSON" } },
          async run({ options, positionals }) {
            let archived: Archive;
            try {
              archived = await archive(positionals.id);
            } catch (cause) {
              throw new PluginCliError(message(cause));
            }
            if (options.json) return { exitCode: 0, stdout: `${JSON.stringify(archived)}\n` };
            return { exitCode: 0, stdout: `Archived side chat ${positionals.id}\n` };
          },
        }),
        unarchive: cliCommand({
          summary: "Bring back an archived side chat, unless it was promoted or its main thread is archived",
          positionals: [
            {
              name: "id",
              required: true,
              description: "The side chat's thread id, as `bb side-chats archive` was given it",
            },
          ],
          options: { json: { type: "boolean", description: "Print the result as JSON" } },
          async run({ options, positionals }) {
            let restored: Archive;
            try {
              restored = await unarchive(positionals.id);
            } catch (cause) {
              throw new PluginCliError(message(cause));
            }
            if (options.json) return { exitCode: 0, stdout: `${JSON.stringify(restored)}\n` };
            return { exitCode: 0, stdout: `Unarchived side chat ${positionals.id}\n` };
          },
        }),
      },
    }),
  );
}
