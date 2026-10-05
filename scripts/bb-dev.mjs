#!/usr/bin/env node
// Switch a plugin between its released git tag and this working copy, without
// losing its settings.
//
// bb will not change an installed plugin's source in place — it refuses with
// "already installed from ...", so a switch is remove-then-install. And
// `bb plugin remove` deletes the plugin's settings. That is the whole reason
// this script exists: it reads the settings out first and writes them back
// after, so moving between released and local costs nothing.
//
// What remove does NOT delete is the plugin's own data directory under
// ~/.bb/plugins/<id>/, so recorded follow-ups and the stage catalog survive a
// switch untouched. Only settings need rescuing.
//
//   node scripts/bb-dev.mjs status
//   node scripts/bb-dev.mjs link    <slug|all>   # released tag -> this checkout
//   node scripts/bb-dev.mjs release <slug|all>   # this checkout -> released tag
//   node scripts/bb-dev.mjs reload  <slug>       # one-shot build + reload
//
// Once a plugin is linked, `bb plugin dev plugins/<slug>` is the loop to leave
// running: it rebuilds the frontend unminified and reloads on every save, in
// well under a second. This script does not reimplement that.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGINS = join(REPO, "plugins");
const REMOTE = "https://github.com/matthewdias/bb-plugins.git";

/** Everything about a plugin is derived from its manifest — no table to drift. */
function plugin(slug) {
  const dir = join(PLUGINS, slug);
  const manifestPath = join(dir, "package.json");
  if (!existsSync(manifestPath)) fail(`No plugin at plugins/${slug}`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  // The id bb derives from the package name, which is what every bb command
  // and the plugin's data directory are keyed by.
  const id = manifest.name.replace(/^bb-plugin-/, "");
  return {
    slug,
    dir,
    id,
    version: manifest.version,
    tagPrefix: `${id}/`,
    tag: `${id}/v${manifest.version}`,
    subdir: `plugins/${slug}`,
  };
}

const slugs = () =>
  readdirSync(PLUGINS).filter(
    (name) =>
      !name.startsWith(".") &&
      statSync(join(PLUGINS, name)).isDirectory() &&
      existsSync(join(PLUGINS, name, "package.json")),
  );

function bb(args, { capture = false } = {}) {
  return execFileSync("bb", args, {
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

/**
 * One line of `bb plugin source` — "requested" is what was asked for, "resolved"
 * the tag and commit it landed on — or null when the plugin is not installed.
 */
function sourceLine(id, field) {
  try {
    const out = bb(["plugin", "source", id], { capture: true });
    return out.match(new RegExp(`^\\s*${field}:\\s*(.+)$`, "m"))?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

const currentSource = (id) => sourceLine(id, "requested");

/**
 * Only the values that differ from their declared default are worth carrying
 * across a reinstall — a default that stays default needs no help, and writing
 * every key back would pin values that the plugin may later want to change.
 */
function readSettings(id) {
  let parsed;
  try {
    parsed = JSON.parse(bb(["plugin", "config", id, "--json"], { capture: true }));
  } catch {
    return [];
  }
  const { schema = {}, values = {} } = parsed;
  return Object.entries(values).filter(
    ([key, value]) => JSON.stringify(value) !== JSON.stringify(schema[key]?.default),
  );
}

function writeSettings(id, entries) {
  for (const [key, value] of entries) {
    try {
      bb(["plugin", "config", id, "set", key, String(value)], { capture: true });
    } catch {
      // A setting the new version dropped is not an error worth stopping for.
      console.warn(`  could not restore ${key}`);
    }
  }
}

function swap(p, source, label) {
  const settings = readSettings(p.id);
  console.log(`${p.id}: ${label}`);
  if (settings.length > 0) {
    console.log(`  holding ${settings.length} non-default setting(s)`);
  }
  try {
    bb(["plugin", "remove", p.id], { capture: true });
  } catch {
    // Not installed yet is a fine place to start from.
  }
  bb(["plugin", "install", ...source, "--yes"], { capture: true });
  writeSettings(p.id, settings);
  console.log(`  now: ${currentSource(p.id)}`);
}

const link = (p) =>
  swap(p, [`path:${REPO}`, "--plugin", p.id], "released tag -> this checkout");

/**
 * `@*` resolves to whatever the newest tag is, so a checkout whose bumped
 * version was never tagged would quietly get the previous release. Refuse it
 * here, before anything is removed — every plugin, so `release all` cannot stop
 * halfway with some swapped.
 */
function assertTagged(ps) {
  const missing = ps.filter((p) => {
    const out = execFileSync(
      "git",
      ["ls-remote", "--tags", REMOTE, `refs/tags/${p.tag}`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
    );
    return out.trim() === "";
  });
  if (missing.length > 0) {
    fail(
      `Not tagged on ${REMOTE}: ${missing.map((p) => p.tag).join(", ")}.\n` +
        "Push the tag first, or release from a checkout whose version is tagged. " +
        "Nothing was changed.",
    );
  }
}

// A bare range, not a pinned `^X.Y.Z`: on a 0.x version a caret cannot reach
// the next minor, so `bb plugin update` would stop following the plugin. bb
// rejects `@semver:*` alongside --tag-prefix, which is why it is spelled `@*`.
function release(p) {
  swap(
    p,
    [`git:${REMOTE}@*`, "--subdirectory", p.subdir, "--tag-prefix", p.tagPrefix],
    `this checkout -> newest ${p.tagPrefix} tag`,
  );
  const resolved = sourceLine(p.id, "resolved");
  if (resolved === null) {
    console.warn("  note: could not read which tag was installed");
    return;
  }
  console.log(`  resolved: ${resolved}`);
  // Not necessarily a newer one: `@*` skips pre-releases, so a checkout at
  // 0.8.0-beta.1 gets the newest stable release, which is older.
  if (!resolved.includes(`@${p.tag} `)) {
    console.warn(`  note: this checkout is ${p.tag}; a different tag was installed`);
  }
}

function reload(p) {
  const started = Date.now();
  bb(["plugin", "build", p.dir], { capture: true });
  bb(["plugin", "reload", p.id], { capture: true });
  console.log(`  reloaded ${p.id} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

function status() {
  for (const slug of slugs()) {
    const p = plugin(slug);
    const source = currentSource(p.id) ?? "not installed";
    const mode = source.startsWith("path:")
      ? "LOCAL "
      : source.startsWith("git:")
        ? "tagged"
        : "      ";
    console.log(`${mode}  ${p.id.padEnd(16)} ${source}`);
  }
}

const [command, target] = process.argv.slice(2);
const targets = () => {
  if (target === "all") return slugs().map(plugin);
  if (!target) fail(`Which plugin? One of: ${slugs().join(", ")}, or "all".`);
  return [plugin(target)];
};

switch (command) {
  case "status":
    status();
    break;
  case "link":
    targets().forEach(link);
    break;
  case "release": {
    const ps = targets();
    assertTagged(ps);
    ps.forEach(release);
    break;
  }
  case "reload":
    targets().forEach(reload);
    break;
  default:
    console.log(readFileSync(fileURLToPath(import.meta.url), "utf8")
      .split("\n")
      .filter((line) => line.startsWith("//"))
      .map((line) => line.replace(/^\/\/ ?/, ""))
      .join("\n"));
    process.exit(command ? 1 : 0);
}
