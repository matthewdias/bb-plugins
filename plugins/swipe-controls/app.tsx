// Swipe Controls — swipe gestures for bb.
//
// - Swipe a sidebar thread right to mark it read or unread, left for Pin and
//   Archive; all the way left archives. A finger on a phone, two fingers on
//   a trackpad.
// - Two fingers across the page go back and forward, in bb's desktop app.
// - Haptic ticks where bb can play them: its iOS and Android apps.
//
// One registration: an app overlay, mounted once per window above every
// route. It draws nothing itself. It holds the SDK hooks the gestures need
// and runs them (components/Gestures, lib/controller).
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { Gestures } from "./components/Gestures.tsx";
import "./swipe-controls.css";

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "gestures", component: Gestures });
});
