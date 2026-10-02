// bb-plugin-glance — backend entry.
//
// A remote, read-mostly view of bb for the Glance Mac app: its widgets, menu
// bar and Shortcuts. Everything is served as token-auth HTTP routes, so a
// client holds a credential that opens these routes and nothing else — not the
// owner session, not a machine grant that could open terminals. Rotating the
// token (`bb plugin token glance --rotate`) unpairs every client at once.
//
// The one write is starting a thread, behind a setting that ships off.
import type { BbPluginApi, ExperimentalPluginWebSocket } from "@get-bb/plugin-sdk";
import type { Context } from "hono";
import { z } from "zod";
import { normalizeServer, pairingLink } from "./lib/pair.ts";
import {
  buildFeed,
  isListed,
  mayHaveInteraction,
  threadPath,
  type Feed,
  type PendingInteraction,
  type ThreadRow,
} from "./lib/snapshot.ts";

type Interaction = Awaited<
  ReturnType<BbPluginApi["sdk"]["threads"]["interactions"]["list"]>
>[number];

/** Same wording as bb-plugin-attention, so both surfaces say the same thing. */
function interactionMeta(interaction: Interaction): PendingInteraction {
  const payload = interaction.payload;
  if (payload.kind === "user_question") {
    return { label: "Question for you", detail: payload.questions[0]?.prompt ?? "Answer a question in bb" };
  }
  // Plugin forms carry a "<plugin>/<form>" kind rather than a fixed one.
  if (payload.kind !== "approval") {
    return { label: "Awaiting your input", detail: payload.title };
  }
  const subject = payload.subject;
  if (subject.kind === "plan") {
    return { label: "Plan ready for review", detail: subject.planFilePath ?? "Approve or revise the plan." };
  }
  if (subject.kind === "command") return { label: "Needs approval", detail: subject.command };
  if (subject.kind === "file_change") {
    return { label: "Needs approval", detail: subject.writeScope ?? "Edit files" };
  }
  if (subject.kind === "tool_use") {
    return { label: "Needs approval", detail: subject.presentation.label.pending };
  }
  return { label: "Needs approval", ...(subject.toolName ? { detail: subject.toolName } : {}) };
}

const startThreadBody = z
  .object({
    projectId: z.string().min(1).max(200),
    prompt: z.string().trim().min(1).max(20_000),
  })
  .strict();

const openThreadBody = z.object({ threadId: z.string().min(1).max(200) }).strict();

/** Coalesce bursts of thread changes; a streaming turn emits many. */
const DEBOUNCE_MS = 750;

const usage = [
  "bb glance — pair the Glance Mac app with this bb",
  "",
  "  bb glance pair [--server <url>] [--json]   Print the pairing link",
  "  bb glance status [--json]                  Show settings and the current feed counts",
  "",
  "--server is the base URL the Mac reaches bb through (getbb.app, Tailscale, …).",
  "Without it, the publicBaseUrl setting is used. `bb connect status` shows the getbb.app one.",
].join("\n");

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    allowActions: {
      type: "boolean",
      label: "Let paired apps start threads",
      description:
        "Lets Glance, Siri and Shortcuts start a thread with a prompt in a project you pick. " +
        "Threads start with the project's defaults and never a raised permission mode. " +
        "Off, paired apps can only read.",
      default: false,
    },
    publicBaseUrl: {
      type: "string",
      label: "Address paired apps use",
      description:
        "The base URL `bb glance pair` puts in the pairing link when you don't pass --server, " +
        "such as https://you.getbb.app or a Tailscale address. Leave empty to always pass --server.",
      default: "",
    },
  });

  // ---- Feed cache -------------------------------------------------------
  let cached: Feed | null = null;
  let dirty = true;
  let building: Promise<Feed> | null = null;

  async function rebuild(): Promise<Feed> {
    const [threads, projects, current] = await Promise.all([
      bb.sdk.threads.list({ archived: false, limit: 500 }),
      bb.sdk.projects.list(),
      settings.get(),
    ]);
    const rows = threads as unknown as ThreadRow[];
    const pending = new Map<string, PendingInteraction>();
    await Promise.all(
      rows
        .filter((thread) => isListed(thread) && mayHaveInteraction(thread))
        .map(async (thread) => {
          try {
            const found = (await bb.sdk.threads.interactions.list({ threadId: thread.id })).find(
              (item) => item.status === "pending",
            );
            if (found) pending.set(thread.id, interactionMeta(found));
          } catch (error) {
            bb.log.warn(`interactions lookup failed for ${thread.id}: ${String(error)}`);
          }
        }),
    );
    return buildFeed({
      threads: rows,
      pending,
      projectNames: new Map(projects.map((project) => [project.id, project.name])),
      actionsAllowed: current.allowActions,
      now: Date.now(),
    });
  }

  async function feed(): Promise<Feed> {
    if (!dirty && cached !== null) return cached;
    if (building === null) {
      dirty = false;
      building = rebuild().then(
        (next) => {
          cached = next;
          building = null;
          // A change that landed mid-build is not in `next`; go round again.
          if (dirty) markChanged();
          return next;
        },
        (error) => {
          dirty = true;
          building = null;
          throw error;
        },
      );
    }
    return building;
  }

  // ---- Change fan-out ---------------------------------------------------
  const sockets = new Set<ExperimentalPluginWebSocket>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** What live clients were last told; a GET /feed refreshing the cache must not swallow a change. */
  let announced: string | null = null;

  function markChanged() {
    dirty = true;
    // Nobody listening: stay lazy, and let the next GET /feed rebuild.
    if (sockets.size === 0 || timer !== null) return;
    timer = setTimeout(async () => {
      timer = null;
      try {
        const next = await feed();
        if (next.version !== announced) broadcast(next.version);
      } catch (error) {
        bb.log.warn(`feed rebuild failed: ${String(error)}`);
      }
    }, DEBOUNCE_MS);
  }

  function broadcast(version: string) {
    announced = version;
    const message = JSON.stringify({ type: "changed", version });
    for (const socket of sockets) {
      try {
        socket.send(message);
      } catch {
        sockets.delete(socket);
      }
    }
  }

  settings.onChange(() => markChanged());
  bb.events.on("thread.idle", () => markChanged());
  bb.events.on("thread.failed", () => markChanged());
  bb.events.on("thread.active", () => markChanged());
  bb.events.on("interaction.pending", () => markChanged());

  bb.background.service("feed-watch", {
    async start(signal) {
      // Read state, titles and archiving arrive only as thread:changed.
      const unsubscribe = bb.sdk.subscribe({ event: "thread:changed", callback: () => markChanged() });
      await new Promise<void>((resolve) => {
        const stop = () => {
          unsubscribe();
          resolve();
        };
        if (signal.aborted) return stop();
        signal.addEventListener("abort", stop, { once: true });
      });
    },
  });

  bb.onDispose(() => {
    if (timer !== null) clearTimeout(timer);
    for (const socket of sockets) socket.close(1001, "plugin reloading");
    sockets.clear();
  });

  // ---- Routes -----------------------------------------------------------
  const token = { auth: "token" } as const;

  bb.http.route(
    "GET",
    "/ping",
    (c: Context) => c.json({ ok: true, plugin: bb.pluginId, schema: 1 }),
    token,
  );

  bb.http.route(
    "GET",
    "/feed",
    async (c: Context) => {
      const current = await feed();
      const etag = `"${current.version}"`;
      c.header("ETag", etag);
      c.header("Cache-Control", "no-cache");
      if (c.req.header("if-none-match") === etag) return c.body(null, 304);
      return c.json(current);
    },
    token,
  );

  bb.http.route(
    "GET",
    "/projects",
    async (c: Context) => {
      const projects = await bb.sdk.projects.list();
      return c.json({
        projects: projects
          .map((project) => ({ id: project.id, name: project.name }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      });
    },
    token,
  );

  bb.http.route(
    "POST",
    "/threads",
    async (c: Context) => {
      if (!(await settings.get()).allowActions) {
        return c.json(
          { error: { code: "actions_disabled", message: "Starting threads is off in the Glance plugin's settings." } },
          403,
        );
      }
      const parsed = startThreadBody.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) {
        return c.json({ error: { code: "invalid_body", message: "Expected { projectId, prompt }." } }, 400);
      }
      // No provider, model or permission mode: omitting them is how the
      // project's defaults are asked for, and a remote caller never gets to
      // raise what a thread may do.
      const thread = await bb.sdk.threads.spawn({
        projectId: parsed.data.projectId,
        environment: { type: "project-default" },
        prompt: parsed.data.prompt,
        origin: "plugin",
        originPluginId: bb.pluginId,
      } as Parameters<typeof bb.sdk.threads.spawn>[0]);
      markChanged();
      return c.json({ threadId: thread.id, path: threadPath({ id: thread.id, projectId: parsed.data.projectId }) }, 201);
    },
    token,
  );

  bb.http.route(
    "POST",
    "/open",
    async (c: Context) => {
      const parsed = openThreadBody.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) {
        return c.json({ error: { code: "invalid_body", message: "Expected { threadId }." } }, 400);
      }
      // `delivered` counts the bb windows that navigated. Zero means none is
      // open, and the client falls back to the thread's web address.
      const result = await bb.sdk.threads.open({ threadId: parsed.data.threadId, file: null });
      return c.json({ delivered: result.delivered });
    },
    token,
  );

  bb.http.experimental_websocket(
    "/stream",
    () => ({
      async onOpen(socket) {
        sockets.add(socket);
        try {
          const { version } = await feed();
          announced ??= version;
          socket.send(JSON.stringify({ type: "hello", version }));
        } catch (error) {
          bb.log.warn(`stream hello failed: ${String(error)}`);
        }
      },
      onClose(socket) {
        sockets.delete(socket);
      },
      onError(socket) {
        sockets.delete(socket);
      },
    }),
    token,
  );

  // ---- CLI --------------------------------------------------------------
  bb.cli.register({
    name: "glance",
    summary: "Pair the Glance Mac app with this bb",
    commands: [
      { name: "pair", summary: "Print the pairing link", usage: "bb glance pair [--server <url>] [--json]" },
      { name: "status", summary: "Show settings and feed counts", usage: "bb glance status [--json]" },
    ],
    async run(argv) {
      const json = argv.includes("--json");
      const args = argv.filter((arg) => arg !== "--json");
      const [command] = args;
      const current = await settings.get();

      if (command === "pair") {
        const flag = args.indexOf("--server");
        const raw = flag === -1 ? current.publicBaseUrl : (args[flag + 1] ?? "");
        if (raw.trim() === "") {
          return {
            exitCode: 1,
            stderr:
              "No server address. Pass --server <url> (the address the Mac reaches bb through), " +
              "or set it once: bb plugin config glance set publicBaseUrl <url>.\n" +
              "For getbb.app, `bb connect status` shows yours.",
          };
        }
        const server = normalizeServer(raw);
        if (server === null) {
          return { exitCode: 1, stderr: `Not an http(s) base URL: ${raw}` };
        }
        const { token: secret } = await bb.sdk.plugins.token({ pluginId: bb.pluginId });
        const link = pairingLink(server, secret);
        return {
          exitCode: 0,
          stdout: json
            ? JSON.stringify({ server, link })
            : `${link}\n\nOpen it on the Mac running Glance, or paste the server and token into Glance's settings.\n` +
              "Anyone with this link can read your thread titles" +
              (current.allowActions ? " and start threads" : "") +
              ". Rotate with `bb plugin token glance --rotate`.",
        };
      }

      if (command === "status") {
        const snapshot = await feed();
        const status = {
          allowActions: current.allowActions,
          publicBaseUrl: current.publicBaseUrl || null,
          version: snapshot.version,
          needsMe: snapshot.needsMe.total,
          running: snapshot.running.total,
          streams: sockets.size,
        };
        return {
          exitCode: 0,
          stdout: json
            ? JSON.stringify(status)
            : [
                `Needs you: ${status.needsMe}   Running: ${status.running}   Live clients: ${status.streams}`,
                `Starting threads: ${status.allowActions ? "allowed" : "off"}`,
                `Pairing address: ${status.publicBaseUrl ?? "(none — pass --server to pair)"}`,
              ].join("\n"),
        };
      }

      return { exitCode: command === undefined || command === "help" || command === "--help" ? 0 : 1, stdout: usage };
    },
  });
}
