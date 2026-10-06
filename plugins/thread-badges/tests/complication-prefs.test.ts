import { describe, expect, it } from "vitest";
import {
  DEFAULT_COMPLICATION_PRIORITY,
  defaultPrefs,
  normalizePrefs,
  normalizePrefsMap,
  prefsFor,
} from "../badges/complication-prefs";
import { BADGE_TYPES } from "../badges/catalog";

describe("complication settings", () => {
  it("default to off, after the built-in badges", () => {
    expect(defaultPrefs()).toEqual({
      enabled: false,
      priority: BADGE_TYPES.length + 1,
      showText: false,
      hideWhenComplete: false,
    });
    expect(DEFAULT_COMPLICATION_PRIORITY).toBe(BADGE_TYPES.length + 1);
  });

  it("take each malformed or missing field from the defaults, keeping the good ones", () => {
    expect(normalizePrefs({ enabled: true, priority: "1", showText: 1 })).toEqual({
      ...defaultPrefs(),
      enabled: true,
    });
    expect(normalizePrefs({ priority: Number.POSITIVE_INFINITY })).toEqual(defaultPrefs());
    expect(normalizePrefs({ priority: 2.5, hideWhenComplete: true })).toEqual({
      ...defaultPrefs(),
      priority: 2.5,
      hideWhenComplete: true,
    });
    expect(normalizePrefs(null)).toEqual(defaultPrefs());
    expect(normalizePrefs([true])).toEqual(defaultPrefs());
  });

  it("drop stored entries whose id is not <pluginId>/<name>", () => {
    expect(
      Object.keys(
        normalizePrefsMap({ "follow-up/progress": {}, progress: {}, "A/b": {}, "a/b/c": {} }),
      ),
    ).toEqual(["follow-up/progress"]);
    expect(normalizePrefsMap("nonsense")).toEqual({});
  });

  it("read the defaults for a complication with nothing stored, without inheriting from the prototype", () => {
    expect(prefsFor({}, "x/y")).toEqual(defaultPrefs());
    expect(prefsFor({}, "constructor")).toEqual(defaultPrefs());
  });
});
