// The strip's verbs, for callers outside its React tree.
//
// Palette commands run outside any component, and navigating needs the
// strip's hooks (`activate`, `toCompose`). The strip publishes its verbs here
// while it is mounted; a command run while it is not — on a compact viewport,
// where it hides — finds nothing and does nothing.
import type { TabId } from "./tabs-model.ts";

export interface TabsController {
  active(): TabId | null;
  activate(id: TabId): void;
  close(id: TabId): void;
  /** Reset a pinned tab to its start and leave it, still pinned. */
  closePinned(id: TabId): void;
  cycle(direction: 1 | -1): void;
  reopen(): void;
  openPicker(): void;
  isPinned(id: TabId): boolean;
  togglePin(id: TabId): void;
  /** Open the Threads tab's thread switcher, focused for the keyboard. */
  openSwitcher(): void;
}

let controller: TabsController | null = null;

export function publishController(next: TabsController): () => void {
  controller = next;
  return () => {
    if (controller === next) controller = null;
  };
}

export function getController(): TabsController | null {
  return controller;
}
