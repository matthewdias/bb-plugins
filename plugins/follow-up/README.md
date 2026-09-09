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
bb plugin install "git:https://github.com/matthewdias/bb-plugins.git@^0.3.0" \
  --subdirectory plugins/follow-up --tag-prefix follow-up/
```

## What it does

**The banner.** Above the composer, listing what this thread accumulated. Each
row can be pushed into the composer, handed to a new thread in the same
checkout, dragged into a different order, marked done, or dismissed.

Dismissal beats recording: once you delete a follow-up it stays gone, even if an
agent notices the same thing again. Recording the same text twice is a no-op —
matching ignores case and punctuation, because agents rarely reproduce their own
wording exactly. Each thread holds at most 50 by default; beyond that the tool
refuses and says so rather than evicting older rows.

**The empty state.** When the list empties, the banner offers three things:
*suggest what's next*, start a new thread in the same checkout, or archive this
one. The first is a real agent turn rather than anything the plugin computes —
it sends a prompt to this thread on the thread's own model, visible in the
timeline and stoppable like any other. There is still no *background* model
call: the turn happens because you clicked. The prompt tells the agent that
"nothing worth doing next" is a real answer, so the button cannot manufacture
work to justify itself.

The banner only does this on a thread that has actually tracked something. A
thread that never recorded a follow-up has nothing for this plugin to say about
what is left, so it stays silent. The panel is ungated, because you opened it to
ask.

**The `@` menu.** Follow-ups appear as mentions, so a row can be pulled into a
prompt by name. Mentioning one can claim it, marking it in progress as you send,
and can ask the agent to fill in a missing file anchor or detail.

## Settings

| | Default |
| --- | --- |
| Remind agents to record follow-ups | on |
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
| Offer *Suggest what's next* | on |
| Suggest: your own guidance | none |

*Describe this in more detail* and *Suggest what's next* are the only two things
here that spend a turn, and only when you press them. Both run on a model you
pick — the settings section renders bb's own provider-and-model picker over the
live catalog, rather than a fixed list that goes stale or a free-text field that
lets you misconfigure it silently.

## For agents

Five tools:

| | |
| --- | --- |
| `record_follow_up` | record one, at the moment it is noticed |
| `list_follow_ups` | read the current list |
| `complete_follow_up` | close a row whose work is finished |
| `prioritize_follow_up` | move a row to the front |
| `amend_follow_up` | add detail to a row without rewording it |

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

`dismiss` is the same action as the banner's x, exposed so the tombstone path is
testable without a browser. `clear` empties the list without dismissing
anything. `forget` drops the *dismissal* record — use it when you deleted
something and want agents to be able to raise it again.

## For other plugins

One method here is a contract rather than an internal call:

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

The test suite is mutation-checked: removing the tombstone check, the duplicate
check, the per-thread cap, `normalizeKey`'s case folding, `applyTombstones`, or
the empty-text guard each turns it red.

## License

MIT. See [LICENSE](../../LICENSE).
