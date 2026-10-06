// Thread Badges — a backend that holds settings.
//
// Everything visible happens in the app: an overlay finds the sidebar's thread
// rows and portals badges into them. Two kinds of setting live here.
//
// The built-in badges' switches are bb settings, derived from the badge
// catalog, so a new built-in type contributes its settings by existing.
//
// A complication from another plugin cannot be a bb setting: settings are
// declared when this backend loads, and providers are discovered later, in the
// app. Their settings live in this plugin's own storage instead, read and
// written through the two methods below, and every write tells every window.
import { defineRpcContract, type BbPluginApi, type PluginSettingDescriptors } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  BADGE_TYPES,
  DEFAULT_MAX_BADGES,
  MAX_BADGES_KEY,
  MAX_BADGES_LIMIT,
  defaultPriority,
  enabledKey,
  priorityKey,
} from "./badges/catalog";
import {
  COMPLICATION_ID,
  MAX_STORED_PREFS,
  PREFS_CHANGED,
  normalizePrefsMap,
  prefsFor,
} from "./badges/complication-prefs";

/** The storage key for every complication's settings, one map. */
const PREFS_KEY = "complication-prefs";

const prefsSchema = z
  .object({
    enabled: z.boolean(),
    priority: z.number(),
    showText: z.boolean(),
    hideWhenComplete: z.boolean(),
  })
  .strict();

const prefsMapSchema = z.object({ prefs: z.record(z.string(), prefsSchema) }).strict();

export const rpcContract = defineRpcContract({
  /** Every stored complication's settings. Ones never touched are absent. */
  complicationPrefs_list: {
    input: z.object({}).strict(),
    output: prefsMapSchema,
  },
  /** Change some of one complication's settings; the rest keep their values. */
  complicationPrefs_set: {
    input: z
      .object({
        id: z.string().regex(COMPLICATION_ID),
        prefs: prefsSchema.partial(),
      })
      .strict(),
    output: prefsMapSchema,
  },
});

export default function plugin(bb: BbPluginApi) {
  const descriptors: PluginSettingDescriptors = {
    [MAX_BADGES_KEY]: {
      type: "number",
      label: "Badges per row",
      description:
        `How many badges one sidebar row may draw, 1 to ${MAX_BADGES_LIMIT}. ` +
        "When more have something to show, the ones with the lowest priority " +
        "number win the slots and the rest are dropped for that row.",
      default: DEFAULT_MAX_BADGES,
    },
  };
  for (const badge of BADGE_TYPES) {
    descriptors[enabledKey(badge.id)] = {
      type: "boolean",
      label: `Show ${badge.name}`,
      description: badge.description,
      default: badge.defaultEnabled,
    };
    descriptors[priorityKey(badge.id)] = {
      type: "number",
      label: `Priority: ${badge.name}`,
      description: "Lower goes first when there is not room for every badge.",
      default: defaultPriority(badge.id),
    };
    for (const setting of badge.settings) {
      descriptors[setting.key] = {
        type: "boolean",
        label: setting.label,
        default: setting.default,
      };
    }
  }
  bb.settings.define(descriptors);

  const readPrefs = async () => normalizePrefsMap(await bb.storage.kv.get<unknown>(PREFS_KEY));

  bb.rpc.register(rpcContract, {
    complicationPrefs_list: async () => ({ prefs: await readPrefs() }),
    complicationPrefs_set: async ({ id, prefs: patch }) => {
      const prefs = await readPrefs();
      if (!Object.prototype.hasOwnProperty.call(prefs, id) && Object.keys(prefs).length >= MAX_STORED_PREFS) {
        throw new Error(`Settings are already stored for ${MAX_STORED_PREFS} complications.`);
      }
      prefs[id] = { ...prefsFor(prefs, id), ...patch };
      await bb.storage.kv.set(PREFS_KEY, prefs);
      // Every window draws from these, and a window hears only this plugin's
      // own signals — which this is.
      bb.realtime.publish(PREFS_CHANGED, { id });
      return { prefs };
    },
  });

  bb.log.info(`loaded with ${BADGE_TYPES.length} built-in badge type(s)`);
}
