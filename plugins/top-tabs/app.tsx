// Top Tabs — bb destinations as tabs across the top of the window.
//
// Threads is the first tab and cannot close: it is the sidebar, the thread
// list and the thread in view, as bb draws them. Every other destination —
// a plugin panel, Plugins, Skills — opens as a tab beside it and remembers
// where it was left, so switching between GitHub, Usage and the thread you
// were in returns each to the same place.
//
// Three registrations do it:
//   - an app overlay draws the strip above every route (components/TopTabs);
//   - a sidebar header slot that draws nothing connects the strip to bb's own
//     navigation, which stays the sidebar's (components/NavBridge);
//   - palette commands switch, close and reopen tabs from the keyboard.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { getController } from "./lib/controller.ts";
import { pageClose } from "./lib/shell.ts";
import { THREADS, closeCommandAction } from "./lib/tabs-model.ts";
import { NavBridge } from "./components/NavBridge.tsx";
import { TopTabs } from "./components/TopTabs.tsx";
import "./top-tabs.css";

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "strip", component: TopTabs });

  // server.ts selects this slot on install; keep the id in step with it.
  app.slots.experimental_sidebarHeader({
    id: "nav-bridge",
    title: "Top Tabs",
    description: "Connects the tab strip to bb's navigation. Draws nothing in the header.",
    component: NavBridge,
  });

  const hasStrip = () => getController() !== null;

  app.commands.register({
    id: "next-tab",
    title: "Top Tabs: Next tab",
    defaultShortcut: { key: "Tab", control: true },
    isAvailable: hasStrip,
    run: () => getController()?.cycle(1),
  });
  app.commands.register({
    id: "previous-tab",
    title: "Top Tabs: Previous tab",
    defaultShortcut: { key: "Tab", control: true, shift: true },
    isAvailable: hasStrip,
    run: () => getController()?.cycle(-1),
  });
  app.commands.register({
    id: "go-to-threads",
    title: "Top Tabs: Go to Threads",
    isAvailable: hasStrip,
    run: () => getController()?.activate(THREADS),
  });
  app.commands.register({
    id: "switch-thread",
    title: "Top Tabs: Switch thread…",
    isAvailable: hasStrip,
    run: () => getController()?.openSwitcher(),
  });
  app.commands.register({
    id: "open-tab",
    title: "Top Tabs: Open a tab…",
    isAvailable: hasStrip,
    run: () => getController()?.openPicker(),
  });
  /** The destination tab in view, or null on Threads and pages no tab holds. */
  const activeDestination = () => {
    const active = getController()?.active() ?? null;
    return active === THREADS ? null : active;
  };

  app.commands.register({
    id: "toggle-pin",
    title: "Top Tabs: Pin or unpin tab",
    isAvailable: () => activeDestination() !== null,
    run: () => {
      const active = activeDestination();
      if (active !== null) getController()?.togglePin(active);
    },
  });
  // On Threads, which cannot close, this presses bb's Close on the thread page,
  // which opens New Thread.
  const closeAction = () => {
    const controller = getController();
    const active = controller?.active() ?? null;
    const pinned = active !== null && controller?.isPinned(active) === true ? [active] : [];
    return { controller, active, action: closeCommandAction(active, pinned, pageClose() !== null) };
  };
  app.commands.register({
    id: "close-tab",
    title: "Top Tabs: Close tab",
    isAvailable: () => closeAction().action !== null,
    run: () => {
      const { controller, active, action } = closeAction();
      if (action === "page") pageClose()?.click();
      else if (action === "tab" && controller && active) controller.close(active);
    },
  });
  app.commands.register({
    id: "reopen-closed-tab",
    title: "Top Tabs: Reopen closed tab",
    defaultShortcut: { key: "t", control: true, shift: true },
    isAvailable: hasStrip,
    run: () => getController()?.reopen(),
  });
});
