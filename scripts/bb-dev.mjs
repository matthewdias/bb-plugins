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
    range: `^${manifest.version}`,
    tagPrefix: `${id}/`,
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

/** The installed source line, or null when the plugin is not installed. */
function currentSource(id) {
  try {
    const out = bb(["plugin", "source", id], { capture: true });
    return out.match(/^\s*requested:\s*(.+)$/m)?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

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

const release = (p) =>
  swap(
    p,
    [
      `git:${REMOTE}@${p.range}`,
      "--subdirectory",
      p.subdir,
      "--tag-prefix",
      p.tagPrefix,
    ],
    `this checkout -> ${p.tagPrefix}v${p.version}`,
  );

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
  case "release":
    targets().forEach(release);
    break;
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
