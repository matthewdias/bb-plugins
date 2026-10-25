// Top Tabs' sidebar navigation: it draws nothing, because the strip lists
// the destinations, and hands bb's navigation model to the strip
// (lib/navigation-bridge). bb lends that model only to components inside the
// sidebar, which is why this exists at all.
//
// It stays mounted while the sidebar is collapsed and while Settings,
// Plugins or Skills replace the thread list: bb hides the sidebar then
// rather than unmounting it. So the strip's actions keep working there.
//
// On a phone the strip steps aside, so the sidebar drawer shows bb's own
// Top list instead, through `experimental_Original`. bb has deprecated that
// prop; when it goes, the drawer is empty and destinations are in the palette.
import { useLayoutEffect } from "react";
import {
  experimental_SidebarNavigationIcon as NavigationIcon,
  experimental_usePluginId,
  experimental_useSidebarNavigation,
  experimental_useSidebarNavigationSplit,
  useBbNavigate,
  type ExperimentalSidebarHeaderProps,
  type ExperimentalSidebarNavigationProps,
} from "@get-bb/plugin-sdk/app";
import { navigation } from "../lib/navigation-bridge.ts";

export function NavProvider({ isCompactViewport, experimental_Original: Original }: ExperimentalSidebarNavigationProps) {
  navigation.restore(experimental_usePluginId());
  const state = experimental_useSidebarNavigation();
  // Declared before the publish below, so the strip knows a provider is up
  // by the time the first state arrives.
  useLayoutEffect(() => navigation.providerMounted(), []);
  useLayoutEffect(() => navigation.publish(state), [state]);
  // bb's split hook is per item; only plugin panels can sit in a pane.
  const splits = state.items
    .filter((item) => item.action.kind === "open-plugin-panel")
    .map((item) => <ItemSplit key={item.id} id={item.id} />);
  return (
    <>
      {isCompactViewport && Original !== undefined && <Original />}
      {splits}
    </>
  );
}

/** Reports which panes show one destination, and whether it can open in one. */
function ItemSplit({ id }: { id: string }) {
  const split = experimental_useSidebarNavigationSplit(id);
  const paneIds = split.layout?.panes.filter((pane) => pane.isMe).map((pane) => pane.paneId) ?? [];
  const key = paneIds.join("\n");
  useLayoutEffect(() => {
    navigation.setSplit(id, { isAvailable: split.isAvailable, paneIds: key === "" ? [] : key.split("\n") });
  }, [id, split.isAvailable, key]);
  useLayoutEffect(() => () => navigation.setSplit(id, null), [id]);
  return null;
}

/**
 * The sidebar header's New thread button. bb leaves New thread to the
 * navigation, and the strip has no place for it. When bb does not lend this
 * header the navigation model, it opens the compose screen directly.
 */
export function SidebarHeader({ width, controlSize, isCompactViewport }: ExperimentalSidebarHeaderProps) {
  const { items, actions } = experimental_useSidebarNavigation();
  const bbNavigate = useBbNavigate();
  // On a phone bb's Top list draws New thread as a row (see NavProvider).
  if (isCompactViewport || width < controlSize) return null;
  const item = items.find((candidate) => candidate.action.kind === "new-thread");
  const label = item?.label ?? "New thread";
  return (
    <button
      type="button"
      className="bb-top-tabs-new-thread"
      style={{ width: controlSize, height: controlSize }}
      aria-label={label}
      aria-keyshortcuts={item?.shortcut?.ariaKeyShortcuts}
      title={item?.shortcut ? `${label} (${item.shortcut.label})` : label}
      onClick={() => {
        if (item !== undefined) actions.activate(item.id, { target: "current" });
        else bbNavigate.toCompose();
      }}
    >
      <NavigationIcon icon={item?.icon ?? { kind: "host", name: "new-thread" }} />
    </button>
  );
}
