# Contributing

Run the repository check before opening a pull request:

```sh
npm ci
npm run check
```

That typechecks, tests, and builds all three plugins.

## Two rules that are not obvious

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
