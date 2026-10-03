// The strip's line to bb's navigation, mounted in the sidebar's header row.
//
// `experimental_useSidebarNavigation()` and its split hook only answer in the
// sidebar's own slots, not in the app overlay that draws the strip. bb's
// header row is one of those slots, and it draws nothing of ours: bb keeps
// its toggle and back/forward buttons there, and this component renders
// nothing between them. That leaves the sidebar's navigation to bb itself —
// its rows, ordering, hiding, More and drag-to-split, exactly as without Top
// Tabs — while the strip still gets the items and the actions it needs.
import { useLayoutEffect } from "react";
import {
  experimental_usePluginId,
  experimental_useSidebarNavigation,
  experimental_useSidebarNavigationSplit,
  type ExperimentalSidebarHeaderProps,
} from "@get-bb/plugin-sdk/app";
import { publishNavigation, restoreNavigation, retireNavigation } from "../lib/navigation-bridge.ts";
import { publishSplit, retireSplit } from "../lib/split-bridge.ts";
import { isDestinationAction } from "../lib/tabs-model.ts";

export function NavBridge({ isCompactViewport }: ExperimentalSidebarHeaderProps) {
  const nav = experimental_useSidebarNavigation();
  restoreNavigation(experimental_usePluginId());
  useLayoutEffect(() => publishNavigation(nav), [nav]);
  useLayoutEffect(() => retireNavigation, []);
  // bb has no splits on a compact viewport.
  if (isCompactViewport) return null;
  return (
    <>
      {nav.items
        .filter((item) => isDestinationAction(item.action.kind))
        .map((item) => (
          <SplitPublisher key={item.id} id={item.id} />
        ))}
    </>
  );
}

/**
 * Hands one destination's split support to the strip. Distance activation:
 * the strip passes a tab over only once it has been dragged out of the strip
 * and into the page, so bb should take the drag from there, not wait for it
 * to leave a sidebar it never started in.
 */
function SplitPublisher({ id }: { id: string }) {
  const split = experimental_useSidebarNavigationSplit(id, { activation: "distance" });
  useLayoutEffect(() => publishSplit(id, split), [id, split]);
  useLayoutEffect(() => () => retireSplit(id), [id]);
  return null;
}
