import { describe, expect, it } from "vitest";
import { readState, writeState } from "../lib/card-state";

function memory(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  } as Storage;
}

describe("device state", () => {
  it("starts hidden", () => {
    expect(readState("thread-summary", memory())).toEqual({ shown: false });
  });

  it("remembers showing per device, under the plugin's id", () => {
    const store = memory();
    writeState("thread-summary", { shown: true }, store);
    expect(readState("thread-summary", store)).toEqual({ shown: true });
    expect(readState("a-copy", store)).toEqual({ shown: false });
    writeState("thread-summary", { shown: false }, store);
    expect(readState("thread-summary", store)).toEqual({ shown: false });
  });

  it("reads anything unexpected as hidden, and ignores the old mode and pin", () => {
    const store = memory();
    store.setItem("thread-summary:shown", "yes");
    store.setItem("thread-summary:pinned", "true");
    store.setItem("thread-summary:mode", "expanded");
    expect(readState("thread-summary", store)).toEqual({ shown: false });
  });

  it("survives a store that throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    } as unknown as Storage;
    expect(readState("thread-summary", broken)).toEqual({ shown: false });
    expect(() => writeState("thread-summary", { shown: true }, broken)).not.toThrow();
  });
});
