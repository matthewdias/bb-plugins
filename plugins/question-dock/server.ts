// Question Dock — server entry.
//
// Everything the plugin does happens in the app bundle, against bb's own
// question card. The server only declares the settings.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { DESKTOP_CHOICES } from "./lib/settings.ts";

export default async function plugin(bb: BbPluginApi) {
  bb.settings.define({
    desktopMode: {
      type: "select",
      label: "Where questions open on a wide window",
      description:
        "Dock puts the card in a column on the right of the thread, when the thread is wide enough, and the chat moves over for it. Float puts it over the chat wherever you last dragged it. Either way, drag the card's header to move it, and drop it on the right edge to dock it. What you drag is remembered on that device; Question Dock: Reset card position goes back to this setting.",
      options: Object.values(DESKTOP_CHOICES),
      default: DESKTOP_CHOICES.dock,
    },
    mobileSheet: {
      type: "boolean",
      label: "Open questions as a sheet on phones",
      description:
        "The card rises over the chat from the bottom of the screen. Swipe its handle to make it taller or shorter, or tap the chat to put it away as a bar above the composer.",
      default: true,
    },
  });
}
