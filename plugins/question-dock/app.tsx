// Question Dock — moves bb's question card out of the chat's way.
//
// bb draws a pending question above the composer and lets it grow to the
// height of the chat, with a second scroller inside. This lifts that same
// card, bb's own, and places it: docked in a column beside the chat on a
// wide window, floating where you drag it on a narrower one, and as a sheet
// from the bottom of the screen on a phone. Plan reviews and plugin forms
// (Grill, for one) share the card and move with it; approvals stay put.
//
// One registration does it: an app overlay that runs lib/controller. The
// palette commands below reach the controller through lib/instance.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { QuestionDock } from "./components/QuestionDock.tsx";
import { getController } from "./lib/instance.ts";
import "./question-dock.css";

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "dock", component: QuestionDock });

  const hasCard = () => getController()?.hasCard() ?? false;

  app.commands.register({
    id: "dock",
    title: "Question Dock: Dock card",
    isAvailable: hasCard,
    run: () => getController()?.dock(),
  });
  app.commands.register({
    id: "float",
    title: "Question Dock: Float card",
    isAvailable: hasCard,
    run: () => getController()?.float(),
  });
  app.commands.register({
    id: "reset",
    title: "Question Dock: Reset card position",
    isAvailable: () => getController() !== null,
    run: () => getController()?.reset(),
  });
});
