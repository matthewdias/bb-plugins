# Swipe Controls

Triage the sidebar the way you triage mail. Swipe a thread right to mark it
read, left to pin or archive it. On the desktop app, swipe the page with two
fingers to go back and forward. In bb's phone app, a swipe ticks under your
finger as it reaches the point where letting go acts.

## Install

```sh
bb plugin install "git:https://github.com/matthewdias/bb-plugins.git@*" \
  --subdirectory plugins/swipe-controls --tag-prefix swipe-controls/
```

## Using it

### Sidebar threads

With a finger on a phone or two fingers on a trackpad:

- **Swipe right** to mark a thread read, or unread if it is already read.
  Short of the mark, the row springs back and nothing happens.
- **Swipe left** to uncover **Pin** (or **Unpin**) and **Archive**. Let go
  past halfway and the row stays open on them. Tap one, or tap anywhere else
  to close the row. A tap on the open row closes it without opening the
  thread.
- **Swipe all the way left** to archive when you let go. Archive takes over
  the strip once you're far enough. bb's own toast offers **Undo** for ten
  seconds. A thread with children asks first, as bb's Archive always does.

A quick flick counts as much as a long drag, and a flick back the other way
cancels. Scrolling the list, Escape and resizing the window all close an open
row.

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
| On a phone, swipe threads left | On | Rows take leftward swipes from bb's sidebar. Off: rows only swipe right. |
| Swipe all the way left to archive | On | Off: swiping left only uncovers the buttons. |
| Swipe with two fingers to go back and forward | In the desktop app | Or Always, or Never. |
| Haptic feedback | On | Where bb can play it. |

Settings are shared by every client.

## How it works

One app overlay, mounted once per window, draws nothing and holds the SDK
hooks: the settings, the sidebar's threads, and bb's own thread actions. It
runs a plain-DOM controller (`lib/controller.ts`) that listens for wheel and
touch events on the document. Pin, read and archive are bb's own actions, so
they behave exactly as bb's menu does, Archive's Undo toast included.

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
npm test             # recognizers, row model, targets and the controller, in jsdom
npm run typecheck
bb plugin install .
bb plugin dev .      # rebuild + reload on save
```

`lib/wheel.ts`, `lib/touch.ts` and `lib/row.ts` hold every threshold, as
plain functions. `lib/controller.ts` is the wiring, tested by firing real
wheel and touch events at it.

## License

MIT. See [LICENSE](../../LICENSE).
