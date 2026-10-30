// The shape of a destination as Tab Nav handles it: one of bb's navigation
// items (`experimental_useSidebarNavigation`), as bb hands it over.
import type {
  ExperimentalSidebarNavigationAction,
  ExperimentalSidebarNavigationItem,
} from "@get-bb/plugin-sdk/app";

export type NavItem = Omit<ExperimentalSidebarNavigationItem, "action"> & {
  action: ExperimentalSidebarNavigationAction;
};
