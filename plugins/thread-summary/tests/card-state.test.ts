import { describe, expect, it } from "vitest";
import { closesOn, isOutside, readState, writeState } from "../lib/card-state";

function memory(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  } as Storage;
}

describe("device state", () => {
  it("defaults to compact and unpinned", () => {
    expect(readState("thread-summary", memory())).toEqual({ mode: "compact", pinned: false });
  });

  it("remembers mode and pin per device, under the plugin's id", () => {
    const store = memory();
    writeState("thread-summary", { mode: "expanded" }, store);
    writeState("thread-summary", { pinned: true }, store);
    expect(readState("thread-summary", store)).toEqual({ mode: "expanded", pinned: true });
    expect(readState("a-copy", store)).toEqual({ mode: "compact", pinned: false });
  });

  it("reads anything unexpected as the default", () => {
    const store = memory();
    store.setItem("thread-summary:mode", "huge");
    store.setItem("thread-summary:pinned", "yes");
    expect(readState("thread-summary", store)).toEqual({ mode: "compact", pinned: false });
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
    expect(readState("thread-summary", broken)).toEqual({ mode: "compact", pinned: false });
    expect(() => writeState("thread-summary", { pinned: true }, broken)).not.toThrow();
  });
});

describe("closing", () => {
  it("closes an unpinned card on Escape, an outside click or a thread switch", () => {
    for (const reason of ["escape", "outside", "thread-switch"] as const) {
      expect(closesOn(reason, false)).toBe(true);
      expect(closesOn(reason, true)).toBe(false);
    }
  });
});

describe("isOutside", () => {
  function dom() {
    document.body.innerHTML = `
      <div id="card"><button id="inside">x</button></div>
      <span id="control"><button id="chip">c</button></span>
      <div data-bb-portaled-overlay><div role="menu"><button id="menu-item">m</button></div></div>
      <main><p id="chat">chat</p></main>`;
    const get = (id: string) => document.getElementById(id)!;
    return { get, card: get("card"), control: get("control") };
  }

  it("is outside for the chat", () => {
    const { get, card, control } = dom();
    expect(isOutside(get("chat"), card, control)).toBe(true);
  });

  it("is not outside for the card, the header control or a chip in it", () => {
    const { get, card, control } = dom();
    expect(isOutside(get("inside"), card, control)).toBe(false);
    expect(isOutside(get("chip"), card, control)).toBe(false);
  });

  it("is not outside for bb's portaled menus, popovers and previews", () => {
    const { get, card, control } = dom();
    expect(isOutside(get("menu-item"), card, control)).toBe(false);
  });

  it("is not outside for a target that is not an element", () => {
    const { card, control } = dom();
    expect(isOutside(null, card, control)).toBe(false);
    expect(isOutside(window, card, control)).toBe(false);
  });
});
