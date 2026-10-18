// Top Tabs — server entry.
//
// Everything the strip does happens in the app bundle; the server only
// declares the plugin's settings.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

export default async function plugin(bb: BbPluginApi) {
  bb.settings.define({
    collapseSidebar: {
      type: "boolean",
      label: "Remember the sidebar on each tab",
      description:
        "Each tab keeps the sidebar open or collapsed as you left it there. A tab you haven't set starts collapsed, so it gets the whole window, and Settings starts open for its sections. When off, the sidebar stays wherever you leave it.",
      default: true,
    },
    closeSettingsOnExit: {
      type: "boolean",
      label: "Close the Settings tab when you leave Settings",
      description:
        "Escape or going back closes the tab, as if Settings were a dialog. Switching tabs in the strip leaves it open, and a pinned Settings tab never closes.",
      default: true,
    },
    recentAfterClose: {
      type: "boolean",
      label: "After closing a tab, go back to the last one you used",
      description:
        "When off, closing the tab in view moves to its right-hand neighbour, as a browser does. When on, it returns to the tab you were on before it, as VS Code does.",
      default: false,
    },
    tabLabels: {
      type: "select",
      label: "Tab labels",
      description:
        "Show every tab's name, only the name of the tab in view, or icons alone. Pinned tabs are icons unless Show names on pinned tabs is on; hover any icon for its name.",
      options: ["Always", "Active tab only", "Never"],
      default: "Always",
    },
    pinnedLabels: {
      type: "boolean",
      label: "Show names on pinned tabs",
      description:
        "Pinned tabs show their names as the other tabs do, following Tab labels. When off, they're icons.",
      default: false,
    },
  });
}
