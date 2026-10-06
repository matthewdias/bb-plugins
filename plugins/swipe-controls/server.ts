// Swipe Controls — server entry.
//
// Everything happens in the app bundle. The server exists only to declare the
// settings, which only the server can do. They are written in lib/settings.ts,
// beside the code that reads them.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { SETTINGS } from "./lib/settings.ts";

export default async function plugin(bb: BbPluginApi) {
  bb.settings.define({
    rowSwipes: { ...SETTINGS.rowSwipes },
    rowLeftSwipe: { ...SETTINGS.rowLeftSwipe },
    fullSwipeArchive: { ...SETTINGS.fullSwipeArchive },
    backForward: { ...SETTINGS.backForward, options: [...SETTINGS.backForward.options] },
    haptics: { ...SETTINGS.haptics },
  });
}
