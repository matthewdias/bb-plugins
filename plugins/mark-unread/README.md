# Mark Unread

You read halfway down a thread and get pulled away. bb can mark the whole
thread unread, but when you come back it starts you at the top. Mark Unread
works like Slack: pick the message where you stopped, and the thread shows as
unread with a **New** line above that message. When you come back, it scrolls
you there.

## Install

```sh
bb plugin install "git:https://github.com/matthewdias/bb-plugins.git@*" \
  --subdirectory plugins/mark-unread --tag-prefix mark-unread/
```

With `--tag-prefix`, the range `*` resolves to the newest `mark-unread/vX.Y.Z`
tag, so this line stays correct as the plugin releases and `bb plugin update`
follows it.

## Use

- **From the message.** Hover a message and choose **Mark unread from here**
  in its action bar.
- **With a click.** Hold Option (Alt outside macOS) and click a message.
  Clicks on links and buttons, and clicks inside a text selection, are
  left alone.

Either way the thread gets bb's unread dot in the sidebar and the **New** line
appears.

The **New** line goes above the message you picked. A message you sent is
never unread to you, which is bb's own rule, so marking one of yours puts the
line above whatever answered it.

When you leave and come back, the thread opens at the **New** line. Leaving
again forgets the point, the way Slack does once you have seen it. Marking a
thread while you are in it keeps the point until you have left and come back.

To drop a point without visiting, run **Mark Unread: clear this thread's read
point** from the palette (Mod+Shift+P) while the thread is in view.

## Settings

**Click a message to mark it unread while holding**: Option (the default),
Command, Shift, or Off. Only that key may be held: Option+Shift-click does
nothing, so other shortcuts keep working. Control is not offered because on a
Mac Control-click is a right-click.

## How it works

bb draws its own **New** divider from the thread's `lastReadAt`. Its public
API can only set that to now (read) or clear it (unread from the top), so a
plugin cannot point bb's divider at a message. Mark Unread stores the message
itself, calls bb's `markUnread` for the sidebar dot, hides bb's top-of-thread
divider while it has a point for the thread, and draws a copy of bb's divider
above the message, with the same label, size and theme colour.

bb only renders the messages near the screen, and in a long thread loads
older ones only as you scroll up to them, so on arrival the plugin scrolls the
timeline until the message renders, waiting at the top while bb loads more. If it still can't find it,
for example because the message was removed, a toast says so.

Points are stored on the server, one per thread, so they follow you across
windows and devices. Deleting a thread deletes its point.

### What it relies on

The divider and the click both read bb's private timeline markup: the
`data-timeline-row-id` on each row, the `data-page-scroll-viewport` scroller
and the divider's `data-testid`. They were verified against bb 0.45.0. A bb
release that renames them breaks the divider and the click, but not the
action-bar entry or the sidebar dot. If bb's API ever lets `markUnread` take a
position, the plugin can use bb's own divider instead.

## Development

```sh
npm test --workspace=bb-plugin-mark-unread
cd plugins/mark-unread && bb plugin install . && bb plugin dev
```
