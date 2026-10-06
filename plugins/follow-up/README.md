# Follow Up

An agent notices things it is not going to do — work that is out of scope,
blocked, deferred, a risk, or cleanup worth doing later. Those observations
normally live in one reply and are gone by the next turn. This plugin keeps
them, in a list above the composer that you triage.

The design point is what it does *not* do: there is no background model call.
Capture happens inside a turn the agent is already running, so the plugin costs
nothing to run — no model to choose, no cooldown, no polling, no inflight lock.

## Install

```sh
bb plugin install "git:https://github.com/matthewdias/bb-plugins.git@*" \
  --subdirectory plugins/follow-up --tag-prefix follow-up/
```

With `--tag-prefix`, the range `*` resolves to the newest `follow-up/vX.Y.Z`
tag, so this line stays correct as the plugin releases and `bb plugin update`
follows it.

## What it does

**The banner.** Above the composer, listing what this thread accumulated, laid
out like bb's own Queue card beneath it. Each row shows one action and keeps the
rest in its ⋯ menu. An out-of-scope row leads with handing it to a new thread in
the same checkout; every other row leads with pushing it into the composer. The
menu also edits the text in place (Enter saves, Escape puts it back), describes
a row that has no detail, opens it in the panel for the detail, file and reason,
marks it done, or dismisses it. Drag the handle to reorder.

A row pushed into the composer goes in as a pill, and the row is marked as in
the composer for as long as that pill is in your draft. Mark the row done or
dismiss it, in the banner or the panel, and its pill comes back out of the
draft, so sending cannot hand the agent a row that is gone. A row an agent
finishes, or one closed from the CLI or another window, leaves your draft alone.

**Recording the draft.** Type a follow-up into the composer, then choose
*Record as follow-up* in the menu beside the send button, or run the
*Follow-ups: record the draft* command. The row is recorded and the draft
clears. A refusal (a duplicate, a wording you dismissed earlier, a full list)
appears as a toast and leaves the draft as it was. A file you @-mention in the
draft becomes the row's anchor. On a phone, long-press Send to reach the menu.
While bb is waiting on you (a question, a plan approval) the send menu is
hidden, so use the command; bind it under Settings → Keyboard.

Highlighting a sentence in a message and choosing *Record as follow-up* records
that sentence instead, with the prose around it kept as detail. A refusal there
is a toast too.

Dismissal beats recording: once you delete a follow-up it stays gone, even if an
agent notices the same thing again. Recording the same text twice is a no-op —
matching ignores case and punctuation, because agents rarely reproduce their own
wording exactly. Each thread holds at most 50 by default; beyond that the tool
refuses and says so rather than evicting older rows.

**Next.** Between turns, a row at the top of the card answers the reply right
above it. When an agent's reply ends by offering to do something ("Want me to
open a PR?"), it offers the same thing through `offer_next_steps`, and each
step becomes a button: press it and its text is sent as your message, with
nothing to type. Hold ⌥ while clicking, or press and hold on a phone, to put
it in the composer instead and edit it first. The ⋯ beside the buttons keeps a
step as a follow-up for later, or clears them.

A button sends exactly what it shows, never more. The agent writes the words
and a press sends them under your name, so there is no hidden prompt behind a
short label. A step too long to show whole is refused rather than cut off, and
so is one carrying characters that draw nothing on screen but still reach the
agent (zero-width, bidi, Unicode tag or variation-selector characters).

An offer belongs to one reply. It goes the moment the next turn starts,
however that turn starts, so a button is never the answer to an older reply.
There are no buttons on earlier messages for the same reason: a "yes" to a
reply from five turns ago is almost always a mistake by the time it is sent.

When the agent offered nothing, the row offers the top of the list instead:
*Do* sends that follow-up to the agent now, with its whole record, and marks it
in progress, as mentioning it would. It skips an out-of-scope row, which leads
with a handoff, and does not skip past the top to find another: the list's
order is yours. The chip shows the start of the row, usually its headline
("Fix the restore…"), ending in "…" whenever there is more. Hover it for the
whole row, which is also marked in the list while you do. The label is cut
from the row's own words rather than written separately, so it can never say
something the row does not.

**The empty state.** When the list empties, the banner offers three things:
*suggest what's next*, start a new thread in the same checkout, or archive this
one. The first is a real agent turn rather than anything the plugin computes —
it sends a prompt to this thread on the thread's own model, visible in the
timeline and stoppable like any other. There is still no *background* model
call: the turn happens because you clicked. The prompt tells the agent that
"nothing worth doing next" is a real answer, so the button cannot manufacture
work to justify itself.

If the agent has already offered next steps above it, *suggest what's next*
is left out: it would ask the question the agent has just answered. If the
agent said this thread's goal is met, *archive* is drawn as a button rather
than a quiet link.

The banner only does this on a thread that has actually tracked something. A
thread that never recorded a follow-up has nothing for this plugin to say about
what is left, so it stays silent. The panel is ungated, because you opened it to
ask. *Offer the empty state on every thread* lifts that gate for the banner too,
if you would rather have the card — and *suggest what's next* with it — waiting
on any thread with nothing outstanding. It stays out of the way mid-turn either
way.

**The `+` menu's Follow-ups row.** Opens a picker over the composer listing this
thread's open follow-ups. Type to narrow it, use the arrow keys to choose, and
press Enter (or click) to put that row's pill in the composer; the row moves to
the top of the list, as inserting from the banner does.

**Palette commands.** Eight commands in bb's command palette, none bound to a
key by default. Bind any of them under Settings → Keyboard.

| Command | What it does |
| --- | --- |
| Follow-ups: show or hide the list | Expand or collapse the banner on a thread with open follow-ups |
| Follow-ups: open panel | Open the Follow-ups tab in the side panel |
| Follow-ups: hand off… | Open the Hand off tab, composing a new thread in this checkout |
| Follow-ups: take the first next step | Press the first of the agent's offered steps (also second, third) |
| Follow-ups: record the draft | Record the composer's draft as a follow-up and clear it |
| Follow-ups: insert one… | Open the follow-up picker in the composer |

**The `@` menu.** Follow-ups appear as mentions, so a row can be pulled into a
prompt by name. Mentioning one can claim it, marking it in progress as you send,
and can ask the agent to fill in a missing file anchor or detail.

## Settings

| | Default |
| --- | --- |
| Remind agents to record follow-ups | on |
| Let agents offer next steps | on |
| List follow-ups in the `@` menu | on |
| Mentioning a follow-up claims it | on |
| Ask for a mentioned row's missing file and detail | on |
| Carry a child thread's follow-ups up to its parent | on |
| Follow-ups kept per thread | 50 |
| Collapse the banner above this many rows | 4 |
| Offer *Describe this in more detail* | on |
| Describe: word limit | 240 |
| Describe: turns of context | 12 |
| Describe: your own guidance | none |
| Offer the empty state on every thread | off |
| Offer *Suggest what's next* | on |
| Suggest: your own guidance | none |

*Describe this in more detail* and *Suggest what's next* are the only two things
here that spend a turn, and only when you press them. Both run on a model you
pick — the settings section renders bb's own provider-and-model picker over the
live catalog, rather than a fixed list that goes stale or a free-text field that
lets you misconfigure it silently.

A next-step button, or *Do*, sends a message into the thread exactly as typing
one would. The turn it starts is the thread's own, on the thread's own model;
the plugin adds nothing to it.

## For agents

Six tools:

| | |
| --- | --- |
| `record_follow_up` | record one, at the moment it is noticed |
| `list_follow_ups` | read the current list |
| `complete_follow_up` | close a row whose work is finished |
| `prioritize_follow_up` | move a row to the front |
| `amend_follow_up` | add detail to a row without rewording it |
| `offer_next_steps` | offer what it would do next here, as buttons under its reply |

`record_follow_up` takes `text` (one imperative line, ≤240 chars), `reason`
(`out-of-scope`, `blocked`, `deferred`, `risk`, or `cleanup`), an optional
`file` anchor as `path` or `path:line`, and optional `detail` (≤1000 chars).

The same ground from a terminal:

```sh
bb follow-up add "<text>"            # record one yourself
bb follow-up show                    # open rows on the current thread
bb follow-up show --all -v           # every thread that recorded any, with detail
bb follow-up move <id> top           # reprioritise
bb follow-up amend <id> --detail "…" # change in place, keeping id, age, position
bb follow-up done <id>               # finish it
bb follow-up reopen <id>             # put it back
bb follow-up clear-done              # empty Done
bb follow-up describe <id>           # have a helper write its detail
bb follow-up handoff <id> [skill]    # send it to a new thread
bb follow-up dismiss <id>            # drop it, and never record it again
bb follow-up clear                   # drop this thread's follow-ups
bb follow-up forget                  # let dismissed follow-ups be recorded again
```

`handoff` takes the execution flags `bb thread spawn` does: `--provider`,
`--model`, `--reasoning-level`, `--permission-mode`, and `--service-tier`, which
takes any tier id the provider lists for the model (see `bb provider models`).

Every subcommand takes `--help` and prints its own arguments and options. An
option a subcommand does not declare is refused, with the nearest name it does
declare as a hint. With `--json`, a failure also prints
`{"ok": false, "error": {"code", "message", "hint"}}` on stdout, while stderr
keeps the readable message.

`dismiss` is the same action as the banner's Dismiss, exposed so the tombstone path is
testable without a browser. `clear` empties the list without dismissing
anything. `forget` drops the *dismissal* record — use it when you deleted
something and want agents to be able to raise it again.

## For other plugins

Two things here are contracts rather than internal calls: a live value for a
plugin drawing progress, and a batch call for one that only needs to ask.

### The progress complication

Each thread's progress is published as a *complication*: a small value any
plugin can draw, kept in a registry that every plugin bundle in a bb window
shares. [Thread Badges](../thread-badges) 0.4 draws it as a ring that moves the
moment a follow-up changes, once you turn it on under *Badges from other
plugins* in its settings. The counts call below cannot do that, because a plugin
hears only its own realtime signals; this plugin hears `followups-changed`, so
it publishes again on every one.

The registry is protocol v1 of [`lib/complications.ts`](lib/complications.ts),
which a consumer copies into its own plugin; its header is the protocol. Want
`follow-up/progress` for `{ kind: "thread", id }` and the value is:

```ts
{ icon: "TextWrap", label: "27 of 28 follow-ups done", tone: "default",
  fraction: 27 / 28, text: "1" }   // text: how many are still open
```

`null` for a thread that never recorded a follow-up. Once the list is clear, the
tone is `success` and there is no `text`. Values are published only for threads
a surface wants, and again whenever one of them changes or realtime reconnects.
The provider is registered as long as this plugin's frontend is loaded, so
`isProvided("follow-up/progress")` is how a consumer tells a live Follow Up from
an older one and falls back to the counts call.

### The counts call

```
POST /api/v1/plugins/follow-up/rpc/getFollowUpCountsV1
{ "threadIds": ["thr_a", "thr_b"] }

{ "protocolVersion": 1,
  "counts": [ { "threadId": "thr_a", "open": 2, "done": 5 },
              { "threadId": "thr_b", "open": 0, "done": 0 } ] }
```

Everything else in the RPC surface is this plugin talking to its own frontend
and may change shape whenever that is convenient. This one will not, without the
version changing with it — read `protocolVersion` before you read the counts,
because a payload that changed shape and a thread with no follow-ups both leave
you holding nothing, and only one of them is worth an error.

Three things it promises. It is a **batch**: ask once for everything on screen
rather than once per row, up to 500 threads. Every requested thread comes
**back**, including ones with nothing recorded — "no follow-ups" is worth
caching and "not answered" is worth retrying, and a caller cannot tell them
apart from an absent entry. Repeated ids are **deduped**, in first-seen order.

The shape follows Ribbon's `getGroupingCatalogV1`, which is the closest thing bb
has to a convention for one plugin reading another. Validate it on arrival: this
plugin is optional, and a consumer that treats a missing or unrecognised answer
as "draw nothing" keeps working when it is not installed.

## Development

```sh
npm install
npm run typecheck
npm test
bb plugin install .
bb plugin dev                        # rebuild + reload on save
bb plugin logs follow-up -f
```

`lib/followups.ts` holds every rule and touches no plugin API, so it is testable
without a running bb. Keep `bb.*` calls in `server.ts`.

`npm test` runs two suites:

- **`node --test`**, for `lib/`, `src/insert-pill.ts` and `tests/server.test.ts`.
  The last one loads `server.ts` against the SDK's fake host and pins what
  `bb follow-up` prints, byte for byte. Agents and the describe helper drive
  that CLI, so a golden that has to change should change in its own reviewed
  hunk.
- **vitest with jsdom**, for the composer surfaces in `tests/ui/`, rendered
  through the SDK's `renderSlot` harness.

The test suite is mutation-checked: removing the tombstone check, the duplicate
check, the per-thread cap, `normalizeKey`'s case folding, `applyTombstones`, or
the empty-text guard each turns it red.

## License

MIT. See [LICENSE](../../LICENSE).
