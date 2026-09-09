---
name: workflow-stages
description: Move a bb thread between the user's workflow stages in the Ribbon sidebar. Use when work in this thread clearly reaches another stage (planning finished, change written, review started, work finished), or when asked which stage a thread is in. The live stage list and each stage's rule arrive in the thread's instructions, not here.
---

# Moving a thread between workflow stages

The user's sidebar files every root thread under exactly one stage. The stage
list, each stage's id, and the rule for what belongs in it are injected into
this thread's instructions by the Workflow Stages plugin — read them there,
because the user edits them and this file cannot.

## The protocol

1. File the thread before your first substantive action. That move is required
   and does not wait for evidence — see below.
2. After that, move only on evidence, not on a guess: `bb stages set <stage-id>`.
   The command acts on this thread's root, so running it from a child thread
   is correct and moves the whole hierarchy.
3. Check before you move: `bb stages show`.
4. A stage marked `user-only` is the user's call. Never file into or out of
   one — `bb stages set` refuses it. Say why the thread belongs there and let
   them move it.

## The first move is not optional

Before your first substantive action in a thread — the first file you edit, the
first plan you write, the first command that changes something — file the thread
for the work you are about to do:

```bash
bb stages show           # where is it now
bb stages set planning   # where the work actually is
```

This move is predictive, and that is the point. You have observed no transition
yet, so the evidence rule below would say "wait" — and a whole planning session
would pass with the thread sitting where nobody can see it was picked up. Decide
from what you are about to do, not from what has happened.

If no stage describes what you are about to do — a question, a code read, a
chore that fits none of them — leave the thread in the default stage. That
escape is for no stage fitting. It is not for being unsure which of two fits:
there, pick the likelier one and correct it at the next transition.

## Every later move is evidential

After the first, move at the moment the work changes kind, not at the moment you
plan to change it: after the plan is agreed, not while writing it; after the
change is written, not while testing it. One move per transition is enough.

Do not move a thread to announce progress. If the current stage still
describes the work accurately, the sidebar is already right.

## What not to do

- Do not rename, reorder, add, or delete stages. That is the user's workflow,
  edited in Settings → Plugins → Workflow Stages.
- Do not move another thread than the one you are working in unless asked.
- Do not treat a failed `bb stages set` as fatal: report it and carry on. The
  sidebar plugin may simply not be running.
