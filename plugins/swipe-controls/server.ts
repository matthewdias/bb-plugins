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
    swipeRight: { ...SETTINGS.swipeRight, options: [...SETTINGS.swipeRight.options] },
    swipeLeftFull: { ...SETTINGS.swipeLeftFull, options: [...SETTINGS.swipeLeftFull.options] },
    rowLeftSwipe: { ...SETTINGS.rowLeftSwipe },
    hideRowActions: { ...SETTINGS.hideRowActions },
    backForward: { ...SETTINGS.backForward, options: [...SETTINGS.backForward.options] },
    haptics: { ...SETTINGS.haptics },
  });
}
