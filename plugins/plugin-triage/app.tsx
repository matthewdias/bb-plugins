// Plugin Triage — frontend entry. One page, a deck of plugins to decide on,
// shown inside bb's Plugins screen with a Triage row in that screen's sidebar.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { PluginsScreenOverlay } from "./ui/PluginsScreenOverlay";

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({
    id: "plugins-screen",
    component: PluginsScreenOverlay,
  });
});
