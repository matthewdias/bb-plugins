A side chat is a good place to ask about something without derailing the
thread. Sometimes the question turns out to be its own piece of work. Promote
Side Chat turns that side chat into an ordinary thread: in the sidebar,
carrying the conversation forward, and still there when the main thread is
archived.

## What you get

**A control in the thread header.** While a thread has side chats, its header
shows the side-chat icon and a count. Click it to see each side chat by the
first thing you asked in it, and promote the one you want.

**Promote, or promote into a new worktree.** Keep the new thread in the main
thread's checkout, or give it a fresh worktree for work that will edit files
alongside the main thread.

**Nothing lost.** The new thread shows the side chat's messages, and its agent
remembers both the side chat and the main thread up to where you branched off.
It's titled with your first question, and bb takes you straight to it.

**A clean finish.** The side chat is archived and its tab on the main thread
closes. Promoting it again returns the same thread instead of forking twice.

**A `bb promote-side-chat` command.** `list` shows a thread's side chats, and
`promote` promotes one, with `--worktree` and `--title`.

## How it works

bb ties every side chat to its main thread for good: archive the main thread
and the side chat goes with it. So promoting forks the side chat as a visible
thread with no such tie, rather than un-hiding it, then archives the
original. The new thread is a root thread, so its turns don't report back to
the main thread's agent.
