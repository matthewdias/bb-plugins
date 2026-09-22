A sidebar row tells you a thread exists. It does not tell you that its pull
request has failing checks, that someone requested changes, that three
follow-ups on it are still open, or that its worktree is serving a dev server
on :5173. These badges do, without opening anything.

## What you get

Four badge types, each independently switchable, drawn on whichever sidebar
you use — at most two per row by default, since a 260px row runs out of space
before the badges run out of things to say. You choose how many a row may draw
and which types win the slots when more than that have something to show.

**Pull requests.** A glyph coloured by state — green for open, grey for draft,
purple for merged, red for closed. Hovering names the number, state, attention,
and title. You can show the number beside the glyph, or hide merged and closed
pull requests.

**Pull request checks.** A separate glyph for whether the pull request wants
something from you: checks running, checks failed, merge conflicts, changes
requested, merge blocked, or review requested. You can also show a tick when it
is ready to merge, or narrow the badge to problems only, so it speaks solely
when someone has to fix something.

**Follow-ups.** A ring showing how much of a thread's follow-up list is closed —
empty at none done, a visible notch at one left, full green once the list is
clear. You can show the open count beside the ring, or hide the ring once
everything is done.

**Ports.** A plug on threads whose worktree is serving something — green when
it is the app you are developing, hovering to name it ("vite :5173 · 2
others"). By default it ignores backing services and the ephemeral loopback
ports agent processes open, which would otherwise light up on every thread and
say nothing. This is the one badge that ships **off**: it sorts last, and at the
default cap of two it would draw nothing, so turning it on means also raising
the cap or lowering its priority.

## How it works

No sidebar offers a slot for a badge, and this plugin does not ask one to. Every
sidebar publishes a thread id on its rows, so the plugin hangs a mount point off
each row and portals into it. Rows stay entirely the sidebar's business. If a
sidebar stops publishing that attribute the badges disappear and nothing else
changes.

Pull request data comes from BB itself, which owns the lookup, the polling, and
the staleness. Both pull-request badges observe one query per environment, so
running them together costs no extra git-host requests. A thread with no branch,
no environment, or a git-host hiccup shows nothing at all.

Adding a badge type takes two edits and no changes to the host: an entry in the
catalog, and a component that renders nothing when it has nothing to say.

## Requirements

The pull-request badges need a thread whose environment has a branch with a pull
request on a git host BB can reach.

The follow-ups ring reads the Follow Up plugin, and the ports plug reads
Worktree Ports. Without one installed, that badge does not draw and the others
are unaffected. Nothing here scans for a port itself — Worktree Ports already
does the hard part, and its snapshot already says which threads a worktree
carries.
