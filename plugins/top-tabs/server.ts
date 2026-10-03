// Top Tabs — server entry.
//
// Everything the strip does happens in the app bundle; the server exists for
// two things only the server can do: declare the plugin's settings, and
// claim the sidebar header slot when the plugin is installed. That slot is
// how the strip reaches bb's navigation (see components/NavBridge); it draws
// nothing, and leaves the header's own controls and the sidebar's
// navigation to bb. bb picks no header by default, so the install picks this
// one. The user can switch under Settings → Appearance → Header and that
// choice sticks.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

/** Must match the `experimental_sidebarHeader` id registered in app.tsx. */
const HEADER_SLOT = "nav-bridge";

export default async function plugin(bb: BbPluginApi) {
  bb.settings.define({
    collapseSidebar: {
      type: "boolean",
      label: "Collapse the sidebar on other tabs",
      description:
        "The thread list belongs to the Threads tab. When on, it slides away while another tab is in view and comes back with Threads, as it was when you left.",
      default: true,
    },
    closeSettingsOnExit: {
      type: "boolean",
      label: "Close the Settings tab when you leave Settings",
      description:
        "Escape, Back to app or going back closes the tab, as if Settings were a dialog. Switching tabs in the strip leaves it open, and a pinned Settings tab never closes.",
      default: true,
    },
    tabLabels: {
      type: "select",
      label: "Tab labels",
      description:
        "Show every tab's name, only the name of the tab in view, or icons alone. Pinned tabs are always icons; hover any icon for its name.",
      options: ["Always", "Active tab only", "Never"],
      default: "Always",
    },
  });

  bb.onInstall(async () => {
    const key = "sidebar.headerProvider";
    const { preferences } = await bb.sdk.system.uiPreferences.list();
    await bb.sdk.system.uiPreferences.set({
      key,
      value: `${bb.pluginId}/${HEADER_SLOT}`,
      expectedRevision: preferences[key].revision,
    });
  });
}
