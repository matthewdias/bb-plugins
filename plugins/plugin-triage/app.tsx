// Plugin Triage — frontend entry. One page, a deck of plugins to decide on,
// shown inside bb's Plugins screen with a Triage row in that screen's sidebar,
// and a Triage item in bb's own sidebar carrying the count.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { PluginsScreenOverlay } from "./ui/PluginsScreenOverlay";
import { TriageSidebarCount, TriageSidebarHeader, TriageSidebarPanel } from "./ui/TriageSidebar";

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({
    id: "plugins-screen",
    component: PluginsScreenOverlay,
  });
  app.slots.navPanel({
    id: "triage",
    title: "Triage",
    icon: "Layers",
    path: "triage",
    component: TriageSidebarPanel,
    headerContent: TriageSidebarHeader,
    experimental_sidebarAccessory: TriageSidebarCount,
  });
});
