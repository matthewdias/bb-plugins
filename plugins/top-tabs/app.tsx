// Tab Nav — bb destinations as vertical tabs in the sidebar's rail.
//
// Threads is the first tab and cannot close: it is the thread list and the
// thread in view, as bb draws them. Every other destination — a plugin
// panel, Plugins, Skills — opens as a tab below it and remembers where it
// was left, so switching between GitHub, Usage and the thread you were in
// returns each to the same place.
//
// Two registrations do it:
//   - a sidebar navigation with `placement: "rail"`, which draws the tabs in
//     the column bb lays out at the sidebar's edge (components/TabRail);
//   - palette commands switch, close and reopen tabs from the keyboard.
//
// The plugin id stays `top-tabs`, from when the tabs ran across the top:
// tabs, settings and installs are keyed on it.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { getController } from "./lib/controller.ts";
import { pageClose } from "./lib/shell.ts";
import { isWide, setWide } from "./lib/store.ts";
import { THREADS, closeCommandAction } from "./lib/tabs-model.ts";
import { TabNavigation } from "./components/TabRail.tsx";
import "./top-tabs.css";

export default definePluginApp((app) => {
  app.slots.experimental_sidebarNavigation({
    id: "tabs",
    title: "Tab Nav",
    description: "Destinations as tabs in the rail: Threads, your pinned and open tabs, and + for more.",
    placement: "rail",
    component: TabNavigation,
  });

  const hasRail = () => getController() !== null;

  app.commands.register({
    id: "next-tab",
    title: "Tab Nav: Next tab",
    defaultShortcut: { key: "Tab", control: true },
    isAvailable: hasRail,
    run: () => getController()?.cycle(1),
  });
  app.commands.register({
    id: "previous-tab",
    title: "Tab Nav: Previous tab",
    defaultShortcut: { key: "Tab", control: true, shift: true },
    isAvailable: hasRail,
    run: () => getController()?.cycle(-1),
  });
  app.commands.register({
    id: "go-to-threads",
    title: "Tab Nav: Go to Threads",
    isAvailable: hasRail,
    run: () => getController()?.activate(THREADS),
  });
  app.commands.register({
    id: "switch-thread",
    title: "Tab Nav: Switch thread…",
    isAvailable: hasRail,
    run: () => getController()?.openSwitcher(),
  });
  app.commands.register({
    id: "open-tab",
    title: "Tab Nav: Open a tab…",
    isAvailable: hasRail,
    run: () => getController()?.openPicker(),
  });
  /** The destination tab in view, or null on Threads and pages no tab holds. */
  const activeDestination = () => {
    const active = getController()?.active() ?? null;
    return active === THREADS ? null : active;
  };

  app.commands.register({
    id: "toggle-pin",
    title: "Tab Nav: Pin or unpin tab",
    isAvailable: () => activeDestination() !== null,
    run: () => {
      const active = activeDestination();
      if (active !== null) getController()?.togglePin(active);
    },
  });
  // On Threads, which cannot close, this presses bb's Close on the thread page,
  // which opens New Thread. On a pinned tab it resets the tab and leaves it,
  // still pinned.
  const closeAction = () => {
    const controller = getController();
    const active = controller?.active() ?? null;
    const pinned = active !== null && controller?.isPinned(active) === true ? [active] : [];
    return { controller, active, action: closeCommandAction(active, pinned, pageClose() !== null) };
  };
  app.commands.register({
    id: "close-tab",
    title: "Tab Nav: Close tab",
    isAvailable: () => closeAction().action !== null,
    run: () => {
      const { controller, active, action } = closeAction();
      if (action === "page") pageClose()?.click();
      else if (action === "tab" && controller && active) controller.close(active);
      else if (action === "pin" && controller && active) controller.closePinned(active);
    },
  });
  app.commands.register({
    id: "toggle-names",
    title: "Tab Nav: Show or hide tab names",
    isAvailable: hasRail,
    run: () => setWide(!isWide()),
  });
  app.commands.register({
    id: "new-thread",
    title: "Tab Nav: New thread",
    isAvailable: hasRail,
    run: () => getController()?.newThread(),
  });
  app.commands.register({
    id: "reopen-closed-tab",
    title: "Tab Nav: Reopen closed tab",
    defaultShortcut: { key: "t", control: true, shift: true },
    isAvailable: hasRail,
    run: () => getController()?.reopen(),
  });
});
