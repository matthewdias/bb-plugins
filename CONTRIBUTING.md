# Contributing

Run the repository check before opening a pull request:

```sh
npm ci
npm run check
```

That typechecks, tests, and builds every plugin.

## Testing a change locally

A plugin installed from a git tag runs bb's copy of the released code, so
`bb plugin dev` refuses it — it needs the working copy to *be* the installed
source. Switching sources means `bb plugin remove` then `bb plugin install`,
because bb will not change a source in place, and **remove deletes the plugin's
settings**.

`scripts/bb-dev.mjs` handles that, carrying the non-default settings across the
swap so it costs nothing:

```sh
npm run plugins                    # what each plugin is installed from
npm run link -- thread-badges      # released tag -> this checkout
bb plugin dev plugins/thread-badges   # rebuild + reload on every save
npm run release -- thread-badges   # this checkout -> the released tag
```

`release` follows the newest tag, so `bb plugin update` keeps tracking it, and
refuses — before removing anything — when the checkout's version has no tag
yet. `link all` and `release all` take every plugin at once. `npm run bb --
reload <slug>` is a one-shot build and reload for when you are not leaving the
watcher running.

What removal does *not* touch is the plugin's data directory under
`~/.bb/plugins/<id>/`, so recorded follow-ups and the stage catalog survive a
switch untouched. Settings are the only casualty, and the script rescues those.

One thing it cannot carry: `bb plugin remove` also drops a plugin's secrets and
schedules, and there is no read API to save those first. None of these four
declares either. Background services are safe — they are declared in code, so
they re-register on install.

## Three rules that are not obvious

**Every runtime dependency belongs in the plugin's own `package.json`, under
`dependencies`.** bb installs a single subdirectory out of this repository and
runs `npm install --omit=dev` inside it, so a dependency hoisted to the root, or
one parked in `devDependencies`, is a dependency the installed plugin does not
have. The root manifest carries orchestration scripts only.

The exception is the modules bb injects itself. Its build rewrites those imports
to its own runtime and never resolves them from `node_modules`, so `react`,
`clsx`, `tailwind-merge`, `class-variance-authority` and the shimmed Radix
families are safe in `devDependencies` and belong there. `zod` is *not* shimmed,
which is why it is the one that breaks builds.

Judge this by running it, not by reading the manifest:

```sh
cd "$(mktemp -d)" && cp -R /path/to/repo/plugins/follow-up . && cd follow-up
rm -rf node_modules dist && npm install --omit=dev && bb plugin build .
```

**Keep each plugin's `package-lock.json` committed and current.** The root lock
governs the workspace; the nested ones are what a subdirectory install resolves
against. After changing a plugin's dependencies, regenerate its lock from a copy
of that directory alone, so workspace hoisting does not leak into it.

**A module two plugins share is copied.** A workspace package would not
install, because a plugin installs alone. A published npm package would, but it
runs the same way, because bb bundles each plugin's dependencies into that
plugin. Until something outside this repository needs it, copying one file is
cheaper than a publish pipeline. So `lib/complications.ts` lives in every plugin
that provides or draws a complication, byte for byte. Edit one copy, copy it
over the others, and `npm run check` fails first thing if you forget: the copies
are listed in `scripts/check-vendored.mjs`.

Released copies can still disagree at runtime, because whichever bundle loads
first creates the registry every other plugin uses. Bump
`COMPLICATIONS_IMPLEMENTATION` with any change in its behaviour, fixes included,
so that a newer copy can tell, in the console, when an older one is in charge.
The module's header says what that freezes.

## Releasing

Each plugin releases under its own tag prefix, so a semver range tracks one
plugin rather than the repository:

```sh
git tag -a follow-up/v0.3.0 -m "Release follow-up v0.3.0"
git push origin main
git push origin follow-up/v0.3.0
```

Tags are immutable. bb records the commit a tag pointed at and refuses the
plugin if the tag ever moves, so publish a fix as a new version rather than
retagging.

Bump the version in the plugin's `package.json` in the same commit, and update
its `PLUGIN_OVERVIEW.md` whenever `bb.description` or a surface changes — the
store shows the two together and they must not disagree.

A README's install snippet needs no attention: it names the bare range `@*`,
which `--tag-prefix` resolves to the newest tag under that plugin's prefix.
Don't spell it `@semver:*` — bb rejects an explicit `semver:` spec alongside
`--tag-prefix`. Do not put a version in one either. Every snippet that named a
range went stale, and a caret range on a `0.x` version goes stale on the very
next release — `^0.1.0` cannot reach `0.2.0` at all, so readers were installing
a plugin two minor versions behind.
