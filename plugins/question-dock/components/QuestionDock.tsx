// The app overlay: runs the controller while the plugin is loaded, and draws
// the dock preview while a card is dragged toward the right edge. The card
// itself is bb's; this draws nothing else.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useSettings } from "@get-bb/plugin-sdk/app";
import { DockController, type DockOptions } from "../lib/controller.ts";
import { publishController } from "../lib/instance.ts";
import type { Rect } from "../lib/geometry.ts";
import { desktopModeOf } from "../lib/settings.ts";

export function QuestionDock() {
  const { values } = useSettings();
  const options: DockOptions = {
    desktopMode: desktopModeOf(values?.desktopMode),
    mobileSheet: values?.mobileSheet !== false,
  };
  const [controller] = useState(() => new DockController(window, options));
  const [ghost, setGhost] = useState<Rect | null>(null);

  useEffect(() => {
    controller.start();
    const unpublish = publishController(controller);
    const unsubscribe = controller.subscribeGhost(setGhost);
    return () => {
      unsubscribe();
      unpublish();
      controller.stop();
    };
  }, [controller]);

  useEffect(() => {
    controller.setOptions(options);
  }, [controller, options.desktopMode, options.mobileSheet]);

  if (ghost === null) return null;
  return createPortal(
    <div
      className="question-dock-ghost"
      aria-hidden="true"
      style={{ left: ghost.left, top: ghost.top, width: ghost.width, height: ghost.height }}
    />,
    document.body,
  );
}
