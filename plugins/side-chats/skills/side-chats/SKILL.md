---
name: side-chats
description: List, promote, or archive a bb thread's side chats with `bb side-chats`. Use when the user asks which side chats a thread has or whether one has replied, or asks to promote, keep, or turn a side chat into its own thread, or to archive or discard one.
---

# Managing a thread's side chats

A side chat is a hidden fork of a thread, opened from the thread's side panel.
bb archives it whenever its main thread is archived. Promoting forks it into a
visible root thread that keeps the conversation (in its timeline and its
agent's context) and survives the main thread, then archives the side chat.
Archiving discards it.

Promote or archive only when the user asks. Each creates or removes something
the user sees, so it is their call, not a cleanup step.

```bash
bb side-chats                       # side chats of this thread
bb side-chats list --thread <id>    # side chats of another thread
bb side-chats promote <side-chat-id>
bb side-chats promote <side-chat-id> --worktree   # new worktree, default branch
bb side-chats promote <side-chat-id> --title "Fix CI"
bb side-chats archive <side-chat-id>
```

- `list` prints `<side-chat-id>  <first thing the user asked>`, newest first,
  with `[replying]` or `[new reply]` before the text when either applies. Side
  chats with no messages are left out.
- `promote` prints `Promoted <side-chat-id> to <new-thread-id>: <title>`,
  plus a `Warning:` line for any cleanup step that failed. Promoting again
  prints `Already promoted …` with the same thread.
- Without `--worktree`, the new thread shares the main thread's checkout.
  Pass `--worktree` when it will edit files while the main thread does too.
- `promote` refuses a side chat that is mid-reply, has queued messages, or is
  empty. Tell the user why instead of retrying.
- `archive` stops a side chat that is mid-reply. It refuses one already
  archived.
- Every command takes `--json`.
