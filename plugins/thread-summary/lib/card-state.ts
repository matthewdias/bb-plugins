// What the card remembers per device, and when it closes.
//
// Two things outlive a card: its mode (compact or expanded) and the pin. Both
// are this device's choice, not the thread's, so they live in localStorage
// and every card in the window reads the same pair. A header remounts on a
// thread switch; a pinned one reads the pin here and opens at once.

export type Mode = "compact" | "expanded";

export interface DeviceState {
  mode: Mode;
  pinned: boolean;
}

export const DEFAULT_STATE: DeviceState = { mode: "compact", pinned: false };

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

const key = (pluginId: string, name: string) => `${pluginId}:${name}`;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // Storage can throw outright in a locked-down browser; fall back to defaults.
    return null;
  }
}

export function readState(pluginId: string, store: Storage | null = storage()): DeviceState {
  try {
    const mode = store?.getItem(key(pluginId, "mode"));
    const pinned = store?.getItem(key(pluginId, "pinned"));
    return {
      mode: mode === "expanded" ? "expanded" : "compact",
      pinned: pinned === "true",
    };
  } catch {
    return DEFAULT_STATE;
  }
}

export function writeState(
  pluginId: string,
  patch: Partial<DeviceState>,
  store: Storage | null = storage(),
): void {
  try {
    if (patch.mode !== undefined) store?.setItem(key(pluginId, "mode"), patch.mode);
    if (patch.pinned !== undefined) store?.setItem(key(pluginId, "pinned"), String(patch.pinned));
  } catch {
    // A full or refused store keeps the choice for this session only.
  }
}

/**
 * What closes an unpinned card. Pinned, none of these do: the card stays open
 * through clicks elsewhere and on every thread, until its own close button.
 */
export type CloseReason = "escape" | "outside" | "thread-switch";

export function closesOn(_reason: CloseReason, pinned: boolean): boolean {
  return !pinned;
}

/** bb's portaled menus, popovers and previews, and every plugin's, carry this. */
export const PORTALED_OVERLAY_SELECTOR = "[data-bb-portaled-overlay]";

/**
 * Whether a press at `target` is outside the card. Inside the card, on the
 * header control that opened it, or inside any portaled overlay — a menu the
 * card opened, bb's file preview — is not: those are part of using the card.
 */
export function isOutside(
  target: EventTarget | null,
  card: Element | null,
  control: Element | null,
): boolean {
  if (!(target instanceof Element)) return false;
  if (card?.contains(target) || control?.contains(target)) return false;
  return target.closest(PORTALED_OVERLAY_SELECTOR) === null;
}
