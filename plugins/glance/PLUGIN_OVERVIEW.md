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
start a thread with a prompt in a project you pick. The thread runs in a
permission mode you choose here (by default one that asks before running
commands), whatever the project's own default is.

## How to pair

Click **Pair Glance** below, or **Pair with bb on this Mac** in Glance. Links
carry a one-time code that expires in two minutes, never the token itself.
