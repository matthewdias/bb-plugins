# bb-plugins

Five plugins for [bb](https://github.com/get-bb/bb), the agent IDE.

| Plugin | |
| --- | --- |
| **[Follow Up](plugins/follow-up)** | Keeps the work an agent noticed but skipped, so nothing is lost when a turn ends. Triage what a thread accumulated above the composer. |
| **[Mark Unread](plugins/mark-unread)** | Marks a thread unread from any message, as in Slack: from the message's action bar or with Option-click. A New line marks the spot, and coming back scrolls you to it. |
| **[Thread Badges](plugins/thread-badges)** | Shows pull-request state, CI attention, listening ports and badges other plugins publish, like Follow Up's progress, on sidebar rows, so you see what needs you without opening a thread. |
| **[Top Tabs](plugins/top-tabs)** | Opens destinations as tabs across the top of the window, beside a permanent Threads tab, so you can keep several open and switch without losing your place. |
| **[Workflow Stages](plugins/workflow-stages)** | Files every thread under a workflow stage you define, and moves it as the work progresses. Requires the Ribbon sidebar. |

Each is independent. Three soft connections exist and none is required: Thread
Badges draws Follow Up's progress ring once you turn it on, and a ports plug
when [Worktree Ports](https://github.com/to-infinity-labs/bb-plugin-worktree-ports)
is installed, and Workflow Stages needs
[Ribbon sidebar](https://github.com/ariofrio/ribbon) to have anywhere to draw.

## Install

One at a time, by subdirectory:

```sh
bb plugin install "git:https://github.com/matthewdias/bb-plugins.git@*" \
  --subdirectory plugins/follow-up --tag-prefix follow-up/

bb plugin install "git:https://github.com/matthewdias/bb-plugins.git@*" \
  --subdirectory plugins/mark-unread --tag-prefix mark-unread/

bb plugin install "git:https://github.com/matthewdias/bb-plugins.git@*" \
  --subdirectory plugins/thread-badges --tag-prefix thread-badges/

bb plugin install "git:https://github.com/matthewdias/bb-plugins.git@*" \
  --subdirectory plugins/top-tabs --tag-prefix top-tabs/

bb plugin install "git:https://github.com/matthewdias/bb-plugins.git@*" \
  --subdirectory plugins/workflow-stages --tag-prefix workflow-stages/
```

Each plugin is released under its own tag prefix, so the range `*` resolves to
the newest release of that plugin alone and these lines never go stale. A caret
range would: on a `0.x` version `^0.1.0` cannot reach `0.2.0` at all, which is
how this page came to offer a plugin two minor versions behind.
`--plugin <name>` works instead of `--subdirectory` — the repository carries a
`.bb/plugins.json` index naming all five.

See each plugin's README for what it does, its settings, and its agent surface.

## Development

```sh
npm install
npm run check          # typecheck, test, and build every plugin
```

Per plugin:

```sh
npm run typecheck --workspace=bb-plugin-follow-up
npm test --workspace=bb-plugin-follow-up
cd plugins/follow-up && bb plugin install . && bb plugin dev
```

Requires Node 22 or later and a bb install providing the `bb` CLI.

## License

MIT. See [LICENSE](LICENSE).
