// Declutter — app entry.
//
// The overlay hides what you chose and notices new things to choose from (see
// src/overlay.tsx). The choosing happens in one list, reachable two ways: the
// plugin's settings page, and a thread panel tab, where the thread stays in
// view while you flip switches.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { Customize } from "./src/customize";
import { DeclutterOverlay } from "./src/overlay";

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "declutter", component: DeclutterOverlay });

  app.slots.settingsSection({
    id: "customize",
    title: "What shows",
    description:
      "Everything bb or a plugin has put in a thread header, above the composer, or on a message, as this and your other windows have seen it. Switch one off to hide it everywhere.",
    component: Customize,
  });

  app.slots.threadPanelAction({
    id: "customize",
    title: "Declutter",
    icon: "EyeOff",
    component: Customize,
  });

  app.commands.register({
    id: "customize",
    title: "Declutter: choose which actions and banners show",
    isAvailable: ({ threadId }) => threadId !== null,
    run: ({ openPanel }) => {
      openPanel({ actionId: "customize" });
    },
  });
});
