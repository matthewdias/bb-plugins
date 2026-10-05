# Thread Badges

A sidebar row tells you a thread exists. It does not tell you that its pull
request has failing checks, that someone requested changes, that three
follow-ups on it are still open, or that its worktree is serving a dev server on
:5173. These badges do, on whichever sidebar you use, without opening anything.

Three badge types ship built in: pull requests, their checks, and ports. Any
other plugin can add more by publishing a *complication*, a small value about a
thread, which this plugin draws once you turn it on. That's how Follow Up's
progress ring arrives. Either way, the host owns mount points and ordering, and
knows nothing about what any badge means.

## Install

```sh
bb plugin install "git:https://github.com/matthewdias/bb-plugins.git@*" \
  --subdirectory plugins/thread-badges --tag-prefix thread-badges/
```

With `--tag-prefix`, the range `*` resolves to the newest `thread-badges/vX.Y.Z`
tag, so this line stays correct as the plugin releases and `bb plugin update`
follows it.

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

### Ports

A plug on threads whose worktree is serving something, hovering to name it —
"vite :5173 · 2 others". Green when a port belongs to the app you are
developing; muted grey on a worktree running only backing services or loopback
listeners. Optionally the port number sits beside the glyph.

**This is the one badge that ships off.** Not because it is less useful than the
others, but because switching it on cannot be the whole gesture: it sorts last,
the cap is two, so an on-by-default switch would be a switch that draws nothing.
Turning it on means also raising *Badges per row* to 3 or giving it a lower
priority number than a badge you care about less. Off, it asks the one question
it actually needs answered — is this worth a slot?

By default it counts only **app** ports. This matters more than it sounds: a bb
worktree's only listener is very often the agent process's own ephemeral
loopback port, which is classified `internal`. A badge counting those would
light up on every thread in the sidebar and tell you nothing. Switch
*ignore backing services and internal listeners* off if you want the full count.

The badge reads [Worktree Ports](https://github.com/to-infinity-labs/bb-plugin-worktree-ports),
which already does everything hard here — `lsof`, Docker compose attribution,
role classification, per-machine scanning — and whose snapshot already carries
the environment-to-threads mapping a badge needs. Nothing in this plugin scans
for a port.

It reads that plugin's plain `GET /http/snapshot` route rather than its
`ports_snapshot` RPC, and the difference is not cosmetic. Both return the same
document, but the RPC forces a fresh scan when the cached one is stale and
resets the scanner's idle counter — it is built for someone who just opened the
ports card and wants an answer now. A badge is the opposite: passive, on screen
whenever the sidebar is, and calling that RPC on a timer would pin Worktree
Ports to its fast cadence forever, running `lsof` for a sidebar nobody is
reading. One snapshot answers for every row, so the whole sidebar costs one
request every ten seconds.

Unlike Follow Up's counts, that snapshot carries no version stamp, so there is
nothing here to check one against. Every failure is therefore treated as
transient and retried, because an absent Worktree Ports and a changed payload
look identical from outside and only one of them is worth giving up over. Both
end the same way: no plug, nothing else affected.

If you run Worktree Ports' own row glyph as well, you will get two marks on the
same row by two different mechanisms — it paints through the host's thread-row
status API, this one portals into the row. Turn its *thread row icon* setting
off and let the badge carry it, so ports participate in the same cap and
priority ordering as everything else on the row.

### Complications from other plugins

Any plugin can publish complications about a thread: small values like a
progress ring, a status icon or a count. Each one that answers threads appears
under **Badges from other plugins** in this plugin's settings, with its
description and a preview. **Each is off until you turn it on.** Installing a
plugin never changes your rows by itself.

Turned on, a complication joins the built-in badges on the same priority scale.
It sorts after them by default, so it takes a slot only where they are silent,
until you give it a lower number. Two options apply to each one: show its text
beside it, and hide it once it is complete. The second applies only to gauges.

How a value draws comes from the value itself:

- **A fraction draws as a ring**, empty at nothing and full at done, in the
  value's tone.
- **Anything else draws as the provider's own icon**, in its tone.
- **Tones use the built-in badges' palette:** success green, error red, warning
  amber, info blue, and default muted. `running` is amber and pulses, unless
  your system asks for reduced motion.
- **The value's label** is the badge's accessible name and its tooltip.

The values arrive live. bb imports every plugin's bundle into one page, so
plugins share one JavaScript global, and a registry kept there carries each
value from the plugin that knows it to this one. A plugin hears only its own
realtime signals, so this is the only way another plugin's change reaches a
row without polling. Both sides carry the same copy of that registry,
[`lib/complications.ts`](lib/complications.ts), and its header is the protocol.

**Follow-up progress** comes from [Follow Up](../follow-up) 0.7 or later. It
draws as a ring showing how much of a thread's follow-up list is closed:
"27 of 28 follow-ups done", and green once the list is clear. *Show its text*
adds how many are still open. Earlier versions of Follow Up publish nothing, so
there is no ring for them.

## Settings

Each built-in badge type can be switched off independently, and each owns a
couple of options. Complications from other plugins have their own section
below these, described above.

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
| Ports | **off** |
| … priority | 3 |
| Each complication from another plugin | **off** |
| … priority | 4 |
| … show its text beside it | off |
| … hide it once complete | off |
| … ignore backing services and internal listeners | on |
| … show the port number beside the glyph | off |

"Problems only" drops *checks running* and *review requested*, so the badge
speaks only when someone has to fix something.

### How many badges a row shows

A sidebar row is around 260px wide and already carries a title, a preview line
and the sidebar's own trailing controls. At roughly 14px a badge, three is busy
and four starts truncating titles — so a row draws at most **two** badges by
default, however many types are switched on. Raise *Badges per row* if you want
more, up to six.

The cap only bites on rows where more badges than that have something to say; a
thread with one open pull request and nothing else still shows one badge. When
it does bite, the lowest *priority* numbers win the slots and the rest are
dropped for that row. Priorities default to the order the types are listed
above, with complications after the built-ins, so out of the box a row with all
of them in play shows the pull request and its checks. Give a complication
priority 1 to put it first.

This is also why the ports badge ships off rather than on. At the default cap it
would sort past the last slot and draw nothing, so it is switched off instead of
switched on and silent — and because a badge that is off never subscribes, an
untouched install never polls for ports at all.

Two types may share a priority number. Ties go to the built-ins first, then to
catalog order and the order providers appeared, so a half-configured set of
priorities still draws a stable row.

## Adding a badge type

From another plugin, publish a complication; the protocol is the header of
[`lib/complications.ts`](lib/complications.ts), and Follow Up's
`src/complication-publisher.tsx` is a working provider. Nothing in this plugin
changes. A new built-in type is two edits here, with no changes to the host:

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
row's slots. The same contract collapses the slot itself on a row where every
badge stayed silent, so a quiet row spends none of its title on them.

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

Badges sit at the trailing end of the title, so the activity indicator and the
actions menu keep their place. Where that is depends on how the row is built.
bb's own rows are a single flex line and publish
`.bb-sidebar-hover-actions-inset`, the column they pad on hover to clear the
actions: a badge goes inside it, and the sidebar moves it aside in its own
units. Ribbon's rows are a grid stacking a title over a preview, so the row is
not a line to trail — a badge goes on the title's own line, found through the
`data-ribbon-sidebar-icon-*` attributes Ribbon publishes for its Icons plugin.
Any other sidebar is taken to be a flex line, and the badge goes immediately
before its trailing chrome.

Consequences worth knowing:

- If a sidebar stops publishing that attribute, the badges disappear and nothing
  else changes.
- Rows re-render constantly, so mount points are re-established on mutation and
  moved rather than rebuilt. The scheduler is a timer, not
  `requestAnimationFrame`: rAF does not run in a hidden window, which would
  strand the sidebar unscanned until you looked at it again.
- Layout is not guaranteed. Badges are inserted into a row this plugin does not
  own, so a sidebar redesign can move them. Ribbon's move to a stacked row did
  exactly that — the badges drew on a line of their own under the preview until
  this plugin learned the new shape.

## Requirements

The pull-request badges need a thread whose environment has a branch with a pull
request on a git host bb can reach. The ports plug needs
[Worktree Ports](https://github.com/to-infinity-labs/bb-plugin-worktree-ports);
without it, that badge does not draw and the others are unaffected. A
complication needs the plugin that publishes it: the follow-up ring needs
[Follow Up](../follow-up) 0.7 or later.

This version needs bb 0.45 or later, for the plugin SDK it is built on (0.6).
On an older bb, stay on Thread Badges 0.3.

## Development

```sh
npm install
npm run typecheck
npm test
bb plugin install .
bb plugin dev                        # rebuild + reload on save
bb plugin logs thread-badges -f
```

## License

MIT. See [LICENSE](../../LICENSE).
