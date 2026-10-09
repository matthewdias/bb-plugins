A thread's header tells you its title. It does not tell you that its branch is
behind main, that its pull request has failing checks, or that two of its
follow-ups are still open. Thread Summary puts all of that in one card under
the header, and the most urgent of it beside the button.

## What you get

**A card under the header.** One button in the thread header shows a small
frosted card, top right of the thread, over the chat; press it again to hide
it. It shows one line per source: an icon in a square tinted with the source's
colour, a headline, and its status as a coloured pill, with any details a
source adds underneath. Showing it is remembered on this device, so it stays
through thread switches and reloads until you hide it, and a click elsewhere
leaves it be.

**Your branch.** One line: the branch against the one it merges into, and how
many commits it is ahead and behind. It turns amber when the branch is behind
or has uncommitted work.

**Your pull request.** One line: its number and title, linked to the pull
request, and what it needs most — checks failing, checks running, changes
requested, review requested, ready to merge and so on, coloured to match.
bb's own Info panel has the rest of the detail for both, and acts on it.

**What other plugins publish.** Any plugin can publish a small value about a
thread, called a complication, and the card draws it with no setup. Follow Up
0.7 and later publishes its progress ring this way. You can hide any source in
this plugin's settings.

**Chips beside the button.** Up to three of the thread's values, worst first,
so you see a failing check without opening anything. Clicking one opens the
card, and while the card shows the chips step aside. In settings choose Text,
Icons only — just the coloured glyphs, with the text in their tooltips — or
Off, where the button carries a dot in the worst colour instead, and no dot
when everything is quiet.

Each pane of a split layout has its own card.

**On a phone.** The card is a drawer from the bottom of the screen, as tall
as it needs up to most of the screen. Swipe it down, tap outside or press its
close button to put it away.

## How it works

The branch comes from bb's own environment status. It is read again when the
card opens, every 20 seconds while it shows, and whenever the thread's
agent finishes a turn. The pull request comes from bb's own lookup, which owns
the polling. Both are published as complications too, so Thread Badges can
draw them on sidebar rows once you turn them on there.

Nothing another plugin publishes becomes a link until this plugin has checked
it: only web addresses and bb's own pages are linked, and only files inside the
thread's workspace.

## Requirements

BB 0.45 or later. The pull-request line needs a thread whose branch has a pull
request on a git host bb can reach. Follow Up's ring needs Follow Up 0.7 or
later.
