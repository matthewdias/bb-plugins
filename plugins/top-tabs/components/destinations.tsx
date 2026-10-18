// What the strip treats as a destination: bb's own nav items, plus Settings.
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { experimental_Icon as Icon, useSdk } from "@get-bb/plugin-sdk/app";
import type { NavItem } from "../lib/nav-types.ts";
import { railIcon, subscribeRailIcons } from "../lib/rail.ts";
import { SETTINGS, isDestinationAction } from "../lib/tabs-model.ts";
import { GearGlyph } from "./glyphs.tsx";

/**
 * bb's Settings, in the shape of a nav item so every part of the strip can
 * treat it like one. bb has no nav item for Settings, so this one is the
 * strip's own: its action kind (`open-settings`) is one bb never sends,
 * which keeps the strip from ever handing it to bb's navigation actions —
 * it is reached by path instead (see `defaultPathFor`).
 */
export const SETTINGS_ITEM: NavItem = {
  id: SETTINGS,
  label: "Settings",
  icon: { kind: "plugin", pluginId: "top-tabs", icon: null },
  action: { kind: "open-settings" },
  isDisabled: false,
  // Not one of the sidebar's items, so the first-run seed leaves it out.
  isVisible: false,
  isLoading: false,
  pluginId: null,
  shortcut: null,
};

/** The destinations bb offers, then Settings. */
export function destinationsOf(items: readonly NavItem[]): NavItem[] {
  return [...items.filter((item) => isDestinationAction(item.action.kind)), SETTINGS_ITEM];
}

/** The icon names bb's rail uses for its own items. */
const HOST_ICONS: Record<string, string> = {
  "new-thread": "MessageSquarePlus",
  search: "Search",
  extensions: "Plug02",
  skills: "Zap",
};

/**
 * A destination's icon, drawn as bb's rail draws it: the rail's own artwork
 * when the rail has drawn the item; otherwise the named icon; and for a
 * plugin whose icon name bb doesn't know, the plugin's branding image. A gear
 * for Settings.
 */
export function TabIcon({ item }: { item: NavItem }) {
  const markup = useSyncExternalStore(subscribeRailIcons, () => railIcon(item.id));
  if (item.id === SETTINGS) return <GearGlyph />;
  // bb's own markup, copied from the rail.
  if (markup !== null) return <span className="bb-top-tab-art" aria-hidden="true" dangerouslySetInnerHTML={{ __html: markup }} />;
  if (item.icon.kind === "host") return <Icon name={HOST_ICONS[item.icon.name] ?? "Zap"} aria-hidden="true" />;
  return <PluginIcon pluginId={item.icon.pluginId} name={item.icon.icon} />;
}

/** A plugin's branding, from bb's plugin list: an image, or an icon name. */
interface Brand {
  icon: string | null;
  iconUrl: string | null;
}

let brands: ReadonlyMap<string, Brand> | null = null;
let brandsLoading = false;
const brandListeners = new Set<() => void>();

function subscribeBrands(listener: () => void): () => void {
  brandListeners.add(listener);
  return () => brandListeners.delete(listener);
}

/** Every plugin's branding, read once per window, the first time it's needed. */
function useBrands(): ReadonlyMap<string, Brand> | null {
  const sdk = useSdk();
  const current = useSyncExternalStore(subscribeBrands, () => brands);
  useLayoutEffect(() => {
    if (brands !== null || brandsLoading) return;
    brandsLoading = true;
    sdk.plugins
      .list()
      .then(({ plugins }) => {
        brands = new Map(plugins.map((p) => [p.id, { icon: p.icon ?? null, iconUrl: p.iconUrl ?? null }]));
      })
      .catch(() => {
        brands = new Map();
      })
      .finally(() => {
        for (const listener of brandListeners) listener();
      });
  }, [sdk]);
  return current;
}

/**
 * A plugin's named icon, or its branding when bb's icon set has no such
 * name, as bb's rail does: the branding image if the plugin has one, else the
 * icon its manifest names. bb's `Icon` draws Zap for a name it doesn't know
 * and says which icon it drew in `data-icon`, which is how the miss is told
 * apart.
 */
function PluginIcon({ pluginId, name }: { pluginId: string; name: string | null }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [missing, setMissing] = useState(name === null);
  const brand = useBrands()?.get(pluginId);
  useLayoutEffect(() => {
    if (name === null) return setMissing(true);
    const drawn = ref.current?.querySelector("[data-icon]");
    if (drawn === null || drawn === undefined || drawn.hasAttribute("data-icon-pending")) return;
    setMissing(drawn.getAttribute("data-icon") !== name);
  });
  if (missing) {
    if (brand?.iconUrl) {
      const url = `url("${brand.iconUrl.replace(/["\\]/g, "")}")`;
      return <span className="bb-top-tab-brand" aria-hidden="true" style={{ maskImage: url, WebkitMaskImage: url }} />;
    }
    // A manifest icon is a name from bb's set, or a path to the image above.
    const named = brand?.icon && !brand.icon.includes("/") ? brand.icon : "Zap";
    return <Icon name={named} aria-hidden="true" />;
  }
  return (
    <span className="bb-top-tab-art" ref={ref}>
      <Icon name={name!} aria-hidden="true" />
    </span>
  );
}
