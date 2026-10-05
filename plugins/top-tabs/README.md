# Top Tabs

bb puts every destination in the sidebar, beside the threads. Open GitHub and
your thread is gone. Go back to the thread and GitHub forgets the pull request
you were reading. Top Tabs moves the destinations into a strip of tabs across
the top of the window. Keep several open, switch between them, and each one
comes back where you left it.

**Threads** is the first tab, and it never closes. It is bb as you know it: the
sidebar, the thread list and the thread in view. Every other tab is a
destination — a plugin panel, Plugins, Skills. While another tab is in view,
the sidebar slides away and the destination gets the whole window. It returns
when you go back to Threads.

## Install

```sh
bb plugin install "git:https://github.com/matthewdias/bb-plugins.git@semver:*" \
  --subdirectory plugins/top-tabs --tag-prefix top-tabs/
```

On install, Top Tabs takes the sidebar's **header** slot (**Settings →
Appearance → Header**). It draws nothing there; it's how the strip reaches
bb's navigation. bb's own controls stay in the header, and the sidebar keeps
whichever navigation you use, bb's own by default. If you choose another
header, the strip keeps working from the last list it saw.

## Using it

- **Open a tab** with the **+** button after the last tab. It lists every
  destination bb offers: a dot marks the ones already open, a pin the pinned
  ones. Reaching a destination any other way (the palette, its shortcut, a
  link) opens a tab for it too.
- **Open one in a split** from the same menu, with the split button on the
  highlighted row or a ⌘-click (Ctrl-click elsewhere), as in bb's own
  navigation.
- **Reorder, hide and split from the sidebar**, with bb's own navigation:
  drag a row to reorder it, use its options menu to hide it, drag it into the
  page to split it. The **+** menu follows bb's order, with Settings last.
  See [The sidebar](#the-sidebar).
- **Pin a tab** from its context menu, or with the pin on its row in the
  **+** menu, to keep it. See [Pinned tabs](#pinned-tabs).
- **Close a tab** with the × that replaces its icon on hover, a middle-click,
  its context menu, or bb's own Close at the top right of the page. Pinned
  tabs don't close; bb's Close and **Top Tabs: Close tab** reset one instead. Closing the
  tab in view moves to its right-hand neighbour, then its left, then
  Threads, or, with **After closing a tab, go back to the last one you
  used**, to the tab you were on before it.
- **Reopen a closed tab** with Ctrl+Shift+T, the context menu, or the **+**
  menu. It comes back in the same position, at the same place inside the
  panel. It also undoes a pinned tab's reset.
- **Reorder** by dragging a tab sideways, within its group: pinned tabs among
  pinned, the rest among the rest. Drag it down into the page instead to open
  it in a split.
- **Switch** with Ctrl+Tab and Ctrl+Shift+Tab, or the arrow keys once a tab
  has focus.
- **Right-click** a tab to pin or unpin it, close others, close everything to
  its right, open it in a split, or open the plugin's details.

The first time it runs, the strip opens a tab for each destination your sidebar
showed, so what you used is where you look for it.

### The Threads tab

While another tab is in view, the Threads tab shows the thread it will return
to beside its name. The name slides open as you leave and shut as you come
back, so the tabs after it move rather than jump. Clicking it returns to that
thread, or to the compose screen if you were there.

It always shows three counts:

- threads waiting on you, as an amber pill, the loudest mark;
- threads running, with a spinner;
- threads finished since you last looked, with a dot, red if one failed.

**Rest the pointer on it** for a thread switcher, on any tab, Threads
included, where it's quicker than scanning a long thread list. It lists what
wants something from you:

- **Needs you:** threads waiting for an answer.
- **Running:** threads still working.
- **Finished:** threads done since you last looked.
- **Recent:** the threads you were in last.

Each row shows the title, project and how long ago. The thread you're in is
in bold, and isn't repeated under Recent. Picking one goes straight to it,
focusing its pane if a split shows it. **Top Tabs: Switch
thread…** opens the same card from the palette, ready for the arrow keys.

Threads never closes. On Threads, **Top Tabs: Close tab** closes the thread
in view instead, as bb's Close at the top right of the page does, and opens
New Thread. In a split, or already on the compose screen, it does nothing.

### The Settings tab

bb's Settings can be a tab too. It opens whenever you go to Settings: from
the sidebar's gear, with ⌘, (Ctrl+, elsewhere), from the palette, or from the
**+** menu, where it's listed last. Like any tab, you can pin it or close it, and it returns to the
settings page you left it on.

Two things set it apart:

- **Its navigation is the sidebar.** On Settings, bb fills the sidebar with
  Settings' own sections, so arriving on the tab opens the sidebar. Leaving
  undoes that: another tab collapses it, and Threads gets back the sidebar
  you keep there.
- **It can't go in a split**, because bb doesn't put Settings in a pane.
- **Leaving Settings closes it.** Escape, Back to app or the browser's back
  closes the tab, as if Settings were a dialog. Switching tabs in the strip
  (a click, Ctrl+Tab, the **+** menu) leaves it open, a pinned Settings tab
  never closes, and ⌃⇧T reopens it at the page you left. Turn this off with
  **Close the Settings tab when you leave Settings**.

### Pinned tabs

A pinned tab is one you always want in the strip:

- It sits next to Threads, left of the divider, drawn as an icon. Hover it
  for its name.
- It has no ×, and middle-click, close-others and close-to-the-right all
  leave it alone.
- bb's Close at the top right of the page, or **Top Tabs: Close tab**,
  resets it instead, as Arc does. It stays pinned, forgets where it was
  left, so it next opens at the panel's start, and the strip moves on past
  the other pins: to the first ordinary tab, or Threads if there is none. With **After closing a tab, go back to the last
  one you used** on, it goes to the ordinary tab you used last instead. So
  pressing the shortcut again closes that tab rather than stepping through
  the pins. ⌃⇧T undoes a reset and takes the tab back to where it was, until
  you go back to the tab yourself: then the reset is taken as it is.
- Unpin it from its context menu (or with **Top Tabs: Pin or unpin tab**) to
  make it an ordinary tab again. It lands first among the ordinary tabs.

The **+** menu doubles as the pin list. Pinned rows show a filled pin, and
the pin on any row toggles it. The menu stays open, so a set of default pins
takes one visit. Pinning a destination you haven't opened adds its tab
without going there. Pins persist like every other tab.

### What a tab costs

Close to nothing, pinned or not. A tab is a remembered location. A panel
loads when you switch to it and unloads when you switch away, exactly as it
did from the sidebar. bb has no way to keep a page alive in the background,
so ten open tabs cost the same as one, apart from each panel's small sidebar
badge (Pokédex's "11/1025", say), which bb's own sidebar was already drawing.

That's also why a tab comes back at its location rather than its exact state.
See [Where tabs return to](#where-tabs-return-to).

### Switching speed

A switch shows up straight away. The tab you pick is drawn selected on the
next frame, before bb starts rendering the page. Threads switches on press
rather than release, as browser tabs do.

What takes the time after that is bb rendering the page. Leaving a thread
unmounts it, so coming back renders its timeline from scratch. For a long
thread that's a couple of seconds, the same as opening it from the sidebar.
bb has no way for a plugin to keep a page mounted in the background. Hiding
pages in maximized split panes keeps them mounted, but bringing a hidden
thread back still cost about as much as rendering it fresh, so the strip
doesn't do it.

### Where tabs return to

Each tab remembers the exact URL it was left at: the pull request inside
GitHub, not just GitHub. Switching back navigates there. Closing a tab forgets
the location; reopening it with Ctrl+Shift+T brings it back.

A panel is still a bb page, so switching away unmounts it. A tab keeps its
location, not its scroll position or unsaved input. A panel that keeps its own
state in its URL comes back exactly; one that keeps it only in memory starts
fresh.

### Splits

The strip follows bb's split view:

- **What's on screen.** The focused pane's tab is selected. Any other tab
  showing in a pane is outlined. Both carry a small map of the split with
  their own pane filled.
- **Switching.** Clicking a tab that is already in a pane focuses that pane
  instead of replacing anything. For Threads, that's the pane showing a
  thread, and the one you were last in if two are.
- **Opening.** Drag a tab down out of the strip and bb's own split gesture
  takes over: drop on an edge to split, or in the middle to replace. "Open in
  split" in the context menu does the same. For Threads, it opens the thread
  it would return to.
- **Splitting the tab you're looking at.** bb won't show one destination in
  two panes, so the strip brings in a partner. The partner is the tab you
  were on just before, or Threads if there wasn't one. For Threads, it's your
  first open panel. The context menu names it ("Split with Threads"), and
  dragging the tab down previews where it will open. Your tab stays where it
  is, still mounted and scrolled, and the partner opens beside it.
- **Closing.** Closing a tab that is on screen closes its pane too, and bb
  decides which pane takes focus.
- **The sidebar** is left alone while a split is up. It's where you drag
  threads into panes from.

bb keeps a split in memory while one of its own pages, such as Plugins or
Settings, takes the whole view, and puts it back afterwards. The strip
follows: nothing is marked on screen until the split is.

### The side panel

bb's right-hand panel (⌘J) has tabs of its own: thread info, files,
terminals, browsers, plugin panels. The two strips sit at different levels:

- **The top strip** chooses the place: a thread or a destination. It belongs
  to the window.
- **Splits** put places side by side.
- **The side panel** holds the tools for the place in view. Each thread, and
  each plugin page, has its own.

So the side panel travels with its page. Switching tabs swaps it out along
with the page, and switching back brings back the one that page had. bb
does the remembering. The one exception is bb's own rule: a panel holding
only its "New tab" launcher, with nothing durable in it, closes when its
page comes back.

The keyboard follows the same layering. The side panel, as the innermost
set of tabs, has the browser-standard keys: ⌘T, ⌘W, ⌘⇧T, ⌘⌃←/→. The top
strip stays off them, with Ctrl+Tab, Ctrl+Shift+Tab and Ctrl+Shift+T.

### The sidebar

The sidebar belongs to Threads:

- **Leaving Threads** collapses the sidebar if it was open, and remembers that
  it was.
- **Returning to Threads** reopens it, but only if it was open when you left.
  The same applies when the app loads straight onto a thread.
- **Collapsing it yourself on Threads** keeps it collapsed there. The strip
  only ever restores your own choice, and Threads never collapses it.
- **Opening it by hand on another tab** keeps it open until you go back to
  Threads.
- **Settings** opens the sidebar for its own sections, and leaving it
  undoes that. See [The Settings tab](#the-settings-tab).
- **A split** pauses all of this until it closes.

When the strip moves the sidebar as part of a switch, the space it takes
changes instantly, in the same step as the page, so the page lays out once,
at its final width. Sliding that space open would make a long thread lay
itself out again on every frame. What moves is drawn on top: going back to
Threads, the sidebar slides in over the space it already has and the thread
fades in, both animated without laying anything out again. They wait until
bb has finished drawing the thread, so the motion plays from start to end
instead of freezing partway or appearing half done, and the Threads tab's
title moves with them. Coming back from a page with a sidebar of its own
(Plugins, Skills, Settings), that sidebar and page stay out of sight until
bb has the thread list ready, and the thread list is what slides in.
Leaving Threads is instant. Opening or closing the sidebar yourself still
slides as bb draws it. With reduced motion on, nothing animates.

Above the thread list, the sidebar keeps bb's own navigation, unchanged.
Its rows, drag-to-reorder, options menu, More, customize editor and
drag-to-split all work as they do without Top Tabs, and the strip follows:

- Clicking a row opens its tab.
- The **+** menu lists destinations in the order you set there.
- Hiding an item from the sidebar leaves its tab alone. The strip holds
  every destination either way, so the sidebar can carry as few as you like.
  New thread and Search are a good minimum.

### On a phone

Below bb's `md` breakpoint the sidebar is a drawer again and the strip steps
aside. bb's navigation in the drawer has every destination: visible ones as
rows, hidden ones behind **More**.

## Settings

| | Default |
| --- | --- |
| Collapse the sidebar on other tabs | on |
| Close the Settings tab when you leave Settings | on |
| After closing a tab, go back to the last one you used | off |
| Tab labels | Always |

**Collapse the sidebar** off keeps the sidebar wherever you leave it. The
tabs work the same either way.

**After closing a tab, go back to the last one you used** chooses where
closing the tab in view goes. Off, it moves to the tab on its right, as a
browser does. On, it returns to the tab you were on before it, as VS Code
does, Threads included, and to the tab on its right once none of the tabs you
used recently is still open. Closing a pinned tab follows it too, skipping
the other pins.

**Tab labels** chooses how much of the strip is words:

- *Always* names every tab.
- *Active tab only* names the tab in view and draws the rest as icons, so a
  long strip stays short without losing your place.
- *Never* draws every tab as an icon, Threads included. Its "needs you" count
  stays beside the icon.

Pinned tabs are icons whatever this says. Hover any icon for its name.

## Commands

All are in bb's command palette, and every shortcut can be rebound under
**Settings → Keyboard**.

| Command | Default shortcut |
| --- | --- |
| Top Tabs: Next tab | Ctrl+Tab |
| Top Tabs: Previous tab | Ctrl+Shift+Tab |
| Top Tabs: Reopen closed tab | Ctrl+Shift+T |
| Top Tabs: Go to Threads | — |
| Top Tabs: Switch thread… | — |
| Top Tabs: Open a tab… | — |
| Top Tabs: Close tab (on Threads: close the thread in view; on a pinned tab: reset it) | — |
| Top Tabs: Pin or unpin tab | — |

In a web browser, the browser keeps Ctrl+Tab and Ctrl+Shift+T for itself.
Rebind them there if you want them.

On Windows and Linux, bb's ⌘ is Ctrl, so the side panel's reopen-closed-tab
is Ctrl+Shift+T too. bb leaves a plugin's conflicting default unbound, so
Reopen closed tab starts without a shortcut there. Give it one under
**Settings → Keyboard**.

## How it works

Three registrations:

- An `experimental_appOverlay` draws the strip. It mounts once per window,
  outside every route, so it survives every navigation.
- An `experimental_sidebarHeader` component that draws nothing carries bb's
  navigation to the strip. The sidebar's own navigation is left to bb.
- Palette commands drive the strip from the keyboard.

Tabs are per client and live in localStorage. The strip on your phone is not
the strip on your desktop.

### What it depends on that the SDK does not promise

bb's plugin API has no slot that reserves room above the app, and no way to
read or set whether the sidebar is open. Top Tabs works around both, and the
workarounds are kept small and in one place each:

- **Room for the strip.** `top-tabs.css` pads `#root` and moves bb's
  fixed-position sidebar panel and sidebar toggles (web and desktop) down by
  the strip's height. Every rule is keyed on a class the strip sets on
  `<html>` while it's on screen, so nothing moves otherwise. It's a class
  rather than `body:has(#bb-top-tabs)` because `:has()` made the browser
  restyle the whole page on every change inside the strip, which cost about
  140ms per tab switch on a long thread.
- **macOS traffic lights.** In bb's desktop app the lights move into the
  strip. `lib/desktop.ts` asks bb's desktop bridge the same two questions bb
  asks: is this macOS, and is the window full screen. The strip then leaves
  bb's own 84px inset and lowers its controls 2px, as bb does. Below the
  strip, bb's toggle and page header drop their traffic-light reservation.
- **The sidebar.** `lib/shell.ts` reads the attributes bb's sidebar primitive
  publishes (`data-side`, `data-state`, `data-collapsible`). It toggles the
  sidebar by clicking bb's own toggle, so the collapse animates and bb's state
  stays the only source of truth. If an element is missing, the strip leaves
  the sidebar alone.
- **Returning to a location.** bb routes with React Router. `lib/location.ts`
  pushes a history entry and dispatches `popstate`, which React Router treats
  as an ordinary navigation.
- **The header row.** bb gives a header plugin the row between the sidebar
  toggle and back/forward. The bridge draws nothing there, so `top-tabs.css`
  shrinks bb's slot to nothing just before the arrows, and the row lays out
  as if no header were chosen. Plugins that measure the row depend on that,
  such as compact-nav's "beside sidebar toggle" placement, which expects the
  row's first element to be the arrows.
- **Navigation items.** `experimental_useSidebarNavigation()` returns nothing
  in an app overlay, but answers in the sidebar's slots. So a header-slot
  component that draws nothing (`components/NavBridge.tsx`) publishes what it
  sees, and the strip reads that (`lib/navigation-bridge.ts`). bb doesn't
  mount the header on Settings. There, and if you pick another header, the
  strip keeps the last items it saw and navigates by path. It also caches
  them in localStorage, so a window loaded straight onto such a page still
  shows its tabs.
- **Settings.** bb has no nav item for Settings, so the strip adds its own
  (`components/destinations.tsx`). It's reached by path, `/settings`, and
  recognised by route.
- **Splits.** `useSidebarSplitLayout()` works from the overlay and says which
  panes show threads. Which pane shows each destination comes from
  `experimental_useSidebarNavigationSplit`, which also only answers in the
  sidebar's slots, so the header bridge publishes one per destination
  (`lib/split-bridge.ts`). The same bridge carries the drag handler the strip
  passes a tab to when it leaves the strip. Closing a pane clicks that pane's
  own "Close pane" button.
- **bb's Close on a lone page.** Since bb 0.45 a page shown on its own has
  the same "Close pane" button, and it opens New Thread. On a plugin tab the
  strip answers it first, from a capture-phase click listener on the
  document, and closes the tab instead (`lib/shell.ts`). A lone page is one
  with a single `[data-split-pane-id]` pane. If bb renames the button, bb's
  own behaviour comes back.

If bb renames any of these, the likely failure is an element drawn under the
strip or a sidebar that stops collapsing, not a broken app. If another
navigation plugin is chosen, the strip shows only Threads.

## Development

```sh
npm install
npm test                          # the tab model: tests/tabs-model.test.ts
npm run typecheck
bb plugin install .
bb plugin dev .                   # rebuild + reload on save
```

`lib/tabs-model.ts` holds every rule the strip follows: which tab a route
belongs to, what closing and reopening do, and what the sidebar does on each
switch. Everything else is wiring.

## License

MIT. See [LICENSE](../../LICENSE).
