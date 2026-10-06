# Plugin Triage

New plugins land in the BB Community store every day, and the store shows them
all at once. Plugin Triage deals them to you one at a time, newest first, in a
**Triage** tab inside bb's Plugins screen. Drag a card right to install it in
the background, left to dismiss it, or up to save it for later.

## Install

```sh
bb plugin install "git:https://github.com/matthewdias/bb-plugins.git@*" \
  --subdirectory plugins/plugin-triage --tag-prefix plugin-triage/
```

Then open **Plugins** and choose **Triage** in its sidebar.

## Using it

| | Drag | Key |
| --- | --- | --- |
| Install in the background | right | → |
| Dismiss | left | ← |
| Save for later | up | ↑ |
| Show the overview | | Space or Enter |
| Leave the overview | | Escape |
| Undo the last decision | | Z |

The buttons under the deck do the same. A card leads with the plugin's first
screenshot: tap it to open every screenshot full screen, and swipe or use the
arrows to move through them. Pinch, double-tap, pinch on a trackpad or ⌃-scroll
to zoom in (+, − and 0 work too); a zoomed screenshot pans under your finger
or the wheel. Tap the description to read the whole listing.
On the card on top:

- **Details** expands the plugin's long overview and every screenshot.
- **Vet** starts a new thread with a prompt asking an agent to review the
  plugin's code and give a verdict, without installing it.
- **Open** opens the plugin's page on getbb.app, or its repository for a
  third-party store.

On a phone, drag the card itself: bb's swipe-to-open sidebar and side panel
leave drags that start on the deck alone. In bb's iOS and Android apps the
deck gives haptic feedback: a tick as a drag crosses into a decision, a thud
when one lands (firmer for an install), and a success or error buzz when an
install finishes. bb's own haptics setting turns it off. In a phone's browser
Android vibrates instead; iOS Safari has no way to.

An install waits five seconds before it starts, so a slip can be undone. bb
installs plugins one at a time, so several queued installs run in turn. The
queue lives on the bb server: it keeps going if you close the window, and it
picks up where it left off if the plugin reloads. A toast reports each result
in every open window. A failed install puts the card back in the deck with the
error.

**Saved** lists the plugins you saved, most recent first, as cards like bb's
own. Click one to open its full listing in bb's detail pane beside the list,
or install it from the card. The ⋯ menu vets it with an agent, opens its page,
or removes it from Saved.

**Show incompatible** adds plugins that need a newer bb, with the reason.

**Updates** deals the installed plugins that have a newer compatible version,
as cards showing the version now and the one on offer, any newer release bb
won't take and why, and the last attempt if it failed. For a GitHub source
the card on top also lists what the update changes: the commits between the
two versions that touch the plugin (when it shares a repository with other
plugins, only those in its own folder), and the release notes when the new
version is a release. An update that touches nothing of the plugin's says so,
so it can be skipped with confidence. **Changes** opens the full comparison
on GitHub; **Details** opens the plugin in bb's detail pane.

The lists come from GitHub's API. To get its 5,000-an-hour limit rather than
the 60 GitHub allows without a login, Plugin Triage uses this machine's
GitHub login the way bb does for git: `GH_TOKEN` if it is set, otherwise
`gh auth token`. The token stays in memory and is only sent to
api.github.com, for read-only lookups; turn **Use this machine's GitHub login
for update change lists** off in the plugin's settings to look up without
one. Either way a card's changes are fetched only once it has stayed on top
for a moment, so skimming the deck costs nothing; each range is fetched once
and kept; and when fewer than ten requests are left in the hour, cards offer
**Load changes** instead of spending them.

| | Drag | Key |
| --- | --- | --- |
| Queue the update | right | → |
| Skip this version (it comes back when a newer one is out) | left | ← |
| Remind me in a week | up | ↑ |
| Undo | | Z |

Queued updates wait for **Update all**, then run in the background as one
batch, one plugin at a time, which is how bb applies them. The batch keeps
going if you close the window, and Plugin Triage updates itself last, since
its own update reloads the page. A toast reports each result, a failed or
rolled-back update puts its card back with the reason, and **Recent** lists
what the last batches did. Plugins bb couldn't check are listed apart, each
with a **Retry**; **Check now** asks bb to look again for everything, which
takes a while.

## What counts as new

The first visit looks back 14 days, and anything published before that counts
as seen. After that, every plugin published in any store you've added joins
the deck, unless you already have it installed. A dismissed plugin stays
dismissed until its listing's `updatedAt` changes. A saved plugin stays in
Saved until you install or forget it.

## How it works

The server keeps your decisions and the install queue in the plugin's storage,
and installs through bb's catalog API. Each install sends back the source the
card showed, so bb refuses an install whose listing changed in between.

bb has no slot for a page inside its Plugins screen. The plugin's app overlay
adds a row to that screen's sidebar and portals its page into the screen's
main panel. The row's highlight is worked out from the URL on every change,
so it works alongside other plugins that add rows there, such as Plugin
Shelf's My plugins. If bb changes the screen's markup, the row disappears and
nothing else breaks.

## Development

```sh
npm run typecheck --workspace=bb-plugin-plugin-triage
npm test --workspace=bb-plugin-plugin-triage
cd plugins/plugin-triage && bb plugin install . && bb plugin dev
```
