// Thread Badges — a backend that exists only to hold settings.
//
// Everything visible happens in the app: an overlay finds the sidebar's thread
// rows and portals badges into them. The switches are derived from the badge
// catalog rather than written out here, so a new badge type contributes its
// settings by existing.
import type { BbPluginApi, PluginSettingDescriptors } from "@get-bb/plugin-sdk";
import {
  BADGE_TYPES,
  DEFAULT_MAX_BADGES,
  MAX_BADGES_KEY,
  MAX_BADGES_LIMIT,
  defaultPriority,
  enabledKey,
  priorityKey,
} from "./badges/catalog";

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
  bb.log.info(`loaded with ${BADGE_TYPES.length} badge type(s)`);
}
