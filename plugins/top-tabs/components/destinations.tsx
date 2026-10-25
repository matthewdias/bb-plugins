// What the strip treats as a destination: bb's own nav items, plus Settings.
import {
  experimental_SidebarNavigationIcon as NavigationIcon,
  type ExperimentalBadge,
} from "@get-bb/plugin-sdk/app";
import { badgeMark } from "../lib/badge.ts";
import type { NavItem } from "../lib/navigation-bridge.ts";
import { SETTINGS, isDestinationAction } from "../lib/tabs-model.ts";
import { GearGlyph } from "./glyphs.tsx";

/**
 * bb's Settings, in the shape of a nav item so every part of the strip can
 * treat it like one. bb has no nav item for Settings, so this one is the
 * strip's own: its action kind (`open-settings`) is one bb never sends,
 * which keeps the strip from ever handing it to bb's navigation actions —
 * it is reached by path instead (see `defaultPathFor`).
 */
export const SETTINGS_ITEM: NavItem = {
  id: SETTINGS,
  label: "Settings",
  icon: { kind: "plugin", pluginId: "top-tabs", icon: null },
  action: { kind: "open-settings" },
  isDisabled: false,
  // Not one of the sidebar's items, so the first-run seed leaves it out.
  isVisible: false,
  isLoading: false,
  pluginId: null,
  shortcut: null,
  badge: null,
};

/** The destinations bb offers, then Settings. */
export function destinationsOf(items: readonly NavItem[]): NavItem[] {
  return [...items.filter((item) => isDestinationAction(item.action.kind)), SETTINGS_ITEM];
}

/** A destination's icon, as bb draws it in its own navigation. A gear for Settings. */
export function TabIcon({ item }: { item: NavItem }) {
  if (item.id === SETTINGS) return <GearGlyph />;
  return (
    <span className="bb-top-tab-art" aria-hidden="true">
      <NavigationIcon icon={item.icon} className="bb-top-tab-glyph" />
    </span>
  );
}

/**
 * A destination's badge: its count or text, or a dot. Hidden from assistive
 * technology, since its label is part of the tab's name (`tabName`).
 */
export function TabBadge({ badge }: { badge: ExperimentalBadge }) {
  const mark = badgeMark(badge);
  return (
    <span
      className="bb-top-tab-badge"
      data-kind={mark.kind}
      data-tone={badge.tone ?? "neutral"}
      aria-hidden="true"
    >
      {mark.kind === "dot" ? null : mark.text}
    </span>
  );
}
