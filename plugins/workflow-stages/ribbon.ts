// The Ribbon sidebar side of the contract.
//
// Ribbon owns the sidebar UI, thread placement, and manual order; this plugin
// owns the catalog of groups and decides when a thread should move. Ribbon
// discovers any running plugin that answers `getGroupingCatalogV1` (see
// ribbon-sidebar/src/server.ts), so nothing here needs registering with it.
//
// The schemas below mirror Ribbon's own contracts.ts. They are duplicated on
// purpose: they are the wire format, and validating locally means a mistake
// surfaces here instead of as a silently missing grouping.
import { z } from "zod";
import type { BbPluginApi, JsonValue } from "@get-bb/plugin-sdk";
import type { IconDataV1 } from "./icons";
import { SAFE_ATTRIBUTES } from "./icon-data";

export const RIBBON_PLUGIN_ID = "ribbon-sidebar";

/** The one grouping this plugin provides. Ribbon keys it `plugin:<id>:<this>`. */
export const GROUPING_ID = "workflow";

export function groupingKeyFor(pluginId: string): string {
  return `plugin:${pluginId}:${GROUPING_ID}`;
}

/** Ribbon's own id rule: no colons, no slashes, no surrounding whitespace. */
export const localIdSchema = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => value.trim() === value, "IDs cannot have surrounding whitespace.")
  .refine(
    (value) => !value.includes(":") && !value.includes("/"),
    "IDs cannot contain colons or slashes.",
  );

const UNSAFE_ICON_VALUE = /(?:\b(?:data|https?|javascript):|url\s*\()/iu;

/**
 * Ribbon's icon rules, enforced here too. An icon that reaches Ribbon and
 * fails its check takes the whole catalog with it, so a bad one must never
 * leave this plugin — including one an editor sent us.
 */
export const iconDataSchema: z.ZodType<IconDataV1> = z.lazy(() =>
  z
    .object({
      tag: z.enum([
        "svg",
        "g",
        "path",
        "circle",
        "ellipse",
        "rect",
        "line",
        "polyline",
        "polygon",
      ]),
      attrs: z
        .record(z.string(), z.union([z.string(), z.number().finite()]))
        .superRefine((attrs, context) => {
          for (const [name, value] of Object.entries(attrs)) {
            if (!SAFE_ATTRIBUTES.has(name)) {
              context.addIssue({
                code: "custom",
                message: `Unsafe SVG attribute: ${name}`,
                path: [name],
              });
            }
            if (typeof value === "string" && UNSAFE_ICON_VALUE.test(value)) {
              context.addIssue({
                code: "custom",
                message: `SVG attribute ${name} cannot contain a URL.`,
                path: [name],
              });
            }
          }
        }),
      children: z.array(iconDataSchema).max(64).optional(),
    })
    .strict(),
);

const groupSchema = z
  .object({
    id: localIdSchema,
    label: z.string(),
    icon: iconDataSchema.optional(),
    visibleWhenEmpty: z.boolean(),
    acceptsAssignments: z.boolean(),
    defaultCollapsed: z.boolean(),
  })
  .strict();

const groupingSchema = z
  .object({
    id: localIdSchema,
    singularLabel: z.string(),
    pluralLabel: z.string(),
    icon: iconDataSchema.optional(),
    defaultGroupId: localIdSchema,
    groups: z.array(groupSchema).min(1),
  })
  .strict();

/** The output of `getGroupingCatalogV1`; Ribbon re-validates it on arrival. */
export const groupingCatalogSchema = z
  .object({
    protocolVersion: z.literal(1),
    groupings: z.array(groupingSchema).min(1),
  })
  .strict();

export type GroupingCatalogV1 = z.output<typeof groupingCatalogSchema>;

export const placementOriginSchema = z.enum(["ui", "cli", "auto"]);
export type PlacementOrigin = z.output<typeof placementOriginSchema>;

const placementRecordSchema = z
  .object({
    groupingKey: z.string(),
    groupId: localIdSchema,
    threadId: z.string().min(1).max(256),
    enteredAtMs: z.number().int().nonnegative().nullable(),
    previousGroupId: localIdSchema.optional(),
    origin: placementOriginSchema.optional(),
  })
  .strict();

function resultSchema<Value extends z.ZodType>(value: Value) {
  return z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), value }).strict(),
    z
      .object({
        ok: z.literal(false),
        error: z
          .object({
            code: z.string(),
            message: z.string(),
            revision: z.number().int().nonnegative().optional(),
          })
          .strict(),
      })
      .strict(),
  ]);
}

const placementResultSchema = resultSchema(
  z
    .object({
      placement: placementRecordSchema,
      revision: z.number().int().nonnegative(),
    })
    .strict(),
);

const listPlacementsResultSchema = resultSchema(
  z
    .object({
      groupingKey: z.string(),
      revision: z.number().int().nonnegative(),
      items: z.array(placementRecordSchema),
    })
    .strict(),
);

/** Ribbon is optional: every call reports absence instead of throwing. */
export class RibbonUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RibbonUnavailableError";
  }
}

export interface RibbonClient {
  /** Whether Ribbon sidebar is installed and running right now. */
  available(): Promise<boolean>;
  getPlacement(threadId: string): Promise<z.output<typeof placementResultSchema>>;
  listPlacements(input: {
    groupIds?: string[];
    threadIds?: string[];
  }): Promise<z.output<typeof listPlacementsResultSchema>>;
  updatePlacement(input: {
    threadId: string;
    groupId: string;
    origin: PlacementOrigin;
    expectedRevision?: number;
  }): Promise<z.output<typeof placementResultSchema>>;
  /** Tell Ribbon this plugin's catalog changed; it refetches and repaints. */
  invalidateCatalog(): Promise<void>;
}

export function createRibbonClient(bb: BbPluginApi): RibbonClient {
  const groupingKey = groupingKeyFor(bb.pluginId);

  async function call<Output>(
    method: string,
    input: JsonValue,
    outputSchema: z.ZodType<Output>,
  ): Promise<Output> {
    try {
      return await bb.sdk.plugins.callRpc({
        pluginId: RIBBON_PLUGIN_ID,
        method,
        input,
        outputSchema,
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      throw new RibbonUnavailableError(
        `Ribbon sidebar RPC ${method} failed: ${message}. Install and enable Ribbon sidebar, then retry.`,
        { cause },
      );
    }
  }

  return {
    async available() {
      try {
        const { plugins } = await bb.sdk.plugins.list();
        return plugins.some(
          (plugin) => plugin.id === RIBBON_PLUGIN_ID && plugin.status === "running",
        );
      } catch {
        return false;
      }
    },
    getPlacement(threadId) {
      return call("getPlacementV1", { groupingKey, threadId }, placementResultSchema);
    },
    listPlacements({ groupIds, threadIds }) {
      return call(
        "listPlacementsV1",
        {
          groupingKey,
          ...(groupIds === undefined ? {} : { groupIds }),
          ...(threadIds === undefined ? {} : { threadIds }),
        },
        listPlacementsResultSchema,
      );
    },
    async updatePlacement({ threadId, groupId, origin, expectedRevision }) {
      const input = {
        groupingKey,
        groupId,
        threadId,
        origin,
        ...(expectedRevision === undefined ? {} : { expectedRevision }),
      };
      const first = await call("updatePlacementV1", input, placementResultSchema);
      // A user drag that landed between the read and the write is not a
      // conflict worth surfacing for an explicit move; retry once at the
      // revision Ribbon reports. Automatic moves never retry — the user won.
      if (
        origin !== "auto" &&
        !first.ok &&
        first.error.code === "REVISION_CONFLICT" &&
        first.error.revision !== undefined
      ) {
        return call(
          "updatePlacementV1",
          { ...input, expectedRevision: first.error.revision },
          placementResultSchema,
        );
      }
      return first;
    },
    async invalidateCatalog() {
      await call(
        "invalidateGroupingCatalogV1",
        { providerPluginId: bb.pluginId },
        z.null(),
      );
    },
  };
}
