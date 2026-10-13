import { describe, expect, it, vi } from "vitest";
import { rowContent, threadListPreferencesSchema } from "../lib/row-actions.ts";
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
  const content = (keys: string[], ran = vi.fn()) => rowContent(evaluate(keys, thread, ran), thread);

  it("names each action for the thread's state", () => {
    const row = content(["bb--core/read", "bb--core/pin", "bb--core/archive"]);
    expect(row.leading).toMatchObject({ label: "Unread", icon: "Mail" });
    expect(row.trailing.map((button) => button.label)).toEqual(["Unpin", "Archive"]);
    expect(row.archive).toBe(row.trailing[1]);
  });

  it("can't archive without Archive", () => {
    expect(content(["bb--core/split", "bb--core/copyLink"]).archive).toBe(null);
  });

  it("runs bb's action", () => {
    const ran = vi.fn();
    const row = content(["bb--core/read", "bb--core/pin"], ran);
    row.leading?.run();
    row.trailing[0]?.run();
    expect(ran.mock.calls).toEqual([["bb--core/read"], ["bb--core/pin"]]);
  });
});

describe("an action bb has disabled", () => {
  const entry = (key: string) => ({ key, action: { label: "x", icon: "Zap", disabled: true, run: () => {} } });

  it("can't be the full swipe or the rightward swipe", () => {
    const row = rowContent([entry("bb--core/read"), entry("bb--core/archive")], { isUnread: true });
    expect(row.leading).toBe(null);
    expect(row.archive).toBe(null);
    expect(row.trailing.map((button) => button.disabled)).toEqual([true]);
  });
});
