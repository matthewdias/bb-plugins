bb shows you that an agent is waiting on you only while bb is open. Glance puts
that on your Mac's desktop instead: a widget, a count in the menu bar, and Siri
and Shortcuts actions for the threads that need you.

This plugin is the server half. It serves a small feed of those threads to the
Glance app over HTTP routes protected by a token.

## What you get

**Needs you.** Errored threads, threads with a question or approval pending,
and finished turns you have not read, ranked in that order. This is the same
rule bb's *Needs attention* homepage section uses.

**Running and recent.** What is working right now, and the last ten threads
you touched.

**A narrow credential.** The paired app holds a token that opens these routes
and nothing else. It is not your bb session and cannot open a terminal. Rotate
the token and every paired app is cut off.

**Starting threads, off by default.** Turn it on and Siri or a Shortcut can
start a thread with a prompt in a project you pick. The thread uses that
project's defaults, and a remote caller can never raise its permission mode.

## How to pair

`bb glance pair --server <url>` prints a link. Open it on the Mac running
Glance. The URL is whatever address that Mac reaches bb through.
