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

```sh
bb glance pair --server http://127.0.0.1:38886
```

This prints a `glance://pair?…` link. Open it on the Mac running Glance, or
paste the server and token into Glance's settings. `--server` is the base URL
that Mac reaches bb through. Set it once with
`bb plugin config glance set publicBaseUrl <url>` and `pair` needs no flag.

getbb.app does not work as that address today. Its edge asks for a browser
sign-in before any request reaches bb, including port shares, so a widget can't
get through. Use bb on the same Mac (`http://127.0.0.1:<port>`) or an address
you control.

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
Shortcuts start a thread with a prompt in a project you pick. The thread uses
the project's defaults. A remote caller can never choose a provider, a model or
a permission mode.

**Address paired apps use** (`publicBaseUrl`). The default `--server` for
`bb glance pair`.

## Routes

Every route is under `/api/v1/plugins/glance/http/` and needs the token as the
`x-bb-plugin-token` header or `?token=`.

| Route | |
| --- | --- |
| `GET /feed` | The feed. Sends an `ETag` and answers `If-None-Match` with 304. |
| `GET /stream` | WebSocket. Sends `{type: "hello", version}`, then `{type: "changed", version}` whenever the feed changes. |
| `GET /projects` | `{projects: [{id, name}]}`, for picking where a thread starts |
| `POST /threads` | `{projectId, prompt}` → `{threadId, path}`. Returns 403 unless starting threads is allowed. |
| `POST /open` | `{threadId}` → `{delivered}`. Opens the thread in every open bb window. Zero means none is open. |
| `GET /ping` | Pairing check |

## CLI

```
bb glance pair [--server <url>] [--json]
bb glance status [--json]
```
