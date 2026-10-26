# Tab Nav

bb puts every destination in its navigation, beside the threads. Open GitHub
and your thread is gone. Go back to the thread and GitHub forgets the pull
request you were reading. Tab Nav turns bb's rail into tabs. Keep several
open, switch between them, and each one comes back where you left it.

**Threads** is the first tab, and it never closes. It is bb as you know it:
the thread list and the thread in view. Every other tab is a destination —
a plugin panel, Plugins, Skills. Each tab keeps the sidebar as you left it
there: on a destination the thread list folds away to the rail, so the page
gets the window, and it comes back when you return to Threads.

The rail is narrow, icons only, as bb's own Rail is, or wide, with names.
Switch between the two with the button at its foot.

Tab Nav was called Top Tabs until 0.5, when its tabs ran across the top of the
window. The plugin id is still `top-tabs`.

## Install

```sh
bb plugin install "git:https://github.com/matthewdias/bb-plugins.git@*" \
  --subdirectory plugins/top-tabs --tag-prefix top-tabs/
```

Tab Nav needs bb 0.47.1 or later. It is one of bb's navigations, as bb's Rail
and Top list are. With **Settings → Appearance → Navigation** on Automatic,
bb picks Tab Nav unless another navigation plugin came first; otherwise choose
**Tab Nav** there. Tab Nav doesn't change that setting itself. See
[Tab Nav as bb's navigation](#tab-nav-as-bbs-navigation).

On older bb, install an older version: put its tag in place of `@*` and
leave out `--tag-prefix`. Use `@top-tabs/v0.4.0` (the top strip) on bb 0.46,
and `@top-tabs/v0.3.1` on bb 0.45 and earlier.

## Using it

The rail, top to bottom:

- **Threads**, with New thread just below it, or as the pen beside it when
  the rail is wide.
- **Pinned tabs**, then a divider, then your **open tabs**.
- **+**, which opens a tab: it lists every destination bb offers, a dot on
  the ones already open and a pin on the pinned ones. Reaching a destination
  any other way (the palette, its shortcut, a link) opens a tab for it too.
- At the foot, the **width toggle**, then bb's own Settings.

And with it:

- **Open one in a split** from the **+** menu, with the split button on the
  highlighted row or a ⌘-click (Ctrl-click elsewhere), or ⌘-click a tab, as on
  bb's own Rail. Or drag a tab out of the rail into the page.
- **Pin a tab** from its context menu, or with the pin on its row in the
  **+** menu. See [Pinned tabs](#pinned-tabs).
- **Close a tab** with a middle-click, its context menu, bb's own Close at
  the top right of the page, or **Tab Nav: Close tab**. In the wide rail a ×
  shows on hover too. Closing the tab in view moves to the tab below it, or,
  with **After closing a tab, go back to the last one you used**, to the tab
  you were on before it.
- **Reopen a closed tab** with Ctrl+Shift+T, the context menu, or the **+**
  menu. It comes back in the same position, at the same place inside the
  panel. It also undoes a pinned tab's reset.
- **Reorder** by dragging a tab up or down, within its group: pinned tabs
  among pinned, the rest among the rest.
- **Switch** with Ctrl+Tab and Ctrl+Shift+Tab, or the arrow keys once a tab
  has focus.
- **Right-click** a tab to pin or unpin it, close others, close the tabs
  below it, open it in a split, or open the plugin's details.

The first time it runs, Tab Nav opens a tab for each destination bb's
navigation showed, so what you used is where you look for it.

### Narrow and wide

- **Narrow** is bb's rail width: icons, with each tab's name, badge and
  place on hover.
- **Wide** shows names, bb's Settings at the foot included. Threads also
  shows the thread it will return to and its counts. The open sidebar grows
  by what the rail gains, so the thread list keeps its width.

**Drag the rail's right edge** to resize it. Pull a narrow rail out and the
names appear; push a wide one in far enough and they go. Wide, it sizes
between 140 and 360 pixels. Double-click the edge to go back to 200.

The choice and the width are per device, like the tabs. **Tab Nav: Show or
hide tab names** switches from the palette.

### The Threads tab

Clicking Threads returns to the thread you were in, or to the compose screen
if you were there. It shows how threads are doing:

- **Narrow:** one mark on its icon — how many threads need you, or a dot for
  running or finished.
- **Wide:** the thread it returns to under its name, and three counts —
  waiting on you (the amber pill), running, and finished since you last
  looked (red if one failed).

**Rest the pointer on it** for a thread switcher, which is quicker than
scanning a long thread list:

- **Needs you:** threads waiting for an answer.
- **Running:** threads still working.
- **Finished:** threads done since you last looked.
- **Recent:** the threads you were in last.

Each row shows the title, project and how long ago. Picking one goes straight
to it, focusing its pane if a split shows it. **Tab Nav: Switch thread…**
opens the same card from the palette, ready for the arrow keys.

Threads never closes. On Threads, **Tab Nav: Close tab** closes the thread in
view instead, as bb's Close at the top right of the page does, and opens New
Thread. In a split, or already on the compose screen, it does nothing.

### Pinned tabs

A pinned tab is one you always want in the rail:

- It sits just below Threads, above the divider.
- It has a home: where it was when you pinned it, or the panel's start if
  you pinned it before opening it. Once you move away from there, a dot
  appears on its icon. Hovering it tells you where it was pinned, unless that
  was the panel's start.
- Middle-click, close-others and close-below leave it alone, and the wide
  rail draws it without a ×.
- bb's Close at the top right of the page, or **Tab Nav: Close tab**, resets
  it instead, as Arc does. It stays pinned and goes back to its home, so it
  next opens where you pinned it, and the rail moves on past the other pins.
  ⌃⇧T undoes a reset, until you go back to the tab yourself.
- Unpin it from its context menu (or with **Tab Nav: Pin or unpin tab**) to
  make it an ordinary tab again. It lands first among the ordinary tabs and
  forgets its home.

The **+** menu doubles as the pin list. Pinned rows show a filled pin, and
the pin on any row toggles it. The menu stays open, so a set of default pins
takes one visit.

### Badges

A panel can set a badge on its destination, and Tab Nav draws it on the tab
as bb would: on the narrow rail, a count on the icon's corner (9+ above 9) or
a dot; in the wide rail, at the end of the row, with a count up to 99+ or a
short text. The badge's description is read out with the tab's name.

Some plugins draw their own mark on their navigation button instead, such as
Radar's count. It sits on the icon's corner on the narrow rail, as on bb's,
and at the end of the row in the wide one.

### What a tab costs

Close to nothing, pinned or not. A tab is a remembered location. A panel
loads when you switch to it and unloads when you switch away, as it did from
bb's own navigation. bb has no way to keep a page alive in the background, so
ten open tabs cost the same as one.

That's also why a tab comes back at its location rather than its exact
state. A tab is drawn selected the moment you pick it, before bb starts
rendering the page; the render itself takes as long as it does in bb.

### Where tabs return to

Each tab remembers the exact URL it was left at: the pull request inside
GitHub, not just GitHub. Switching back navigates there. Hover a tab to see
where inside its panel it is (`pulls/4`). That's the panel's own address,
because a panel has no way to give bb a title for the page it's on. Closing a
tab forgets the location; reopening it with Ctrl+Shift+T brings it back.

A panel is still a bb page, so switching away unmounts it. A tab keeps its
location, not its scroll position or unsaved input.

### Splits

Tab Nav follows bb's split view:

- **What's on screen.** The focused pane's tab is selected. Any other tab
  showing in a pane is outlined, and in the wide rail both carry a small map
  of the split with their own pane filled.
- **Switching.** Clicking a tab that is already in a pane focuses that pane
  instead of replacing anything. For Threads, that's the pane showing a
  thread.
- **Opening.** Drag a tab out of the rail into the page: that's bb's own
  drag, with bb's drop zones. Or ⌘-click it, or choose "Open in split" from
  its context menu or the **+** menu. For Threads, it opens the thread it
  would return to.
- **Splitting the tab you're looking at.** bb won't show one destination in
  two panes, so its context menu offers a partner: the tab you were on just
  before, or Threads ("Split with Threads"). Your tab stays where it is, and
  the partner opens beside it.
- **Closing.** Closing a tab that is on screen closes its pane too.
- **The sidebar** is left alone while a split is up. It's where you drag
  threads into panes from.

### The sidebar

Each tab keeps the sidebar as you left it:

- **Leaving a tab** remembers whether the thread list was open there.
- **Arriving on a tab** opens it or folds it away to the rail to match.
- **A tab you haven't set** starts with it folded away, so the page gets the
  window. Threads keeps whatever you find there the first time.

The switch is instant rather than a slide, as a browser's tabs switch.
Opening or closing the sidebar yourself still slides. Turn all this off with
**Remember the sidebar on each tab**.

### Tab Nav as bb's navigation

bb draws its destinations with whichever navigation is chosen under
**Settings → Appearance → Navigation**: its own Rail or Top list, or one a
plugin adds. Tab Nav adds one, in the rail column bb lays out.

- **Choose bb's Rail or another navigation** and Tab Nav steps aside,
  leaving bb exactly as it would be without it: nothing drawn, no commands,
  no sidebar moved. Your tabs are kept and come back when you choose Tab Nav
  again.
- **The + menu** lists every destination bb knows, in bb's order, including
  the ones hidden from its navigation. Hiding one leaves its tab alone.
- **To change that order**, choose bb's Rail, use **Customize navigation**,
  and choose Tab Nav again.

On loading, bb draws its own Rail for a moment until plugins have loaded,
then hands over to Tab Nav.

### On a phone

Below bb's `md` breakpoint the sidebar is a drawer, and Tab Nav shows bb's own
Rail there, with every destination. Tabs come back when the window is wide
again. Tab Nav draws bb's Rail through a prop bb has deprecated
(`experimental_Original`); if bb removes it, the drawer goes empty and the
destinations stay in the command palette.

## Settings

| | Default |
| --- | --- |
| Remember the sidebar on each tab | on |
| After closing a tab, go back to the last one you used | off |

**Remember the sidebar** off keeps the sidebar wherever you leave it. The
tabs work the same either way.

**After closing a tab, go back to the last one you used** chooses where
closing the tab in view goes. Off, it moves to the tab below it, as a
browser moves to its neighbour. On, it returns to the tab you were on
before it, as VS Code does, Threads included. Closing a pinned tab follows
it too, skipping the other pins.

Narrow or wide is not a setting but a toggle at the rail's foot, kept per
device.

## Commands

All are in bb's command palette, and every shortcut can be rebound under
**Settings → Keyboard**.

| Command | Default shortcut |
| --- | --- |
| Tab Nav: Next tab | Ctrl+Tab |
| Tab Nav: Previous tab | Ctrl+Shift+Tab |
| Tab Nav: Reopen closed tab | Ctrl+Shift+T |
| Tab Nav: Go to Threads | — |
| Tab Nav: New thread | — |
| Tab Nav: Switch thread… | — |
| Tab Nav: Open a tab… | — |
| Tab Nav: Close tab (on Threads: close the thread in view; on a pinned tab: reset it) | — |
| Tab Nav: Pin or unpin tab | — |
| Tab Nav: Show or hide tab names | — |

In a web browser, the browser keeps Ctrl+Tab and Ctrl+Shift+T for itself.
Rebind them there if you want them.

On Windows and Linux, bb's ⌘ is Ctrl, so the side panel's reopen-closed-tab
is Ctrl+Shift+T too. bb leaves a plugin's conflicting default unbound, so
Reopen closed tab starts without a shortcut there. Give it one under
**Settings → Keyboard**.

## How it works

Two registrations:

- An `experimental_sidebarNavigation` with `placement: "rail"`
  (`components/TabRail.tsx`). bb lays out the rail column, keeps it when the
  sidebar collapses, and draws Settings at its foot; Tab Nav draws the tabs
  in it. Inside the sidebar bb lends its navigation model
  (`experimental_useSidebarNavigation`) and its split drag
  (`experimental_useSidebarNavigationSplit`) directly.
- Palette commands drive the rail from the keyboard.

Tabs are per client and live in localStorage. The tabs on your phone are not
the tabs on your desktop.

### What it depends on that the SDK does not promise

- **The wide rail.** bb derives the rail column's width, the collapsed
  sidebar's width and the page header's offset beside it from
  `--bb-sidebar-rail-padding`. Wide mode raises it while a class on `<html>`
  says the rail is wide, and widens the open sidebar by the same amount
  (`--sidebar-width`, which bb sets inline) so the thread list keeps its
  room. bb's Settings button under the rail gets its name from CSS. If bb
  changes these, the rail stays narrow and the names hide.
- **The sidebar.** `lib/shell.ts` reads the attributes bb's sidebar primitive
  publishes (`data-side`, `data-state`, `data-collapsible`). It toggles the
  sidebar by clicking bb's own toggle, so bb's state stays the only source of
  truth. If an element is missing, Tab Nav leaves the sidebar alone.
- **Returning to a location.** bb routes with React Router. `lib/location.ts`
  pushes a history entry and dispatches `popstate`, which React Router treats
  as an ordinary navigation.
- **Splits.** `useSidebarSplitLayout()` says which panes show threads, and
  bb's split hook which panes show each destination. Closing a pane clicks
  that pane's own "Close pane" button.
- **bb's Close on a lone page.** A page shown on its own has a "Close pane"
  button that opens New Thread. On a plugin tab Tab Nav answers it first,
  from a capture-phase click listener on the document, and closes the tab
  instead. If bb renames the button, bb's own behaviour comes back.

If bb renames any of these, the likely failure is a rail that stays narrow
or a sidebar that stops folding away, not a broken app.

## Development

```sh
npm install
npm test                          # the tab model and badges: tests/
npm run typecheck
bb plugin install .
bb plugin dev .                   # rebuild + reload on save
```

`lib/tabs-model.ts` holds every rule the rail follows: which tab a route
belongs to, what closing and reopening do, and what the sidebar does on each
switch. Everything else is wiring.

## License

MIT. See [LICENSE](../../LICENSE).
