// What Tab Nav treats as a destination: bb's own nav items that are places to
// go. bb draws Settings at the rail's foot, so there is no Settings tab.
import {
  experimental_SidebarNavigationIcon as NavigationIcon,
  type ExperimentalBadge,
} from "@get-bb/plugin-sdk/app";
import { badgeMark, type BadgeSize } from "../lib/badge.ts";
import type { NavItem } from "../lib/nav.ts";
import { isDestinationAction } from "../lib/tabs-model.ts";

/** The destinations bb offers, in bb's order. */
export function destinationsOf(items: readonly NavItem[]): NavItem[] {
  return items.filter((item) => isDestinationAction(item.action.kind));
}

/** A destination's icon, as bb draws it in its own navigation. */
export function TabIcon({ item }: { item: NavItem }) {
  return (
    <span className="bb-tab-nav-art" aria-hidden="true">
      <NavigationIcon icon={item.icon} className="bb-tab-nav-glyph" />
    </span>
  );
}

/**
 * A destination's badge: its count or text, or a dot, as bb draws it on its
 * Rail (`rail`) or beside a name (`list`). Hidden from assistive technology,
 * since its label is part of the tab's name (`tabName`).
 */
export function TabBadge({ badge, size }: { badge: ExperimentalBadge; size: BadgeSize }) {
  const mark = badgeMark(badge, size);
  return (
    <span
      className="bb-tab-nav-badge"
      data-kind={mark.kind}
      data-size={size}
      data-tone={badge.tone ?? "neutral"}
      aria-hidden="true"
    >
      {mark.kind === "dot" ? null : mark.text}
    </span>
  );
}
