bb puts every destination in the sidebar, beside the threads. Open GitHub and
your thread is gone. Go back and GitHub forgets the pull request you were
reading. Top Tabs moves the destinations into tabs across the top of the
window. Keep several open, switch between them, and each one comes back where
you left it.

## What you get

**Threads is a tab.** It is first, it never closes, and it is bb as you know
it: the sidebar, the thread list, the thread in view. While another tab is in
view, it names the thread it will return to, counts what is waiting on you
and what is running, and opens a switcher on hover. The switcher lists what
needs you, what's running, what finished and where you were, one click from
each.

**Destinations open beside it.** Open plugin panels, Plugins and Skills from
the + button, or reach one any other way and it gets a tab. Drag to reorder,
middle-click to close, Ctrl+Shift+T to reopen.

**Each tab returns to where you left it.** Each tab remembers the exact page
it was on: the pull request inside GitHub, not just GitHub.

**The sidebar gets out of the way.** It slides away on other tabs, so the
destination has the whole window, and returns with Threads, as you left it.
The sidebar keeps bb's own navigation, so you can reorder, hide and split
from it as always.

**Pinned tabs.** Pin the destinations you always want: they sit beside
Threads as icons and never close by accident. Labels can be icons-only, or
only on the tab in view.

**Splits.** Drag a tab down into the page to split it, as you would a
thread, or open one in a split from the + menu. The strip marks every tab that's on screen, with a small map of
which pane it's in. Clicking one focuses its pane.

**Keyboard.** Ctrl+Tab and Ctrl+Shift+Tab switch tabs, and every command is
in the palette.

## How it works

The strip is an app overlay, mounted once per window, outside every route. It
reaches bb's navigation through the sidebar header, where it draws nothing,
and leaves the sidebar's navigation to bb. Tabs are per client.

bb's plugin API cannot reserve room above the app or open and close the
sidebar. So Top Tabs shifts bb's shell down with CSS, and toggles the sidebar
by clicking bb's own toggle. Both are keyed on the strip being on screen, and
both fail soft: if bb changes its markup, the sidebar stops collapsing or an
element slips under the strip, and nothing else breaks.

On a phone the strip steps aside and every destination returns to the
sidebar.
