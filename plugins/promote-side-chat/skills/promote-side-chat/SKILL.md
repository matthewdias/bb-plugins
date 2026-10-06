---
name: promote-side-chat
description: Promote one of a bb thread's side chats into an ordinary, independent thread with `bb promote-side-chat`. Use only when the user asks to promote, keep, or turn a side chat into its own thread, or asks which side chats a thread has.
---

# Promoting a side chat

A side chat is a hidden fork of a thread, opened from the thread's side panel.
bb archives it whenever its main thread is archived. Promoting forks it into a
visible root thread that keeps the conversation (in its timeline and its
agent's context) and survives the main thread, then archives the side chat.

Promote only when the user asks. It creates a thread and archives another, so
it is the user's call, not a cleanup step.

```bash
bb promote-side-chat                       # side chats of this thread
bb promote-side-chat list --thread <id>    # side chats of another thread
bb promote-side-chat promote <side-chat-id>
bb promote-side-chat promote <side-chat-id> --worktree   # new worktree, default branch
bb promote-side-chat promote <side-chat-id> --title "Fix CI"
```

- `list` prints `<side-chat-id>  <first thing the user asked>`, newest first.
  Side chats with no messages are left out.
- `promote` prints `Promoted <side-chat-id> to <new-thread-id>: <title>`,
  plus a `Warning:` line for any cleanup step that failed. Promoting again
  prints `Already promoted …` with the same thread.
- Without `--worktree`, the new thread shares the main thread's checkout.
  Pass `--worktree` when it will edit files while the main thread does too.
- It refuses a side chat that is mid-reply, has queued messages, or is empty.
  Tell the user why instead of retrying.
- Every command takes `--json`.
