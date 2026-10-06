A side chat is a good place to ask about something without derailing the
thread. bb gives you no list of them, though: close a side chat's tab and it's
out of reach, a reply that lands after you've looked away says nothing, and a
question that turns into its own piece of work stays a side chat. This plugin
keeps a thread's side chats in one list and lets you open, archive, or promote
each one.

## What you get

**A control in the thread header.** While a thread has side chats, its header
shows the side-chat icon and a count, with a spinner while one is replying and
a dot when one has a reply you haven't read. Click it to see each side chat by
the first thing you asked in it.

**Open, even after closing.** Reopen any side chat in the side panel, with its
composer and **Send to main thread**, and Promote and Archive above it. The
same list is under **Side chats** in the panel's launcher.

**Archive.** Discard a side chat you're done with, without promoting it, with
Undo on the toast if you change your mind.

**Promote, or promote into a new worktree.** Turn a side chat into an ordinary
thread in the main thread's checkout, or in a fresh worktree for work that will
edit files alongside the main thread. The new thread shows the side chat's
messages, its agent remembers the conversation, and it's titled with your first
question. The side chat is archived and its tab closes.

**A `bb side-chats` command.** `list` shows a thread's side chats and
what each is doing; `promote`, `archive` and `unarchive` act on one.

## How it works

bb ties every side chat to its main thread for good: archive the main thread
and the side chat goes with it. So promoting forks the side chat as a visible
thread with no such tie, rather than un-hiding it, then archives the original.
The new thread is a root thread, so its turns don't report back to the main
thread's agent.
