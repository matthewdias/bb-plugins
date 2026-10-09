import { afterEach, describe, expect, it, vi } from "vitest";
import { isOpen, markOpen, onOpenChange } from "../../src/open-cards";

const stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

describe("open cards", () => {
  it("stays open until every card for the thread has closed", () => {
    const changes = vi.fn();
    stops.push(onOpenChange(changes));
    const closeA = markOpen("thr_split");
    const closeB = markOpen("thr_split");
    expect(changes.mock.calls).toEqual([["thr_split", true]]);
    closeA();
    expect(isOpen("thr_split")).toBe(true);
    expect(changes.mock.calls).toEqual([["thr_split", true]]);
    closeB();
    expect(isOpen("thr_split")).toBe(false);
    expect(changes.mock.calls).toEqual([
      ["thr_split", true],
      ["thr_split", false],
    ]);
  });

  it("closes once however often the same close is called", () => {
    const closeA = markOpen("thr_twice");
    const closeB = markOpen("thr_twice");
    closeA();
    closeA();
    expect(isOpen("thr_twice")).toBe(true);
    closeB();
    expect(isOpen("thr_twice")).toBe(false);
  });

  it("keeps threads apart", () => {
    const close = markOpen("thr_one");
    expect(isOpen("thr_other")).toBe(false);
    close();
  });
});
