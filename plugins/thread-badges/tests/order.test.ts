import { describe, expect, it } from "vitest";
import { BADGE_TYPES, enabledKey, priorityKey } from "../badges/catalog";
import { DEFAULT_COMPLICATION_PRIORITY, defaultPrefs } from "../badges/complication-prefs";
import { orderedEntries, type RowEntry } from "../badges/order";

const keys = (entries: readonly RowEntry[]) => entries.map((entry) => entry.key);
const on = (priority = DEFAULT_COMPLICATION_PRIORITY) => ({ ...defaultPrefs(), enabled: true, priority });

describe("orderedEntries", () => {
  it("draws the enabled built-ins in catalog order when nothing has been touched", () => {
    expect(keys(orderedEntries({}, [], {}))).toEqual([
      "builtin:pullRequest",
      "builtin:prChecks",
    ]);
  });

  it("leaves out a provider's complication until it is turned on", () => {
    expect(keys(orderedEntries({}, ["follow-up/progress"], {}))).not.toContain(
      "complication:follow-up/progress",
    );
    expect(
      keys(orderedEntries({}, ["follow-up/progress"], { "follow-up/progress": on() })),
    ).toEqual(["builtin:pullRequest", "builtin:prChecks", "complication:follow-up/progress"]);
  });

  it("leaves out a complication whose plugin is not running, however it is set", () => {
    expect(keys(orderedEntries({}, [], { "follow-up/progress": on(0) }))).not.toContain(
      "complication:follow-up/progress",
    );
  });

  it("puts built-ins and complications on one priority scale", () => {
    const entries = orderedEntries(
      { [priorityKey("pullRequest")]: 5 },
      ["follow-up/progress"],
      { "follow-up/progress": on(1) },
    );
    expect(keys(entries)).toEqual([
      "complication:follow-up/progress",
      "builtin:prChecks",
      "builtin:pullRequest",
    ]);
  });

  it("breaks ties built-ins first, then catalog and discovery order", () => {
    const entries = orderedEntries(
      Object.fromEntries(BADGE_TYPES.map((type) => [priorityKey(type.id), 1])),
      ["b/second", "a/first"],
      { "a/first": on(1), "b/second": on(1) },
    );
    expect(keys(entries)).toEqual([
      "builtin:pullRequest",
      "builtin:prChecks",
      "complication:b/second",
      "complication:a/first",
    ]);
  });

  it("drops a built-in that is switched off", () => {
    expect(keys(orderedEntries({ [enabledKey("prChecks")]: false }, [], {}))).toEqual([
      "builtin:pullRequest",
    ]);
  });

  it("hands each complication entry its own settings", () => {
    const prefs = { ...on(), showText: true };
    const [entry] = orderedEntries({ [enabledKey("pullRequest")]: false, [enabledKey("prChecks")]: false }, ["x/y"], {
      "x/y": prefs,
    });
    expect(entry).toEqual({ kind: "complication", key: "complication:x/y", id: "x/y", prefs });
  });
});
