import { describe, expect, it, vi } from "vitest";
import { type RowActionKeys, keysOf, rowContent, threadListPreferencesSchema } from "../lib/row-actions.ts";
import { evaluate } from "./helpers.ts";

const preferences = (rowActions: unknown) => ({ preferences: { organizationMode: "project", rowActions } });
const read = (rowActions: unknown) => threadListPreferencesSchema.parse(preferences(rowActions));

describe("reading the thread list's preference", () => {
  it("takes rowActions out of listPreferences, as thread action keys", () => {
    expect(read(["bb--core/read", "thread-list/move", "acme/deploy"])).toEqual([
      "bb--core/read",
      "thread-list/move",
      "acme/deploy",
    ]);
  });

  it("turns the names from before bb 0.46 into keys, as the thread list does", () => {
    expect(read(["read", "pin", "archive"])).toEqual(["bb--core/read", "bb--core/pin", "bb--core/archive"]);
    expect(read(["split", "copyLink", "rename"])).toEqual(["bb--core/split", "bb--core/copyLink", "bb--core/rename"]);
    expect(read(["move", "core/pin"])).toEqual(["thread-list/move", "bb--core/pin"]);
  });

  it("drops what isn't a key and repeats, and keeps three", () => {
    expect(read(["bb--core/pin", "snooze", 7, "pin", "a/b/c", "bb--core/split", "x/y", "bb--core/archive"])).toEqual([
      "bb--core/pin",
      "bb--core/split",
      "x/y",
    ]);
  });

  it("takes an empty list as no actions", () => {
    expect(read([])).toEqual([]);
  });

  it("rejects a result without the preference", () => {
    expect(() => threadListPreferencesSchema.parse({ preferences: {} })).toThrow();
    expect(() => read("bb--core/archive")).toThrow();
  });
});

describe("a row's content", () => {
  const thread = { isUnread: false, isPinned: true, isArchived: false };
  const READ = "bb--core/read";
  const PIN = "bb--core/pin";
  const ARCHIVE = "bb--core/archive";
  const content = (keys: Partial<RowActionKeys>, ran = vi.fn()) => {
    const all = { rowActions: [], right: null, fullLeft: null, ...keys };
    return rowContent(evaluate(keysOf(all), thread, ran), thread, all);
  };

  it("asks bb about every action a row needs, once each", () => {
    expect(keysOf({ rowActions: [PIN, ARCHIVE], right: READ, fullLeft: ARCHIVE })).toEqual([PIN, ARCHIVE, READ]);
    expect(keysOf({ rowActions: [PIN], right: null, fullLeft: null })).toEqual([PIN]);
  });

  it("names each action for the thread's state", () => {
    const row = content({ rowActions: [PIN, ARCHIVE], right: READ });
    expect(row.leading).toMatchObject({ label: "Unread", title: "Mark unread", icon: "Mail" });
    expect(row.trailing.map((button) => button.label)).toEqual(["Unpin", "Archive"]);
  });

  it("takes the whole swipes from the settings, whatever the row actions are", () => {
    const row = content({ rowActions: [PIN], right: READ, fullLeft: ARCHIVE });
    expect(row.leading?.key).toBe(READ);
    expect(row.trailing.map((button) => button.key)).toEqual([PIN]);
    expect(row.full).toMatchObject({ key: ARCHIVE, label: "Archive" });
  });

  it("makes the full swipe its own button when it is a row action", () => {
    const row = content({ rowActions: [PIN, ARCHIVE], fullLeft: ARCHIVE });
    expect(row.full).toBe(row.trailing[1]);
  });

  it("doesn't repeat the swipe right's action as a button", () => {
    expect(content({ rowActions: [READ, PIN], right: READ }).trailing.map((button) => button.key)).toEqual([PIN]);
    expect(content({ rowActions: [READ, PIN], right: PIN }).trailing.map((button) => button.key)).toEqual([READ]);
  });

  it("has no whole swipe for Nothing, or for an action that asks a further question", () => {
    expect(content({ rowActions: [PIN] })).toMatchObject({ leading: null, full: null });
    expect(content({ right: "thread-list/move", fullLeft: "thread-list/move" })).toMatchObject({
      leading: null,
      full: null,
    });
  });

  it("runs bb's action", () => {
    const ran = vi.fn();
    const row = content({ rowActions: [PIN], right: READ, fullLeft: ARCHIVE }, ran);
    row.leading?.run();
    row.trailing[0]?.run();
    row.full?.run();
    expect(ran.mock.calls).toEqual([[READ], [PIN], [ARCHIVE]]);
  });
});

describe("an action bb has disabled", () => {
  const entry = (key: string) => ({ key, action: { label: "x", icon: "Zap", disabled: true, run: () => {} } });
  const keys = { rowActions: ["bb--core/archive"], right: "bb--core/read", fullLeft: "bb--core/archive" };

  it("can't be a whole swipe, and shows as a button that can't be pressed", () => {
    const row = rowContent([entry("bb--core/read"), entry("bb--core/archive")], { isUnread: true }, keys);
    expect(row.leading).toBe(null);
    expect(row.full).toBe(null);
    expect(row.trailing.map((button) => button.disabled)).toEqual([true]);
  });
});
