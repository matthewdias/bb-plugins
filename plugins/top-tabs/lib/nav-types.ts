// The shape of bb's navigation model, which the strip reads off the rail.
//
// bb 0.46 removed `experimental_useSidebarNavigation` and its types from the
// SDK, but the rail still draws from the same model: the same items, the same
// active id and the same actions. These are the parts of it the strip uses,
// declared here because the SDK no longer exports them. lib/rail.ts checks a
// value against this shape before trusting it.

export type NavIcon =
  | { kind: "host"; name: string }
  | { kind: "plugin"; pluginId: string; icon: string | null };

export type NavAction =
  | { kind: "open-plugin-panel"; pluginId: string; panelId: string }
  | { kind: string; pluginId?: undefined; panelId?: undefined };

export interface NavItem {
  /** `<pluginId>/<panelId>`, or `__bb__/<name>` for bb's own. */
  id: string;
  label: string;
  icon: NavIcon;
  action: NavAction;
  isVisible: boolean;
  isDisabled: boolean;
  isLoading: boolean;
  pluginId: string | null;
  shortcut: { label: string; ariaKeyShortcuts: string } | null;
}

export interface NavActions {
  activate(id: string, options: { openInSplit: boolean }): void;
  openDetails(id: string): void;
}

export interface NavState {
  items: readonly NavItem[];
  activeItemId: string | null;
  isShortcutModifierHeld: boolean;
  actions: NavActions;
}
