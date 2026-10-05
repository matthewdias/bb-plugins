// The controller, for palette commands, which run outside the overlay's tree.
// A command run while no overlay is mounted finds nothing and does nothing.
import type { DockController } from "./controller.ts";

let current: DockController | null = null;

export function publishController(next: DockController): () => void {
  current = next;
  return () => {
    if (current === next) current = null;
  };
}

export function getController(): DockController | null {
  return current;
}
