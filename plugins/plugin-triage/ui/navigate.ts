/**
 * Go to a bb route without a reload. bb uses a browser router, which listens
 * for popstate, and the SDK's navigation reaches only this plugin's own
 * panels: pushing the path and announcing it is how the Triage row, the
 * install toast's Settings button and a Saved card reach bb's own pages.
 */
export function navigateInApp(to: string): void {
  window.history.pushState({}, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/**
 * bb's detail pane for a store entry. bb opens it beside whichever list the
 * URL's `view` names, and its own cards keep that view, so this keeps Triage.
 */
export function pluginDetailsPath(pluginId: string): string {
  return `/plugins/${encodeURIComponent(pluginId)}?view=triage`;
}
