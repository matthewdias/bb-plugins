// Thread Badges — a backend that exists only to hold settings.
//
// Everything visible happens in the app: an overlay finds the sidebar's thread
// rows and portals badges into them. The switches are derived from the badge
// catalog rather than written out here, so a new badge type contributes its
// settings by existing.
import type { BbPluginApi, PluginSettingDescriptors } from "@get-bb/plugin-sdk";
import { BADGE_TYPES, enabledKey } from "./badges/catalog";

export default function plugin(bb: BbPluginApi) {
  const descriptors: PluginSettingDescriptors = {};
  for (const badge of BADGE_TYPES) {
    descriptors[enabledKey(badge.id)] = {
      type: "boolean",
      label: `Show ${badge.name}`,
      description: badge.description,
      default: badge.defaultEnabled,
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
