#!/usr/bin/env node
// Fail when a vendored module's copies have drifted apart.
//
// bb installs each plugin from its own subdirectory, so code two plugins share
// cannot live in a workspace package. A published one would work, but bb
// bundles it into each plugin all the same, so for now it is simply copied
// into each. Those copies are one contract, and the complications registry is
// the sharpest case: whichever bundle loads first creates the registry that
// every other bundle then calls, so two copies that disagree are two plugins
// that disagree about the protocol, at runtime, depending on load order.
//
// Each entry lists every copy. Edit one, then copy it over the rest.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const VENDORED = [
  [
    "plugins/follow-up/lib/complications.ts",
    "plugins/thread-badges/lib/complications.ts",
    "plugins/thread-summary/lib/complications.ts",
  ],
];

let drifted = false;
for (const [canonical, ...copies] of VENDORED) {
  const expected = readFileSync(join(REPO, canonical), "utf8");
  for (const copy of copies) {
    if (readFileSync(join(REPO, copy), "utf8") === expected) continue;
    drifted = true;
    console.error(`${copy} has drifted from ${canonical}. Copy one over the other.`);
  }
}
if (drifted) process.exit(1);
