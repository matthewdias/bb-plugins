// bb's own pages, reached without a reload.
//
// The SDK navigates only to a plugin's own panels, and `openSettings()` is
// offered to sidebar footer actions alone. bb uses a browser router that
// listens for popstate, so pushing the path and announcing it is how this
// reaches the plugin's settings — the same way Plugin Triage reaches bb's
// plugin pages (plugins/plugin-triage/ui/navigate.ts).
import type { MouseEvent } from "react";

export function settingsPath(pluginId: string): string {
  return `/settings/plugins/${encodeURIComponent(pluginId)}`;
}

/**
 * A plain click navigates in place; a modified or middle click is left to the
 * browser, so the link still opens in a new tab or window.
 */
export function navigateInApp(event: MouseEvent<HTMLAnchorElement>, to: string): void {
  if (event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  window.history.pushState({}, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
