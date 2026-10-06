# Side Chats

A side chat is a good place to ask about something without derailing the
thread. bb gives you no list of them, though: close a side chat's tab and it's
out of reach, a reply that lands after you've looked away says nothing, and
when the question turns out to be its own piece of work it stays a side chat.
This plugin keeps a thread's side chats in one list, shows which are replying
or have a reply you haven't read, and lets you open, archive, or promote each
one. Promoting turns a side chat into an ordinary thread that carries the
conversation forward and stays when the main thread is archived.

## Install

```sh
bb plugin install "git:https://github.com/matthewdias/bb-plugins.git@*" \
  --subdirectory plugins/side-chats --tag-prefix side-chats/
```

With `--tag-prefix`, the range `*` resolves to the newest
`side-chats/vX.Y.Z` tag, so this line stays correct as the plugin
releases and `bb plugin update` follows it.

## What it does

**A control in the thread header.** While a thread has side chats with
something in them, its header shows the side-chat icon and a count. A spinner
beside the count means one is replying, and a dot means one has a reply you
haven't read. Click it for a list of the thread's side chats, each showing the
first thing you asked, then "replying…", "new reply", or how long ago. A side
chat you opened but never wrote in isn't listed, and the control disappears
once there's nothing to list.

**A "Side chats" panel.** The same list lives in the thread's side panel,
under **Side chats** in the panel's new-tab launcher, beside bb's own **Start
side chat**.

**Open.** Opens the side chat in a panel tab, even after you've closed its
own tab: the conversation with its composer, the message it replies to, bb's
**Send to main thread** on each reply, and **Promote** and **Archive** above
it. Viewing it there marks its reply read.

**Archive.** Discards a side chat you're done with, without promoting it, and
closes its tabs. One that is mid-reply is stopped. bb would otherwise keep a
side chat with messages until its main thread is archived. The toast offers
**Undo** for 8 seconds; archived from its own tab, Undo opens that tab again
too. A side chat can't come back once its main thread is archived, or if it was
promoted, since the promoted thread carries its conversation.

**Two ways to promote.** **Promote to thread** keeps the new thread in the main
thread's checkout, where the side chat already ran. **Promote into new
worktree** gives it a fresh worktree on the same machine, branched from the
project's default branch, for work that will edit files alongside the main
thread.

**What you get.** bb takes you to the new thread. Its timeline shows the side
chat's messages, and its agent remembers both the side chat and the part of
the main thread that preceded it. It's titled with the first thing you asked
in the side chat. It is a root thread, not a child of the main thread, so its
turns don't report back to the main thread's agent.

**What happens to the side chat.** It's archived, and its tab on the main
thread closes. If either step fails, the new thread still stands and you see a
warning.

**Why it forks instead of un-hiding.** bb ties a side chat to the main thread
for good: archive the main thread and the side chat goes with it, and nothing
can change that. A side chat made visible in place would still vanish with its
main thread. A fork has no such tie.

**When it refuses.** A side chat that is mid-reply, has queued messages, or
has no messages yet can't be promoted. Wait for the reply, or send or delete
the queued messages, then try again. Promoting the same side chat twice
returns the thread it was promoted to the first time.

**How current the marks are.** Replies starting and finishing reach the
header as they happen. Reading a side chat raises no event a plugin can hear,
so a dot clears when you open the list, when the window regains focus, when
you read it in this plugin's panel, or within 20 seconds while one is showing.

## For agents

```sh
bb side-chats                          # this thread's side chats
bb side-chats list --thread thr_…      # another thread's
bb side-chats promote thr_side         # promote one, same checkout
bb side-chats promote thr_side --worktree --title "Fix CI"
bb side-chats archive thr_side         # discard one
bb side-chats unarchive thr_side       # bring it back
```

`list` marks a side chat `[replying]` or `[new reply]`. Each command takes
`--json`. The bundled `side-chats` skill tells agents to promote or
archive only when the user asks.

## Development

```sh
npm install
npm run typecheck --workspace=bb-plugin-side-chats
npm test --workspace=bb-plugin-side-chats
cd plugins/side-chats && bb plugin install . && bb plugin dev
bb plugin logs side-chats -f
```

## License

MIT. See [LICENSE](../../LICENSE).
