// Thread Summary — a card under the thread header with everything the thread's
// complications have to say.
//
// Complications are small values one plugin publishes about a thread and
// another draws (lib/complications.ts). Thread Badges draws them on sidebar
// rows; this draws them for the thread in view, in one card, and publishes two
// of its own: the branch against its base, and the pull request.
//
// Three registrations: the header control, which owns the button, its chips
// and the card; an app overlay that renders nothing and provides the Git and
// pull-request values; and a settings section for hiding providers.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { SummaryAction } from "./src/header";
import { Publisher } from "./src/publisher";
import { HiddenProvidersSettings } from "./src/settings-section";

export default definePluginApp((app) => {
  app.slots.experimental_threadHeaderAction({
    id: "summary",
    title: "Thread Summary",
    component: SummaryAction,
  });
  app.slots.experimental_appOverlay({ id: "publisher", component: Publisher });
  app.slots.settingsSection({
    id: "hidden-providers",
    title: "Hidden providers",
    description: "Hide a provider to keep it off the card and out of the header's chips.",
    component: HiddenProvidersSettings,
  });
});
