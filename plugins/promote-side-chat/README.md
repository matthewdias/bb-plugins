# Promote Side Chat

A side chat is a good place to ask about something without derailing the
thread. Sometimes the question turns out to be its own piece of work. Promote
Side Chat turns that side chat into an ordinary thread: it shows up in the
sidebar, it carries the conversation forward, and it stays when the main
thread is archived.

## Install

```sh
bb plugin install "git:https://github.com/matthewdias/bb-plugins.git@*" \
  --subdirectory plugins/promote-side-chat --tag-prefix promote-side-chat/
```

With `--tag-prefix`, the range `*` resolves to the newest
`promote-side-chat/vX.Y.Z` tag, so this line stays correct as the plugin
releases and `bb plugin update` follows it.

## What it does

**A control in the thread header.** While a thread has side chats with
something in them, its header shows the side-chat icon and a count. Click it
for a list of the thread's side chats, each showing the first thing you asked
and how long ago. A side chat you opened but never wrote in isn't listed, and
the control disappears once there's nothing to promote.

**Two ways to promote.** **Promote** keeps the new thread in the main
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

## For agents

```sh
bb promote-side-chat                          # this thread's side chats
bb promote-side-chat list --thread thr_…      # another thread's
bb promote-side-chat promote thr_side         # promote one, same checkout
bb promote-side-chat promote thr_side --worktree --title "Fix CI"
```

Each command takes `--json`. The bundled `promote-side-chat` skill tells
agents to promote only when the user asks.

## Development

```sh
npm install
npm run typecheck --workspace=bb-plugin-promote-side-chat
npm test --workspace=bb-plugin-promote-side-chat
cd plugins/promote-side-chat && bb plugin install . && bb plugin dev
bb plugin logs promote-side-chat -f
```

## License

MIT. See [LICENSE](../../LICENSE).
