# Declutter

Every plugin you install can add a control to the thread header, a banner
above the composer, or a button on every message. bb has no setting to choose
among them: the sidebar footer has a More menu, but these three surfaces show
everything that is registered. Declutter gives you a switch for each one, bb's
own included.

## Install

```sh
bb plugin install "git:https://github.com/matthewdias/bb-plugins.git@*" \
  --subdirectory plugins/declutter --tag-prefix declutter/
```

With `--tag-prefix`, the range `*` resolves to the newest `declutter/vX.Y.Z`
tag, so this line stays correct as the plugin releases and `bb plugin update`
follows it.

## Use

Open the list one of two ways:

- **Beside the thread.** Run **Declutter: choose which actions and banners
  show** from the palette (Mod+Shift+P), or pick **Declutter** from the right
  panel's new-tab list. The thread stays in view, so each switch shows its
  effect as you flip it.
- **In Settings.** Settings → Installed plugins → Declutter.

The list has three groups:

| Group | What is in it |
| --- | --- |
| Thread header | Each plugin's control, and bb's own buttons: Thread actions, Open in your editor, Commit, Close pane, Show right panel |
| Banners above the composer | One row per plugin that draws a banner there |
| Message actions | Every button in a message's action bar, bb's and plugins' alike |

Switch a row off and it is hidden in every window and on every device. **Show
everything** at the bottom turns them all back on.

The list fills in as you use bb: each window notes what it has on screen, so a
control appears once you have opened a thread that shows it. A banner that
only appears sometimes, such as one for a pull request, is listed after it has
shown once.

## Good to know

- **Hidden, not disabled.** The plugin still runs. Its keyboard shortcuts and
  palette commands still work, and a message action you hide from the bar is
  gone from that bar only.
- **Banners go by plugin.** bb does not mark which of a plugin's banners is
  which, so a plugin with two banners has one switch for both.
- **bb's own banners are not listed.** Only plugin banners carry a marker.
- **A button whose name changes is two rows.** Show right panel and Hide right
  panel are separate rows, because bb gives them different names.
- **Hiding Thread actions or Message actions hides their menus too.** Rename,
  archive, fork and Add to chat live behind them.

## How it works

bb draws every registered header control, banner and message action, so the
only lever is CSS. Declutter keeps one stylesheet that sets `display: none` on
what you switched off, keyed on attributes bb sets on purpose: the
`data-bb-plugin` wrapper around each plugin's control, the `aria-label` on each
button, and data hooks on the header, the composer and the message bar. It
never matches on class names. One case needs script: a header button named only
by its text, such as Commit, is tagged by the overlay while it is hidden.

The catalog of what has been seen and the list of what is hidden are kept on
the server, so every window agrees, and the hidden list is also cached in the
browser so a reload hides things before the server answers.

If a bb release renames one of those attributes, the cost is that the item
shows again, not a broken app. The real fix is a bb setting for these
surfaces, like the sidebar footer's More menu; until then this fills the gap.
