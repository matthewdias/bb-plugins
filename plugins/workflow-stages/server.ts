// Workflow stages — a grouping provider for Ribbon sidebar.
//
// Ribbon owns the sidebar: rendering, drag-and-drop, manual order, and the
// stored placement of every root thread. This plugin owns the catalog of
// stages (their names, order, icons and descriptions), decides when a thread
// should move on its own, and tells agents how to move themselves.
//
// The whole integration is one RPC method Ribbon probes for on every running
// plugin — `getGroupingCatalogV1` — plus the placement calls in ribbon.ts.
// Nothing has to be registered with Ribbon, and nothing here replaces bb's
// sidebar.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { GLYPHS, GLYPH_NAMES, GROUPING_GLYPH } from "./icons";
import {
  configSchema,
  createStageStore,
  MIGRATIONS,
  stageSchema,
  type Stage,
  type StageStore,
} from "./stages";
import {
  createRibbonClient,
  groupingCatalogSchema,
  iconDataSchema,
  GROUPING_ID,
  groupingKeyFor,
  type GroupingCatalogV1,
} from "./ribbon";

/** Realtime channel the settings editor refetches on. */
const CHANGED = "workflow-changed";

const stateSchema = z
  .object({
    stages: z.array(stageSchema),
    config: configSchema,
    glyphs: z.array(z.string()),
    groupingKey: z.string(),
    ribbonAvailable: z.boolean(),
  })
  .strict();

export const rpcContract = defineRpcContract({
  // Ribbon calls this one. Everything below serves the settings editor.
  getGroupingCatalogV1: { input: z.null(), output: groupingCatalogSchema },
  workflow_state: { input: z.null(), output: stateSchema },
  stage_add: {
    input: z.object({ label: z.string().trim().min(1).max(64) }).strict(),
    output: stageSchema,
  },
  stage_update: {
    input: z
      .object({
        id: z.string().min(1),
        label: z.string().trim().min(1).max(64).optional(),
        description: z.string().max(600).optional(),
        glyph: z.string().optional(),
        iconName: z.string().max(64).optional(),
        icon: iconDataSchema.nullable().optional(),
        sticky: z.boolean().optional(),
        visibleWhenEmpty: z.boolean().optional(),
        defaultCollapsed: z.boolean().optional(),
      })
      .strict(),
    output: stageSchema,
  },
  stage_remove: {
    input: z.object({ id: z.string().min(1) }).strict(),
    output: z.object({ removed: z.boolean(), reassigned: z.number() }).strict(),
  },
  stage_move: {
    input: z
      .object({ id: z.string().min(1), direction: z.enum(["up", "down"]) })
      .strict(),
    output: z.object({ stages: z.array(stageSchema) }).strict(),
  },
  workflow_configure: {
    input: configSchema.partial().strict(),
    output: configSchema,
  },
});

export default async function plugin(bb: BbPluginApi) {
  const database = bb.storage.database();
  bb.storage.migrate(database, MIGRATIONS);
  const store: StageStore = createStageStore(database);
  const ribbon = createRibbonClient(bb);
  const groupingKey = groupingKeyFor(bb.pluginId);

  const settings = bb.settings.define({
    automation: {
      type: "boolean",
      label: "Move threads automatically",
      default: true,
    },
    agentInstructions: {
      type: "boolean",
      label: "Tell agents the workflow",
      default: true,
    },
  });

  // ---------------------------------------------------------------- catalog

  function catalog(): GroupingCatalogV1 {
    const stages = store.list();
    const config = store.config();
    return {
      protocolVersion: 1,
      groupings: [
        {
          id: GROUPING_ID,
          singularLabel: "Workflow stage",
          // Ribbon's grouping picker shows this. "Workflow" rather than
          // "Stages" so it reads apart from the Thread stages plugin when
          // both are installed.
          pluralLabel: "Workflow",
          icon: GROUPING_GLYPH,
          defaultGroupId: config.defaultStageId,
          groups: stages.map((stage) => ({
            id: stage.id,
            label: stage.label,
            icon:
              stage.icon ?? GLYPHS[stage.glyph as keyof typeof GLYPHS] ?? GLYPHS.circle,
            visibleWhenEmpty: stage.visibleWhenEmpty,
            acceptsAssignments: true,
            defaultCollapsed: stage.defaultCollapsed,
          })),
        },
      ],
    };
  }

  /** Every write ends here: repaint Ribbon, refresh the editor and agents. */
  async function published(): Promise<void> {
    instructions = renderInstructions(store.list(), store.config());
    bb.realtime.publish(CHANGED, { at: Date.now() });
    try {
      await ribbon.invalidateCatalog();
    } catch (cause) {
      // Ribbon is optional. The catalog is served on demand, so a missed
      // invalidation only delays a repaint until its next reconciliation.
      bb.log.debug(
        `catalog invalidation skipped: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }

  // ----------------------------------------------------------- instructions

  let instructions = renderInstructions(store.list(), store.config());

  function renderInstructions(stages: Stage[], config: ReturnType<StageStore["config"]>): string {
    const lines = [
      "# Workflow stages",
      "",
      "This thread's root thread sits in exactly one stage of the user's sidebar workflow.",
      "",
      "Rule 1 — file it before you start. Before your first substantive action in this",
      "thread, move it to the stage that describes the work you are about to do. This",
      "move is predictive and required: you have seen no transition yet, and an unfiled",
      "thread reads in the sidebar as work nobody has picked up. If no stage describes",
      "what you are about to do, leave it in the default stage.",
      "",
      "Rule 2 — after that, move only on evidence. Move when the work has clearly",
      "reached another stage, at the transition rather than when you plan one. When the",
      "evidence is thin, leave it where it is: from here a wrong move costs the user",
      "more than a stale one.",
      "",
      "Stages, in order:",
    ];
    for (const stage of stages) {
      const marks = [
        stage.id === config.defaultStageId ? "default" : null,
        stage.sticky ? "user-only" : null,
      ].filter((mark) => mark !== null);
      const suffix = marks.length === 0 ? "" : ` (${marks.join(", ")})`;
      lines.push(`- ${stage.id} — ${stage.label}${suffix}: ${stage.description || "No rule set."}`);
    }
    lines.push(
      "",
      "A stage marked user-only is the user's call: never file into or out of one —",
      "`bb stages set` refuses it. Say why the thread belongs there and let them move it.",
      "",
      "Read the current stage with `bb stages show`, and move with `bb stages set <stage-id>`.",
      "Both act on this thread's root, so running them from a child thread is correct.",
    );
    return lines.join("\n").slice(0, 4000);
  }

  bb.agents.contributeInstructions(() => (instructionsEnabled ? instructions : null));

  let { automation: automationEnabled, agentInstructions: instructionsEnabled } =
    await settings.get();
  settings.onChange((next) => {
    automationEnabled = next.automation;
    instructionsEnabled = next.agentInstructions;
  });

  // ------------------------------------------------------------- placement

  async function rootThreadId(threadId: string): Promise<string> {
    let current = threadId;
    for (let depth = 0; depth < 16; depth += 1) {
      const thread = await bb.sdk.threads.get({ threadId: current });
      const parent: string | null = thread.parentThreadId ?? null;
      if (parent === null) return current;
      current = parent;
    }
    return current;
  }

  async function currentStageId(threadId: string): Promise<string | null> {
    const placement = await ribbon.getPlacement(threadId);
    return placement.ok ? placement.value.placement.groupId : null;
  }

  /**
   * Move a root thread, refusing every move the user owns: into or out of a
   * sticky stage, and (for automation) out of a stage the rules do not name.
   */
  async function move(
    threadId: string,
    stageId: string,
    origin: "cli" | "auto",
    options: { onlyFrom?: string[] } = {},
  ): Promise<{ ok: true; stage: Stage } | { ok: false; reason: string }> {
    const stage = store.get(stageId);
    if (stage === null) return { ok: false, reason: `No stage with id ${stageId}.` };
    if (origin === "auto" && stage.sticky) {
      return { ok: false, reason: `${stage.label} is set by the user only.` };
    }
    const root = await rootThreadId(threadId);
    const current = await currentStageId(root);
    if (current === stageId) return { ok: true, stage };
    if (current !== null && origin === "auto") {
      const from = store.get(current);
      if (from?.sticky === true) {
        return { ok: false, reason: `${from.label} is set by the user only.` };
      }
      if (options.onlyFrom !== undefined && !options.onlyFrom.includes(current)) {
        return { ok: false, reason: "Not an automatic transition from here." };
      }
    }
    const result = await ribbon.updatePlacement({
      threadId: root,
      groupId: stageId,
      origin,
    });
    if (!result.ok) return { ok: false, reason: `${result.error.code}: ${result.error.message}` };
    return { ok: true, stage };
  }

  async function automaticMove(
    threadId: string,
    stageId: string | null,
    options: { onlyFrom?: string[] } = {},
  ): Promise<void> {
    if (!automationEnabled || stageId === null) return;
    try {
      const result = await move(threadId, stageId, "auto", options);
      if (!result.ok) bb.log.debug(`no automatic move: ${result.reason}`);
    } catch (cause) {
      bb.log.debug(
        `automatic move failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }

  bb.events.on("thread.active", ({ thread }) => {
    void automaticMove(thread.id, store.config().activeStageId);
  });
  bb.events.on("thread.idle", ({ thread }) => {
    const config = store.config();
    // Only undo this plugin's own Active move; a thread a user filed while it
    // was running stays filed.
    void automaticMove(thread.id, config.idleStageId, {
      onlyFrom: config.activeStageId === null ? [] : [config.activeStageId],
    });
  });
  bb.events.on("interaction.pending", ({ thread }) => {
    void automaticMove(thread.id, store.config().attentionStageId);
  });
  bb.events.on("thread.failed", ({ thread }) => {
    void automaticMove(thread.id, store.config().attentionStageId);
  });

  // -------------------------------------------------------------------- rpc

  async function state(): Promise<z.output<typeof stateSchema>> {
    return {
      stages: store.list(),
      config: store.config(),
      glyphs: [...GLYPH_NAMES],
      groupingKey,
      ribbonAvailable: await ribbon.available(),
    };
  }

  bb.rpc.register(rpcContract, {
    getGroupingCatalogV1: () => catalog(),
    workflow_state: () => state(),
    async stage_add({ label }) {
      const stage = store.add(label);
      await published();
      return stage;
    },
    async stage_update(patch) {
      const stage = store.update(patch);
      await published();
      return stage;
    },
    async stage_remove({ id }) {
      // Ribbon keeps placement keyed by group id, so empty the stage before
      // it stops existing. Threads left behind would be stranded on an id no
      // catalog names.
      const fallback = store.config().defaultStageId;
      let reassigned = 0;
      try {
        const placements = await ribbon.listPlacements({ groupIds: [id] });
        if (placements.ok) {
          for (const item of placements.value.items) {
            const moved = await ribbon.updatePlacement({
              threadId: item.threadId,
              groupId: fallback,
              origin: "auto",
            });
            if (moved.ok) reassigned += 1;
          }
        }
      } catch (cause) {
        bb.log.warn(
          `could not empty ${id} before deleting it: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }
      const removed = store.remove(id);
      await published();
      return { removed, reassigned };
    },
    async stage_move({ id, direction }) {
      const stages = store.move(id, direction);
      await published();
      return { stages };
    },
    async workflow_configure(patch) {
      const config = store.setConfig(patch);
      await published();
      return config;
    },
  });

  // -------------------------------------------------------------------- cli

  const usage = [
    "Usage:",
    "  bb stages list [--json]",
    "  bb stages show [--thread <thread-id>] [--json]",
    "  bb stages set <stage-id> [--thread <thread-id>] [--json]",
    "",
    "Stages act on a thread's root thread, which is what the sidebar files.",
  ].join("\n");

  function formatStage(stage: Stage, config: ReturnType<StageStore["config"]>): string {
    const marks = [
      stage.id === config.defaultStageId ? "default" : null,
      stage.sticky ? "user-only" : null,
    ].filter((mark) => mark !== null);
    const suffix = marks.length === 0 ? "" : `  [${marks.join(", ")}]`;
    return `${stage.id.padEnd(16)}${stage.label}${suffix}`;
  }

  bb.cli.register({
    name: "stages",
    summary: "Read and set the workflow stage of a thread in the Ribbon sidebar",
    commands: [
      { name: "list", summary: "List the workflow stages", usage: "bb stages list [--json]" },
      {
        name: "show",
        summary: "Show a thread's current stage",
        usage: "bb stages show [--thread <thread-id>] [--json]",
      },
      {
        name: "set",
        summary: "Move a thread to a stage",
        usage: "bb stages set <stage-id> [--thread <thread-id>]",
      },
    ],
    async run(argv, ctx) {
      const json = argv.includes("--json");
      const rest = argv.filter((arg) => arg !== "--json");
      const threadFlag = rest.indexOf("--thread");
      const explicitThread = threadFlag === -1 ? undefined : rest[threadFlag + 1];
      const args = threadFlag === -1 ? rest : [...rest.slice(0, threadFlag), ...rest.slice(threadFlag + 2)];
      const [command, ...operands] = args;
      const threadId = explicitThread ?? ctx.threadId;
      const config = store.config();

      switch (command) {
        case undefined:
        case "help":
        case "--help":
          return { exitCode: 0, stdout: usage };
        case "list": {
          const stages = store.list();
          return {
            exitCode: 0,
            stdout: json
              ? JSON.stringify({ stages, config })
              : stages.map((stage) => formatStage(stage, config)).join("\n"),
          };
        }
        case "show": {
          if (threadId === undefined) {
            return { exitCode: 1, stderr: "No thread. Run this inside a thread or pass --thread." };
          }
          const root = await rootThreadId(threadId);
          const stageId = await currentStageId(root);
          const stage = stageId === null ? null : store.get(stageId);
          return {
            exitCode: 0,
            stdout: json
              ? JSON.stringify({ threadId: root, stage })
              : stage === null
                ? "No stage. Is Ribbon sidebar installed and running?"
                : `${stage.id}  ${stage.label}`,
          };
        }
        case "set": {
          const stageId = operands[0];
          if (stageId === undefined) return { exitCode: 1, stderr: usage };
          if (threadId === undefined) {
            return { exitCode: 1, stderr: "No thread. Run this inside a thread or pass --thread." };
          }
          const stage = store.get(stageId);
          if (stage === null) {
            return {
              exitCode: 1,
              stderr: `No stage with id ${stageId}. Run "bb stages list" to see them.`,
            };
          }
          if (stage.sticky) {
            return {
              exitCode: 1,
              stderr: `${stage.label} is set by the user only. Say why the thread belongs there and let them file it.`,
            };
          }
          const result = await move(threadId, stageId, "cli");
          if (!result.ok) return { exitCode: 1, stderr: result.reason };
          return {
            exitCode: 0,
            stdout: json
              ? JSON.stringify({ stage: result.stage })
              : `Moved to ${result.stage.label}.`,
          };
        }
        default:
          return { exitCode: 1, stderr: usage };
      }
    },
  });

  // Ribbon caches provider catalogs, so announce this one once the server is
  // listening (bb.sdk is bind-gated and unusable inside the factory).
  bb.background.service("announce-catalog", {
    async start(signal) {
    for (let attempt = 0; attempt < 5 && !signal.aborted; attempt += 1) {
      try {
        if (await ribbon.available()) {
          await ribbon.invalidateCatalog();
          bb.log.info(`workflow grouping announced as ${groupingKey}`);
          break;
        }
      } catch (cause) {
        bb.log.debug(
          `announce attempt ${attempt + 1} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
      // A service that resolves reads as "stopped" in `bb plugin list`. The
      // announcement is one shot, so park until the plugin unloads.
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener("abort", () => resolve(), { once: true });
      });
    },
  });
}
