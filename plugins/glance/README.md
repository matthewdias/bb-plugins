# Glance

bb tells you an agent needs you only while bb is in front of you. Glance is the
server half of a Mac app that keeps the answer on your desktop: a widget, a menu
bar count, and Siri and Shortcuts actions for the threads that are waiting on
you.

This plugin serves a small feed of those threads as HTTP routes protected by a
token. The Glance app reads it. The token opens these routes and nothing else:
not your bb session, and not a machine grant that could open terminals.

## Install

```sh
bb plugin install "git:https://github.com/matthewdias/bb-plugins.git@semver:*" \
  --subdirectory plugins/glance --tag-prefix glance/
```

## Pairing

Three ways, and the token itself never appears in any of them:

- **In Glance:** "Pair with bb on this Mac" asks this bb directly over loopback.
- **In bb:** Settings → Plugins → Glance → **Pair Glance** opens a pairing link
  on this Mac.
- **From a terminal:** `bb glance pair [--server <url>]` prints the same link.

A link carries a one-time code, not the token. The code works once, for two
minutes, and Glance exchanges it for the token. A link left in scrollback, an
agent transcript or another app's URL handler is dead by the time anyone reads
it. The link points at `publicBaseUrl` if you set one, otherwise at this Mac's
own bb.

getbb.app does not work as that address today. Its edge asks for a browser
sign-in before any request reaches bb, including port shares. Glance runs on the
Mac that runs bb.

`bb plugin token glance --rotate` unpairs every client at once.

## What the feed holds

| Section | |
| --- | --- |
| Needs you | Errored threads, threads with a pending question or approval, and finished turns you have not read. Ranked in that order, newest first. This is the rule bb's *Needs attention* homepage section uses, so the two never disagree. |
| Running | Active threads that are not waiting on you |
| Recent | The last ten threads updated |

Only visible threads appear. Background workers, archived and deleted threads
never leave the server. Each item carries a path such as
`/projects/<id>/threads/<id>`, which the client joins with its own base URL.

## Settings

**Let paired apps start threads** (`allowActions`, off). Lets Glance, Siri and
Shortcuts start a thread with a prompt in a project you pick, using that
project's provider and model.

**Permission mode for threads paired apps start** (`startPermissionMode`,
`accept-edits`). Always applied, whatever the project's default. Anyone holding
the token can start these threads, so the default asks before running commands.
`auto` and `full` do not ask.

**Address paired apps use** (`publicBaseUrl`). Where pairing links point. Empty
means this Mac's own bb.

## Routes

Every route is under `/api/v1/plugins/glance/http/`. All but the two pairing
routes need the token, as the `x-bb-plugin-token` header or `?token=`.

| Route | |
| --- | --- |
| `GET /feed` | The feed. Sends an `ETag` and answers `If-None-Match` with 304. |
| `GET /stream` | WebSocket. Sends `{type: "hello", version}`, then `{type: "changed", version}` whenever the feed changes. |
| `GET /projects` | `{projects: [{id, name}]}`, for picking where a thread starts |
| `POST /threads` | `{projectId, prompt}` → `{threadId, path}`. Returns 403 unless starting threads is allowed. Runs in the configured permission mode. |
| `POST /open` | `{threadId}` → `{delivered}`. Opens the thread in every open bb window. Zero means none is open. |
| `GET /ping` | Pairing check |
| `POST /pair` | `{code}` → `{token}`. Open, because the caller has no token yet: the code is the credential. Returns 401 for a used or expired code, and 429 after ten misses in a minute. |
| `POST /pair/local` | → `{token}`. bb's `local` auth (this bb's own origin, JSON only), plus a refusal of anything a proxy forwarded or that addressed a non-loopback host. |

## CLI

```
bb glance pair [--server <url>] [--json]
bb glance status [--json]
```
