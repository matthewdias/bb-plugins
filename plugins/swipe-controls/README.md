# Swipe Controls

Triage the sidebar the way you triage mail. Swipe a thread right to mark it
read, left for the actions you keep on bb's thread rows: pin, archive,
rename, or whatever you chose. On the desktop app, swipe the page with two
fingers to go back and forward. In bb's phone app, a swipe ticks under your
finger as it reaches the point where letting go acts.

## Install

Needs bb 0.46 or later. On bb 0.45, 0.1.1 is the last version that installs.

```sh
bb plugin install "git:https://github.com/matthewdias/bb-plugins.git@*" \
  --subdirectory plugins/swipe-controls --tag-prefix swipe-controls/
```

## Using it

### Sidebar threads

With a finger on a phone or two fingers on a trackpad:

- **Swipe right** to mark a thread read, or unread if it is already read.
  Short of the mark, the row springs back and nothing happens.
- **Swipe left** to uncover your row actions, such as **Pin** (or
  **Unpin**) and **Archive**. Let go past halfway and the row stays open on
  them. Tap one, or tap anywhere else to close the row. A tap on the open row
  closes it without opening the thread.
- **Swipe all the way left** to archive when you let go. Archive takes over
  the strip once you're far enough. bb's own toast offers **Undo** for ten
  seconds. A thread with children asks first, as bb's Archive always does.

Read and Archive are the defaults for the two whole swipes. Each is a
setting, and can be any of bb's own thread actions or nothing.

A quick flick counts as much as a long drag, and a flick back the other way
cancels. On a trackpad the two whole swipes take more: past the buttons the
row holds still for a moment, as if caught on them, and from there, and on
a swipe right, it moves slower than your fingers. A flick that carries on
with momentum opens the row rather than archiving it. Scrolling the list, Escape and resizing the window all close an open
row.

### Which actions

**The buttons** a swipe left uncovers are the actions you picked for bb's
thread rows: a row's actions menu, then **Customize row actions**, or
`bb thread-list prefs set rowActions '["bb--core/pin","bb--core/archive"]'`.
Each has bb's own name, icon and behaviour:

| Row action | Button |
| --- | --- |
| Pin, Archive, Rename, Open in split, Copy thread link, Mark read | One each, in the same order as bb's. Rename opens bb's rename dialog. |
| Another plugin's action | Grey, or red if the plugin marks it destructive. |
| Move to section | Left out. It asks which section, and a swiped row has nowhere to ask. |

**The two whole swipes** are Swipe Controls' own settings, **Swipe right**
and **Swipe all the way left**. Each is one of Mark read / unread, Pin,
Archive, Rename, Open in split, Copy thread link, Delete, or Nothing. Neither
has to be one of your row actions.

- The action a swipe right runs isn't repeated as a button.
- When the full swipe's action is one of the buttons, that button moves to
  the outer end, where the swipe comes from, and takes over the strip. When
  it isn't, the action appears there once you've swiped far enough.
- Archive takes its row out with it. Any other action runs and the row eases
  back.
- With Nothing, that swipe doesn't happen: a row with no buttons and no full
  swipe doesn't swipe left at all.

bb decides which actions apply to a thread, so one it leaves out there (Open
in split on a phone) is left out here, and one it disables shows dimmed. A
change applies from the next swipe. When bb's thread list is off or replaced,
the buttons are Mark read, Pin and Archive.

**bb's own row buttons** are hidden while thread swipes are on, since a swipe
offers the same actions and the title gets their room, on hover too. The
row's menu stays, and so does an archived thread's Unarchive button, since
archived threads don't swipe. **Hide bb's row buttons** turns that off.

While a row is swiped its corners are square, so it meets what it uncovers
without a notch. They are rounded again when it closes.

Swipes work with bb's thread list and with any list that replaces it. They
leave alone a row bb has armed for drag-to-reorder after a long press, and
the rename field inside a row.

### Back and forward

On the desktop app, two fingers across the page, not the sidebar, go back
(right) and forward (left), as in a browser. An arrow slides in from the edge
it will go towards and fills as you swipe. It goes once the arrow is full,
and only once per swipe: keep your fingers down and keep moving, and nothing
more happens until the trackpad has been still for a quarter of a second. When there
is nowhere to go, there is no arrow.

A code block or diff that can still scroll sideways keeps the swipe. Once it
reaches its edge, the swipe goes through, as a browser's own does.

This is off in a browser by default, because Chrome and Safari already do it.
On a phone, bb uses the same swipe to open its sidebar, so this stays out of
the way there.

### On a phone

bb closes its sidebar with a leftward swipe. With **On a phone, swipe threads
left** on (the default), a leftward swipe that starts on a thread swipes the
thread, and the sidebar closes from its header, from empty space, or with a
tap beside it. Turn it off and threads only swipe right, so every leftward
swipe closes the sidebar as before.

### Haptics

| Where | |
| --- | --- |
| bb's iOS and Android apps | A tick as a swipe arms or disarms, and a firmer one when a full swipe archives. The app's own Haptics setting still applies. |
| Android browsers | The same, as short vibrations. |
| iOS Safari | None. Safari has no API for it. |
| Trackpads | None. Neither Chromium nor bb's desktop app gives a page any way to drive the trackpad's haptics. |

## Settings

| Setting | Default | |
| --- | --- | --- |
| Swipe sidebar threads | On | Every row swipe. |
| Swipe right | Mark read / unread | Any of bb's own thread actions, or Nothing. |
| Swipe all the way left | Archive | Any of bb's own thread actions. Nothing: swiping left only uncovers the buttons. |
| On a phone, swipe threads left | On | Rows take leftward swipes from bb's sidebar. Off: rows only swipe right. |
| Hide bb's row buttons | On | bb's quick-action buttons on a thread row, while thread swipes are on. |
| Swipe with two fingers to go back and forward | In the desktop app | Or Always, or Never. |
| Haptic feedback | On | Where bb can play it. |

Settings are shared by every client.

**Swipe all the way left** replaces 0.1's on/off **Swipe all the way left to
archive**. If you had that off, set the new one to Nothing.

## How it works

One app overlay, mounted once per window, holds the SDK hooks: the settings,
the sidebar's threads, and bb's thread actions. It runs a plain-DOM
controller (`lib/controller.ts`) that listens for wheel and touch events on
the document.

Which actions a row offers is the thread-list plugin's `rowActions`
preference, a list of thread action keys, read through its `listPreferences`
RPC with `sdk.plugins.callRpc` (`lib/row-actions.ts`). A plugin can call
another plugin's RPC but not hear its realtime signals, so the overlay reads
the preference again on load, on reconnecting, when the window comes back
into focus, and when a swipe starts on a row. Those reads are at most once a
second.

What each action is for one thread is bb's to say:
`experimental_useThreadActions(thread, { keys })` returns its label, icon,
whether it is disabled, and a `run`. So every button does exactly what bb's
menu does, Archive's Undo toast included, and Swipe Controls has no pin,
archive or rename code of its own. The hook takes one thread, and the
controller asks about a row from an event listener with the swipe already
moving, so the overlay renders a component for that thread with `flushSync`
and answers from what it rendered. The icons are bb's too: the row view
leaves an empty slot for each, and the overlay draws bb's icon into it
through a portal.

A sliding row is bb's own element, moved with the CSS `translate` property
and clipped as it goes, so its title and glyphs move with it. The buttons it
uncovers are drawn in a fixed layer on `<body>` over the strip it leaves.
When the swipe ends, every inline style goes back exactly as found.

### What it depends on that the SDK does not promise

- **Rows.** A row is found by `[data-sidebar-thread-id]`, which the SDK does
  require of every thread list. The whole row is the nearest
  `[class~="group/thread-row"]` around it, bb's row container. Another list
  can mark its own with `data-swipe-controls-row`. Without either, the
  anchor alone slides.
- **The main pane** is `[data-sidebar="inset"]`.
- **Row actions** come from the plugin `thread-list`'s `listPreferences`
  RPC, as `preferences.rowActions`. If that can't be read, rows offer read,
  Pin and Archive. The whole swipes' settings name bb's own actions by key,
  `bb--core/read`, `bb--core/archive` and the rest.
- **bb's row buttons** are `[data-thread-action]` inside a row's
  `[data-sidebar-row-controls]`. That is what **Hide bb's row buttons**
  hides, with a rule under an attribute on `<html>`. bb pads the title on
  hover by `--bb-sidebar-hover-actions-inset`, set inline on the wrapper
  around `[data-sidebar-thread-id]`, and the same setting zeroes it. An
  archived row's Unarchive button is outside those controls and stays.
- **A row's rounded corners** are the row element's own `border-radius`.
- **bb's sidebar swipe** skips anything inside `[data-no-sidebar-swipe]`. That
  is how rows take leftward swipes: the plugin marks each row, and unmarks
  them when it stops.
- **Long-press reorder** marks a row `data-sidebar-touch-armed="true"`.
- **bb's mobile app** injects `window.bb.native`. Haptics post
  `{ type: "haptic", kind }` to it when its handshake lists `haptic`.
- **The desktop app** injects `window.bbDesktop`, which is how "In the
  desktop app" tells it apart from a browser.

Any of these changing means a gesture stops working, not a broken app.

Anything that wants horizontal drags to itself can carry
`data-no-swipe-controls`.

## Development

```sh
npm install
npm test             # recognizers, row model, targets, the controller and the overlay, in jsdom
npm run typecheck
bb plugin install .
bb plugin dev .      # rebuild + reload on save
```

`lib/wheel.ts`, `lib/touch.ts` and `lib/row.ts` hold every threshold, as
plain functions. How sticky a trackpad's whole swipes are is `WHEEL_ROW` in
`lib/row.ts`. `lib/controller.ts` is the wiring, tested by firing real
wheel and touch events at it.

## License

MIT. See [LICENSE](../../LICENSE).
