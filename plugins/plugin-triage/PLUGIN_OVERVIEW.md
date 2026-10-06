New plugins land in the BB Community store every day, and the store shows
them all at once. Plugin Triage deals them to you one at a time, newest
first, in a Triage tab inside bb's Plugins screen. Decide on each with a drag
or a key and move on.

## What you get

**A deck of what's new.** Each card shows the plugin's author, store,
category, install count, when it was published, its description and its
screenshots. Tap the screenshot to see them all full screen, or the
description to read the whole listing. The card on top also shows where its
code comes from: the repository and the version range it tracks, or the
exact tag and commit for a third-party store.

**Three decisions.** Drag a card right, or press →, to install it. Drag it
left, or press ←, to dismiss it. Drag it up, or press ↑, to save it for
later. Installs run in the background, one at a time, and keep going if you
close the window. A toast tells you when each one lands.

**Undo.** An install waits a few seconds before it starts. Press Z, or Undo
on its toast, to take the last decision back.

**Updates in one batch.** An Updates deck deals each installed plugin with a
newer version, showing the version now and next and, for GitHub sources, a
link to the commits in between. Drag right to queue it, left to skip that
version, up to be reminded in a week. Then press Update all: the queue runs
in the background, one plugin at a time, and each result is reported.

**Saved for later.** The Saved list keeps the plugins you swiped up, with
buttons to install one, open its store page, or forget it.

**Vet with an agent.** One button starts a thread that reads a plugin's code
before you trust it: what it registers, what it reaches over the network,
what data it touches, and whether it does what its listing says. Plugins run
with full access to bb, so this is worth doing for anything you don't know.

**A count on the tab.** The Triage row in the Plugins sidebar shows how many
cards are waiting.

## How it works

The first visit looks back 14 days. Anything older counts as seen, so you
start with a short deck rather than the whole store. After that, every newly
published plugin joins the deck. A dismissed plugin stays dismissed until its
listing changes. Plugins you already have, and ones that need a newer bb,
are left out. A switch shows the incompatible ones, with the reason.

bb has no slot for a page inside its Plugins screen, so Plugin Triage adds
its row to that screen's sidebar and draws its page over bb's. It works
alongside other plugins that do the same thing. If bb changes the screen,
the row disappears and nothing else breaks.
