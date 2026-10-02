// bb-plugin-glance — backend entry.
//
// A remote, read-mostly view of bb for the Glance Mac app: its widgets, menu
// bar and Shortcuts. Everything is served as token-auth HTTP routes, so a
// client holds a credential that opens these routes and nothing else — not the
// owner session, not a machine grant that could open terminals. Rotating the
// token (`bb plugin token glance --rotate`) unpairs every client at once.
//
// The one write is starting a thread, behind a setting that ships off, in a
// permission mode the setting caps rather than whatever the project defaults to.
//
// Pairing hands a client that token without it ever entering a URL: a link
// carries a one-time code (lib/pairing-codes.ts), and a Glance on this same Mac
// can ask over loopback instead.
import { execFile } from "node:child_process";
import { defineRpcContract, type BbPluginApi, type ExperimentalPluginWebSocket } from "@get-bb/plugin-sdk";
import type { Context } from "hono";
import { z } from "zod";
import { normalizeServer, pairingLink } from "./lib/pair.ts";
import { isDirectLoopback, PairingCodes } from "./lib/pairing-codes.ts";
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

const redeemBody = z.object({ code: z.string().min(1).max(200) }).strict();

/** Weakest first; a Glance-started thread never runs above the chosen one. */
export const PERMISSION_MODES = ["accept-edits", "auto", "full"] as const;
type PermissionMode = (typeof PERMISSION_MODES)[number];

export const rpcContract = defineRpcContract({
  /** The settings page's "Pair Glance" button. */
  glance_pair: {
    input: z.object({}).strict(),
    output: z
      .object({
        link: z.string(),
        server: z.string(),
        expiresAt: z.number(),
        /** Whether this Mac opened the link itself. */
        opened: z.boolean(),
      })
      .strict(),
  },
});

/** Coalesce bursts of thread changes; a streaming turn emits many. */
const DEBOUNCE_MS = 750;

const usage = [
  "bb glance — pair the Glance Mac app with this bb",
  "",
  "  bb glance pair [--server <url>] [--json]   Print a one-time pairing link (two minutes)",
  "  bb glance status [--json]                  Show settings and the current feed counts",
  "",
  "--server is the base URL the Mac reaches bb through. Without it, the publicBaseUrl",
  "setting is used, and without that, this Mac's own bb address.",
].join("\n");

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    allowActions: {
      type: "boolean",
      label: "Let paired apps start threads",
      description:
        "Lets Glance, Siri and Shortcuts start a thread with a prompt in a project you pick, " +
        "using that project's provider and model. Off, paired apps can only read.",
      default: false,
    },
    startPermissionMode: {
      type: "select",
      label: "Permission mode for threads paired apps start",
      description:
        "Always applied, whatever the project's default is: anyone holding the pairing token " +
        "can start these threads. accept-edits asks before running commands; auto and full do not.",
      options: [...PERMISSION_MODES],
      default: "accept-edits",
    },
    publicBaseUrl: {
      type: "string",
      label: "Address paired apps use",
      description:
        "The base URL a pairing link carries, such as a Tailscale address. " +
        "Empty means this Mac's own bb address, which is right when Glance runs on this Mac.",
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

  /** The setting, read defensively: an unknown stored value means the weakest mode. */
  async function startMode(): Promise<PermissionMode> {
    const chosen = (await settings.get()).startPermissionMode;
    return (PERMISSION_MODES as readonly string[]).includes(chosen) ? (chosen as PermissionMode) : "accept-edits";
  }

  // ---- Pairing ----------------------------------------------------------
  const codes = new PairingCodes();

  /** Where a pairing link points: the configured address, else this Mac's bb. */
  async function pairingServer(override?: string): Promise<string | null> {
    const configured = override ?? (await settings.get()).publicBaseUrl;
    return normalizeServer(configured.trim() === "" ? bb.server.loopbackBaseUrl : configured);
  }

  async function mintLink(server: string): Promise<{ link: string; expiresAt: number }> {
    const { code, expiresAt } = codes.mint(Date.now());
    return { link: pairingLink(server, code), expiresAt };
  }

  async function pluginToken(): Promise<string> {
    return (await bb.sdk.plugins.token({ pluginId: bb.pluginId })).token;
  }

  bb.rpc.register(rpcContract, {
    glance_pair: async () => {
      const server = await pairingServer();
      if (server === null) throw new Error("The Glance plugin's pairing address is not an http(s) URL.");
      const { link, expiresAt } = await mintLink(server);
      // The button is pressed in bb's UI, which may be a browser that won't
      // follow a custom scheme. Glance runs on the Mac bb runs on, so open the
      // link here; the UI shows it too in case this Mac has no Glance.
      const opened =
        process.platform === "darwin" &&
        (await new Promise<boolean>((resolve) => execFile("/usr/bin/open", [link], (error) => resolve(error === null))));
      return { link, server, expiresAt, opened };
    },
  });

  // ---- Routes -----------------------------------------------------------
  const token = { auth: "token" } as const;

  // Exchanges a code from a pairing link for the token. Open by necessity —
  // the caller has no token yet — so the code is the credential: 128 random
  // bits, single use, two minutes, and redemption locks after repeated misses.
  bb.http.route(
    "POST",
    "/pair",
    async (c: Context) => {
      const parsed = redeemBody.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) {
        return c.json({ error: { code: "invalid_body", message: "Expected { code }." } }, 400);
      }
      const outcome = codes.redeem(parsed.data.code, Date.now());
      if (outcome === "throttled") {
        return c.json({ error: { code: "throttled", message: "Too many wrong codes. Try again in a minute." } }, 429);
      }
      if (outcome === "invalid") {
        return c.json(
          { error: { code: "invalid_code", message: "That pairing link was already used or has expired. Make a new one." } },
          401,
        );
      }
      return c.json({ token: await pluginToken() });
    },
    { auth: "none" },
  );

  // A Glance on this Mac pairing without a link. "local" admits only requests
  // whose Origin and Host are this bb's own loopback address, with a CORS
  // preflight on every POST: this Mac's processes and bb's UI, never a website
  // or a remote path. That is the reach the bb CLI already has, and the token
  // leaves in a response body, never a URL.
  //
  // One more check than "local" makes: a reverse proxy on this Mac (Tailscale
  // Serve, a tunnel) also looks local, and would hand the token to anyone who
  // can reach the proxy. Proxies announce themselves, so refuse anything that
  // was forwarded or that addressed a name other than loopback.
  bb.http.route(
    "POST",
    "/pair/local",
    async (c: Context) => {
      if (!isDirectLoopback(c.req.header())) {
        return c.json(
          { error: { code: "not_local", message: "Pair through a pairing link when Glance is on another Mac." } },
          403,
        );
      }
      return c.json({ token: await pluginToken() });
    },
    { auth: "local" },
  );

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
      // Provider and model are the project's: omitting them is how its
      // defaults are asked for. The permission mode is not: the project's
      // default may be one that runs commands unattended, and the caller holds
      // nothing stronger than this token. The mode is the setting's, marked
      // explicit, because bb drops an execution field that arrives without
      // its provenance.
      const thread = await bb.sdk.threads.spawn({
        projectId: parsed.data.projectId,
        environment: { type: "project-default" },
        prompt: parsed.data.prompt,
        permissionMode: await startMode(),
        executionInputSources: { permissionMode: "explicit" },
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
      { name: "pair", summary: "Print a one-time pairing link", usage: "bb glance pair [--server <url>] [--json]" },
      { name: "status", summary: "Show settings and feed counts", usage: "bb glance status [--json]" },
    ],
    async run(argv) {
      const json = argv.includes("--json");
      const args = argv.filter((arg) => arg !== "--json");
      const [command] = args;
      const current = await settings.get();

      if (command === "pair") {
        const flag = args.indexOf("--server");
        const raw = flag === -1 ? undefined : (args[flag + 1] ?? "");
        const server = await pairingServer(raw);
        if (server === null) {
          return { exitCode: 1, stderr: `Not an http(s) base URL: ${raw ?? current.publicBaseUrl}` };
        }
        const { link, expiresAt } = await mintLink(server);
        return {
          exitCode: 0,
          stdout: json
            ? JSON.stringify({ server, link, expiresAt })
            : `${link}\n\nOpen it on the Mac running Glance within two minutes. It works once.\n` +
              "Glance's own “Pair with bb on this Mac” button needs no link at all.",
        };
      }

      if (command === "status") {
        const snapshot = await feed();
        const status = {
          allowActions: current.allowActions,
          startPermissionMode: await startMode(),
          pairingAddress: await pairingServer(),
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
                `Starting threads: ${status.allowActions ? `allowed, in ${status.startPermissionMode} mode` : "off"}`,
                `Pairing address: ${status.pairingAddress ?? "(not an http(s) URL — fix publicBaseUrl)"}`,
              ].join("\n"),
        };
      }

      return { exitCode: command === undefined || command === "help" || command === "--help" ? 0 : 1, stdout: usage };
    },
  });
}
