An agent notices things it is not going to do — work that is out of scope,
blocked, deferred, a risk, or cleanup worth doing later. Those observations
normally live in one reply and are gone by the next turn. This keeps them.

## What you get

A banner above the composer listing what the current thread accumulated, laid
out like bb's Queue card. Each row leads with one action (hand off for
out-of-scope work, put in the composer for the rest), drags to reorder, and
has a ⋯ menu that edits the text in place, marks it done, or dismisses it. Marking a row done or
dismissing it takes its pill back out of your draft. A dismissed row stays
gone: an agent that notices the same thing again cannot re-add it.

Between turns, the card offers what comes next. When an agent's reply ends
with "want me to…?", the answers are buttons under it: press one and it is
sent as your message, or ⌥-click (hold, on a phone) to edit it first. An offer
lasts until the next turn starts, so a button always answers the reply right
above it. When the agent offered nothing, *Do* sends the top follow-up to the
agent now.

Record a follow-up yourself: *Record as follow-up* in the menu beside the send
button, or the *Follow-ups: record the draft* command, files what you typed
and clears the draft. It works on phones too, from a long-press on Send.

An agent that would end its turn with a list of questions, or a list of
things to decide one by one, shows them as a form instead: choices with its
recommendation picked, lists to tick, a ranking, answers to type, and items
each with their own choices and a draft to edit. Answering sends one
message, which the form shows in full first.

Eight agent tools — `record_follow_up`, `list_follow_ups`, `complete_follow_up`,
`prioritize_follow_up`, `amend_follow_up`, `file_follow_ups`,
`offer_next_steps`, and `ask_form`. Agents record as they work, close the rows
they finish, including rows you wrote yourself, offer what they would do
next, and ask with a form.

A `bb follow-up` command covering the same ground from a terminal: `add`,
`show`, `move`, `amend`, `done`, `reopen`, `clear-done`, `describe`, `dismiss`,
`handoff`, `clear`, and `forget`. Each one prints its own options with
`--help`.

The `+` menu's Follow-ups row opens a picker of this thread's open follow-ups:
search, choose one, and its pill goes into the composer.

Palette commands to show or hide the list, open the panel, start a handoff,
take one of the offered next steps, record the draft, open the picker, or wrap
up the thread, each of which you can bind to a key.

Follow-ups in the `@` menu, so a row can be pulled into a prompt by name.
Mentioning one can claim it, marking it in progress as you send.

File a follow-up to wherever you track work: a destination you set up, which
runs a command on the thread's own host (`gh issue create …`) or has a
hidden helper follow your recipe (an MCP, a CLI). Filed rows move to Done with
a link back and are not recorded on that thread again. File one from its menu,
or all at once from the header; an agent can file too, after you confirm.

Wrap up takes a thread to done in one pass. A popup over the composer gives
every open follow-up somewhere to go: filed, handed off to a thread of its
own (here or in a new worktree), done, dismissed, or kept. Then the thread is
archived, once everything sent somewhere has landed. If anything didn't, the
thread stays open, saying why. The Next row offers it when the agent says the
goal is met.

The Follow Up page, from its own item in bb's sidebar, lists every thread
that needs you, one card per thread, and lets you answer it there: a
question's options, an approval (a command, a file change, a permission, a
tool or a plan, shown whole), a form the agent asked with, a checklist
that stopped to wait, the agent's next steps, Wrap up, a retry, a reply. A
pull
request one of your threads opened can be read and commented on line by
line, merged, sent back to its thread to fix or rebase, or given a review
thread. Every message the page sends for you
is shown first, exactly as it will go. Beside the cards are the threads still
working, with what each is doing, and every open follow-up by project,
archived threads included. A thread's workers fold into its card,
except one that is blocked, and merged workers can be archived together. The
sidebar item counts the threads that want something from you, and the
new-thread page shows the first three. Focus deals them one at a time, answered
by keys and taps, with swipes on a phone to skip or put one away.

## How it works

There is no background model call. Capture happens inside a turn the agent is
already running, so the plugin costs nothing to run: no model to choose, no
cooldown, no polling.

Two optional buttons do spend a turn, and only when you press them. *Describe
this in more detail* asks a helper to write a row's detail. *Suggest what's
next* asks the thread's own agent what is worth picking up once the list is
empty. Both run on a model you choose, in the open and stoppable like any other
turn, and both are told that "nothing" is a real answer.

## For other plugins

Each thread's progress is published as the `follow-up/progress` complication, a
small value any plugin can draw that is published again the moment a follow-up
changes. Thread Badges draws it as a ring on sidebar rows, once you turn it on
there.

`getFollowUpCountsV1` is a stable, versioned contract: one request returns open
and done counts for up to 500 threads, every requested thread comes back
including ones with nothing recorded, and repeated ids are deduped in
first-seen order. Read `protocolVersion` before the counts. Everything else in
the RPC surface is this plugin talking to its own frontend and may change shape.

With Thread Pages installed, a session's page can call `follow-up.list` to
show that session's own open follow-ups. It only reads.

## Requirements

None beyond BB. Follow-ups are stored per thread in this plugin's own database
on the BB server, and no account or API key is needed. Nothing leaves the
machine unless you set up a destination and file to it: then it goes where
your command or recipe sends it, and nowhere else.

Command destinations run through a host entry on bb's experimental host API,
so they may need updating when that API settles.
