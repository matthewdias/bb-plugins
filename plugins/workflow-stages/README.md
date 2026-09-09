# Workflow Stages

Threads pile up, and a sidebar sorted by time tells you when you last touched
something and nothing about where it stands. A stage says where the work is:
still being figured out, being written, waiting on a review, or stopped on
someone else.

This is a grouping provider for the [Ribbon sidebar](https://github.com/ariofrio/ribbon)
— the same shape as its Thread stages plugin, except the stages are yours:
renamed, reordered, added, deleted, and given the rule agents read before they
move a thread.

Ribbon owns the sidebar: rendering, drag-and-drop, manual order, and the stored
placement of every root thread. This plugin owns the catalog and decides when a
thread moves on its own. Nothing here replaces bb's sidebar, and it coexists
with Thread stages — both show up in Ribbon's Groups menu, and each keeps its
own placement.

## Install

[Ribbon sidebar](https://github.com/ariofrio/ribbon) must be installed first,
and selected under **Settings → Appearance → Sidebar**. Without it the stages
have nowhere to draw.

```sh
bb plugin install "git:https://github.com/matthewdias/bb-plugins.git@^0.1.0" \
  --subdirectory plugins/workflow-stages --tag-prefix workflow-stages/
```

Then pick **Workflow** in the sidebar's Groups menu.

## What it does

Six stages ship:

| Stage | |
| --- | --- |
| Inbox | the default: new work, and anything that needs you |
| Planning | reading code, writing a plan, waiting on a plan review |
| Building | a plan exists and the change is being written |
| Review | the change is written and is being checked |
| Blocked | stopped on something outside the thread — *user-only* |
| Done | finished and merged, or abandoned — *user-only* |

Blocked and Done are marked *only the user files here*. Neither automation nor
an agent may file into or out of one.

### Edit the workflow

**Settings → Plugins → Workflow Stages.** Each stage has a name, an icon, and a
rule — free text describing what belongs there, injected into every agent
thread's instructions. Reorder with the arrows; the sidebar follows.

The icon button opens a searchable grid of bb's own icon set, the same names the
rest of the app draws. Ribbon takes icons as data rather than by name, so a pick
is converted to its drawing before it is stored, and anything outside Ribbon's
allow-list of SVG elements and attributes is refused — a bad icon would make
Ribbon reject the whole catalog, which reads as the grouping vanishing from the
sidebar. The first tile restores the stage's built-in glyph.

A stage's **id** is fixed at creation and shown beside its name, because that id
is what Ribbon files threads under. Renaming a stage changes its label only, so
nothing moves. Deleting one first moves every thread in it to the default stage,
then removes it.

### Automatic moves

Configured in the same editor:

| Trigger | Default |
| --- | --- |
| A thread with no placement | Inbox |
| A turn starts | off |
| Work stops | off |
| A question, an approval, or a failed turn | off |

"Work stops" only undoes the move "a turn starts" made, so a thread you filed by
hand while it was running stays filed. Every automatic move skips sticky stages.

The last one ships off on purpose. A stage says where the work is; whether it
needs you is a different axis, and Ribbon already draws that on the row itself.
Pointing it at a stage means a thread bounces there every time an agent asks a
clarifying question — which undoes the stage the agent just filed it under, most
often during planning. Point it at a stage only if you want an attention queue
more than you want a workflow position, and expect threads to be re-filed after
each answer.

## Settings

| | Default |
| --- | --- |
| Move threads automatically | on |
| Tell agents the workflow | on |

The first is the master switch over the triggers above; turning it off leaves
every move to you. The second controls whether the stage table and each stage's
rule reach agent threads at all.

## For agents

```sh
bb stages list                       # the workflow, with ids
bb stages show                       # this thread's stage
bb stages set building               # move it
bb stages set review --thread thr_…  # move another one
```

Each command acts on the thread's **root**, which is what the sidebar files, so
running one from a child thread is correct.

Agents get the same table through the thread's instructions plus the bundled
`workflow-stages` skill, which carries two rules. The first move is an
obligation: before its first substantive action an agent files the thread for
the work it is about to do, predictively, because an unfiled thread reads as
work nobody has picked up. Every move after that is evidential — at the
transition, never to announce progress, and never into a user-only stage.

## How it connects to Ribbon

Ribbon probes every running plugin for `getGroupingCatalogV1` and renders
whatever answers ([`ribbon-sidebar/src/server.ts`][server]). This plugin answers
with one grouping, `plugin:workflow-stages:workflow`, and writes placement back
through Ribbon's `updatePlacementV1`. Any catalog edit calls
`invalidateGroupingCatalogV1`, which repaints the sidebar immediately.

[server]: https://github.com/ariofrio/ribbon/blob/main/plugins/bb-plugin-ribbon-sidebar/src/server.ts

## Development

```sh
npm install
npm run typecheck
bb plugin install .
bb plugin dev                        # rebuild + reload on save
bb plugin logs workflow-stages -f
```

## License

MIT. See [LICENSE](../../LICENSE).
