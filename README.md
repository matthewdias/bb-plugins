# bb-plugins

Three plugins for [bb](https://github.com/get-bb/bb), the agent IDE.

| Plugin | |
| --- | --- |
| **[Follow Up](plugins/follow-up)** | Keeps the work an agent noticed but skipped, so nothing is lost when a turn ends. Triage what a thread accumulated above the composer. |
| **[Thread Badges](plugins/thread-badges)** | Shows pull-request state, CI attention and follow-up progress on sidebar rows, so you see what needs you without opening a thread. |
| **[Workflow Stages](plugins/workflow-stages)** | Files every thread under a workflow stage you define, and moves it as the work progresses. Requires the Ribbon sidebar. |

Each is independent. Two soft connections exist and neither is required: Thread
Badges draws a follow-up ring when Follow Up is installed, and Workflow Stages
needs [Ribbon sidebar](https://github.com/ariofrio/ribbon) to have anywhere to
draw.

## Install

One at a time, by subdirectory:

```sh
bb plugin install "git:https://github.com/matthewdias/bb-plugins.git@^0.3.0" \
  --subdirectory plugins/follow-up --tag-prefix follow-up/

bb plugin install "git:https://github.com/matthewdias/bb-plugins.git@^0.1.0" \
  --subdirectory plugins/thread-badges --tag-prefix thread-badges/

bb plugin install "git:https://github.com/matthewdias/bb-plugins.git@^0.1.0" \
  --subdirectory plugins/workflow-stages --tag-prefix workflow-stages/
```

Each plugin is released under its own tag prefix, so a range tracks that plugin
alone. `--plugin <name>` works instead of `--subdirectory` — the repository
carries a `.bb/plugins.json` index naming all three.

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
