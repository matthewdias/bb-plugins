# Thread Badges

A sidebar row tells you a thread exists. It does not tell you that its pull
request has failing checks, that someone requested changes, or that three
follow-ups on it are still open. These badges do, on whichever sidebar you use,
without opening anything.

Three badge types ship today. The plugin is built around the idea that there
will be more: the host owns mount points and ordering, and knows nothing about
what any badge means.

## Install

```sh
bb plugin install "git:https://github.com/matthewdias/bb-plugins.git@^0.1.0" \
  --subdirectory plugins/thread-badges --tag-prefix thread-badges/
```

## What it does

### Pull requests

| State | Glyph | Colour |
| --- | --- | --- |
| open | draft pull request | green |
| draft | draft pull request | grey |
| merged | pull request | purple |
| closed | closed pull request | red |

Green, purple and red are GitHub's own values, because that is where the reader
learned them; grey and red come from the theme's variables so they follow the
palette. The badge is not a link — hovering names the number, state, attention
and title, and clicks belong to the row.

bb resolves the pull request itself. `experimental_useSidebarThreadPullRequest`
is first-party, per row and opt-in because it costs a git-host lookup, and the
host owns polling and staleness. A thread with no branch, no environment, or a
git-host hiccup simply shows nothing.

### Pull request checks

The same source as the pull-request badge, and a different question. `state`
says what the pull request *is*; `attention` says whether it wants something
from you — bb rolls that up from checks, reviews and mergeability, so nothing
here talks to a git host.

| Attention | Glyph | Colour |
| --- | --- | --- |
| checks running | clock | amber |
| checks failed | circled x | red |
| merge conflicts | warning triangle | red |
| changes requested | speech bubble | amber |
| merge blocked | lock | amber |
| review requested | eye | blue |
| ready to merge | circled tick | green, off by default |

The four remaining values — `none`, `draft`, `merged`, `closed` — only repeat
`state`, which the pull-request badge already draws, so this one stays silent
for them. `ready_to_merge` is off by default for the opposite reason: it never
clears, so it would sit on the row for the life of a healthy branch. The default
is a badge you see when CI is running or something is wrong, and not otherwise.

It is a separate type rather than a colour on the pull-request badge because
colour there tracks state — GitHub's green, purple and red, which the reader
already knows. Two glyphs say two things; one glyph saying both says neither.

Running it alongside the pull-request badge costs no extra git-host lookups. bb
backs `experimental_useSidebarThreadPullRequest` with a TanStack query keyed by
*environment id*, so both badges are observers on one query — as is every other
row sharing that environment. That query sets `refetchOnWindowFocus` and polls
every 30 seconds while an **open** pull request has checks pending or unknown
mergeability. Note the `open` in that condition: a draft pull request with
checks running does not poll, so its clock clears on focus rather than on its
own.

### Follow-ups

A ring showing how much of a thread's follow-up list is closed: empty at none
done, a visible notch at "one left", and a full green ring once the list is
clear. A thread that never recorded a follow-up shows nothing. Hovering names
the count — "27 of 28 follow-ups done".

The ring reads another plugin's state.
[Follow Up](../follow-up) publishes a versioned counts contract, and every
failure here is treated as "draw nothing", so an absent, disabled, or renamed
Follow Up makes the ring disappear and breaks nothing else.

Liveness is the one thing that cannot be fixed from either side: a plugin
receives only its own realtime signals, so Follow Up publishing
`followups-changed` on every mutation is inaudible here. Verified — recording a
follow-up did not move the ring until the page reloaded. Until bb widens that,
this badge refreshes on mount and when the window regains focus (throttled to
once every ten seconds), which the host supplies to every badge as `revision`.

## Settings

Each badge type can be switched off independently, and each owns a couple of
options.

| | Default |
| --- | --- |
| Badges per row | 2 |
| Pull requests | on |
| … priority | 1 |
| … show the number beside the glyph | off |
| … hide merged and closed pull requests | off |
| Pull request checks | on |
| … priority | 2 |
| … keep the tick on ready-to-merge pull requests | off |
| … narrow to problems only | off |
| Follow-ups | on |
| … priority | 3 |
| … show how many are still open beside the ring | off |
| … hide the ring once everything is done | off |

"Problems only" drops *checks running* and *review requested*, so the badge
speaks only when someone has to fix something.

### How many badges a row shows

A sidebar row is around 260px wide and already carries a title, a preview line
and the sidebar's own trailing controls. At roughly 14px a badge, three is busy
and four starts truncating titles — so a row draws at most **two** badges by
default, however many types are switched on. Raise *Badges per row* to 3 if you
want every enabled type on every row.

The cap only bites on rows where more badges than that have something to say; a
thread with one open pull request and no follow-ups still shows one badge. When
it does bite, the lowest *priority* numbers win the slots and the rest are
dropped for that row. Priorities default to the order the types are listed
above, so out of the box a row with all three in play shows the pull request and
its checks, and drops the follow-up ring. Give follow-ups priority 1 to flip
that.

Two types may share a priority number; ties fall back to catalog order, so a
half-configured set of priorities still draws a stable row.

## Adding a badge type

Two edits, no changes to the host:

1. Add an entry to `BADGE_TYPES` in `badges/catalog.ts` — id, name, the
   description shown under its switch, whether it is on by default, and any
   extra boolean settings it owns (prefix their keys with the badge id). The
   backend derives its settings from this, so a new type contributes them by
   existing.
2. Write the component and map it in `badges/components.tsx`. It receives
   `{ threadId, values, revision }` and renders `null` whenever it has nothing
   to show. `revision` increments when the window regains focus: hang a refetch
   on it if your source cannot push, and ignore it if bb already owns the
   staleness.

Badges render in priority order, left to right, and each type's priority
defaults to its catalog position — so a new type lands last and, with the
default cap of two, will not displace an existing badge until someone gives it a
lower number.

A component runs once per visible row, so keep it cheap, and do not assume it is
the only badge there — or that it is visible, since the per-row cap hides
anything past the limit. That cap is CSS (`nth-child` on the row's slot), which
works because a badge with nothing to say renders no element at all; render
exactly one element when you do have something, or you will spend two of the
row's slots.

Style it inline. A plugin's compiled stylesheet is scoped to that plugin's own
subtree, and a badge is portaled into a row outside it, so Tailwind classes on a
badge do nothing at all — including sizing ones like `size-3.5`. Use bb's global
CSS variables for theme values, and `light-dark()` for fixed colour pairs: bb
switches themes with `color-scheme` on the root rather than a `.dark` class a
stylesheet could select on.

## How it attaches

No sidebar offers a slot for a badge, and this plugin does not ask one to. Every
sidebar publishes `a[data-sidebar-thread-id]` on its rows — bb's own attribute,
which Ribbon's replacement list emits too so the host can keep targeting rows
for keyboard shortcuts. An `experimental_appOverlay` hangs one span off each
row's anchor and portals React into it, which is what lets a badge keep its
hooks and context while the rows stay entirely the sidebar's business.

Badges sit immediately left of the row's trailing controls, so the activity
indicator and the actions menu keep their place.

Consequences worth knowing:

- If a sidebar stops publishing that attribute, the badges disappear and nothing
  else changes.
- Rows re-render constantly, so mount points are re-established on mutation and
  moved rather than rebuilt. The scheduler is a timer, not
  `requestAnimationFrame`: rAF does not run in a hidden window, which would
  strand the sidebar unscanned until you looked at it again.
- Layout is not guaranteed. Badges are inserted into a flex row this plugin does
  not own, so a sidebar redesign can move them.

## Requirements

The pull-request badges need a thread whose environment has a branch with a pull
request on a git host bb can reach. The follow-ups ring needs
[Follow Up](../follow-up) installed; without it the ring does not draw and the
other badges are unaffected.

## Development

```sh
npm install
npm run typecheck
bb plugin install .
bb plugin dev                        # rebuild + reload on save
bb plugin logs thread-badges -f
```

## License

MIT. See [LICENSE](../../LICENSE).
