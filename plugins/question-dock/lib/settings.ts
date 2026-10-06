// The settings, shared by server.ts, which declares them, and the overlay,
// which reads them.
import type { DesktopMode } from "./geometry.ts";

/** The desktop setting's choices, as the settings page shows them. */
export const DESKTOP_CHOICES = {
  dock: "Dock beside the chat",
  float: "Float over the chat",
  inline: "Leave it above the composer",
} as const;

export function desktopModeOf(value: unknown): DesktopMode {
  if (value === DESKTOP_CHOICES.float) return "float";
  if (value === DESKTOP_CHOICES.inline) return "inline";
  return "dock";
}
