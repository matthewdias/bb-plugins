// What the strip treats as a destination: bb's own nav items, plus Settings.
import {
  experimental_SidebarNavigationIcon as NavigationIcon,
  type ExperimentalSidebarNavigationItem as NavItem,
} from "@get-bb/plugin-sdk/app";
import { SETTINGS, isDestinationAction } from "../lib/tabs-model.ts";
import { GearGlyph } from "./glyphs.tsx";

/**
 * bb's Settings, in the shape of a nav item so every part of the strip can
 * treat it like one. bb has no nav item for Settings, so this one is the
 * strip's own: its action kind (`open-settings`) is one bb never sends,
 * which keeps the strip from ever handing it to bb's navigation actions —
 * it is reached by path instead (see `defaultPathFor`). The casts are for
 * the action and icon unions, which list only what bb itself provides.
 */
export const SETTINGS_ITEM: NavItem = {
  id: SETTINGS,
  label: "Settings",
  icon: { kind: "plugin", pluginId: "top-tabs", icon: null },
  action: { kind: "open-settings" } as unknown as NavItem["action"],
  isDisabled: false,
  // Not one of the sidebar's items, so the first-run seed leaves it out.
  isVisible: false,
  isLoading: false,
  pluginId: null,
  shortcut: null,
  experimental_Accessory: null,
};

/** The destinations bb offers, then Settings. */
export function destinationsOf(items: readonly NavItem[]): NavItem[] {
  return [...items.filter((item) => isDestinationAction(item.action.kind)), SETTINGS_ITEM];
}

/** A destination's icon: bb's artwork for its own items, a gear for Settings. */
export function TabIcon({ item }: { item: NavItem }) {
  if (item.id === SETTINGS) return <GearGlyph />;
  return <NavigationIcon icon={item.icon} />;
}
