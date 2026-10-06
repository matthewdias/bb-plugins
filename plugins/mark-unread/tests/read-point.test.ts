import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODIFIER,
  modifierMatches,
  type ModifierSetting,
  parseModifier,
  parseRowId,
  seenDuringVisit,
  turnRowPrefix,
} from "../lib/read-point";

// Ids as bb 0.45.0 renders them, copied from a live timeline.
const USER = "thr_z9cdr3qmhz:user-seed:497";
const AGENT = "thr_z9cdr3qmhz:assistant:kind:assistant|turn:daf295ee7c-t3|parent:root|item:daf295ee7c-i89";
const TURN = "thr_z9cdr3qmhz:daf295ee7c-t1:turn";
const TURN_SPLIT = "thr_z9cdr3qmhz:daf295ee7c-t2:turn:0";
const WORK =
  "thr_z9cdr3qmhz:daf295ee7c-t4:work-summary:thr_z9cdr3qmhz:command:daf295ee7c-i105";
const COMMAND = "thr_z9cdr3qmhz:command:daf295ee7c-i105";

describe("parseRowId", () => {
  it("reads a message you sent, with its sequence number", () => {
    expect(parseRowId(USER)).toEqual({ threadId: "thr_z9cdr3qmhz", kind: "user", seq: 497, turnId: null });
  });

  it("reads an agent message and the turn it belongs to", () => {
    expect(parseRowId(AGENT)).toEqual({
      threadId: "thr_z9cdr3qmhz",
      kind: "assistant",
      seq: null,
      turnId: "daf295ee7c-t3",
    });
  });

  it("reads a turn's summary rows as not messages, with their turn", () => {
    expect(parseRowId(TURN)).toMatchObject({ kind: "other", turnId: "daf295ee7c-t1" });
    expect(parseRowId(TURN_SPLIT)).toMatchObject({ kind: "other", turnId: "daf295ee7c-t2" });
    expect(parseRowId(WORK)).toMatchObject({ kind: "other", turnId: "daf295ee7c-t4" });
  });

  it("reads a command as not a message, with no turn", () => {
    expect(parseRowId(COMMAND)).toMatchObject({ kind: "other", turnId: null });
  });

  it("refuses ids with no thread", () => {
    expect(parseRowId("")).toBeNull();
    expect(parseRowId(":user-seed:1")).toBeNull();
    expect(parseRowId("no-colon")).toBeNull();
  });

  it("does not take a user-seed that is not the whole remainder", () => {
    expect(parseRowId("thr_a:user-seed:12:extra")).toMatchObject({ kind: "other" });
  });
});

describe("turnRowPrefix", () => {
  it("matches the turn's summary rows and not another turn's", () => {
    const prefix = turnRowPrefix("thr_z9cdr3qmhz", "daf295ee7c-t1");
    expect(TURN.startsWith(prefix)).toBe(true);
    expect(TURN_SPLIT.startsWith(prefix)).toBe(false);
    // t1 must not match t10.
    expect("thr_z9cdr3qmhz:daf295ee7c-t10:turn".startsWith(prefix)).toBe(false);
  });
});

describe("seenDuringVisit", () => {
  it("counts a visit that began after the point was set", () => {
    expect(seenDuringVisit({ setAt: 100 }, 101)).toBe(true);
  });

  it("does not count the visit the point was set in", () => {
    expect(seenDuringVisit({ setAt: 100 }, 99)).toBe(false);
    expect(seenDuringVisit({ setAt: 100 }, 100)).toBe(false);
  });
});

describe("modifiers", () => {
  const none = { altKey: false, metaKey: false, ctrlKey: false, shiftKey: false };

  it.each<[ModifierSetting, keyof typeof none]>([
    ["Option", "altKey"],
    ["Command", "metaKey"],
    ["Shift", "shiftKey"],
  ])("%s matches %s alone", (setting, key) => {
    expect(modifierMatches(setting, { ...none, [key]: true })).toBe(true);
  });

  it("needs the modifier held", () => {
    expect(modifierMatches("Option", none)).toBe(false);
  });

  it("does not match a different modifier", () => {
    expect(modifierMatches("Option", { ...none, metaKey: true })).toBe(false);
    expect(modifierMatches("Command", { ...none, altKey: true })).toBe(false);
  });

  it("does not match with another modifier also held", () => {
    expect(modifierMatches("Option", { ...none, altKey: true, shiftKey: true })).toBe(false);
    expect(modifierMatches("Shift", { ...none, shiftKey: true, metaKey: true })).toBe(false);
  });

  it("never matches with Control held", () => {
    expect(modifierMatches("Option", { ...none, altKey: true, ctrlKey: true })).toBe(false);
  });

  it("never matches when switched off", () => {
    expect(modifierMatches("Off", { ...none, altKey: true })).toBe(false);
  });

  it("falls back to the default for a stored value it does not know", () => {
    expect(parseModifier("Shift")).toBe("Shift");
    expect(parseModifier("Control")).toBe(DEFAULT_MODIFIER);
    expect(parseModifier(undefined)).toBe(DEFAULT_MODIFIER);
  });
});
