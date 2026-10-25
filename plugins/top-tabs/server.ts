// Tab Nav — server entry.
//
// Everything the rail does happens in the app bundle; the server only
// declares the plugin's settings.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

export default async function plugin(bb: BbPluginApi) {
  bb.settings.define({
    collapseSidebar: {
      type: "boolean",
      label: "Remember the sidebar on each tab",
      description:
        "Each tab keeps the sidebar open or collapsed as you left it there. A tab you haven't set starts with the thread list collapsed to the rail, so the page gets the window. When off, the sidebar stays wherever you leave it.",
      default: true,
    },
    recentAfterClose: {
      type: "boolean",
      label: "After closing a tab, go back to the last one you used",
      description:
        "When off, closing the tab in view moves to the tab below it, as a browser moves to its neighbour. When on, it returns to the tab you were on before it, as VS Code does.",
      default: false,
    },
  });
}
