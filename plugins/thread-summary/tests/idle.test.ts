import { describe, expect, it } from "vitest";
import { finishedSince, isBusy } from "../lib/idle";

describe("finishedSince", () => {
  it("reports a thread that went from busy to idle", () => {
    const first = finishedSince(new Map(), [{ id: "a", status: "active" }]);
    expect(first.finished).toEqual([]);
    expect(finishedSince(first.busy, [{ id: "a", status: "idle" }]).finished).toEqual(["a"]);
  });

  it("does not report one that stays busy, stays idle, or starts work", () => {
    const busy = new Map([
      ["busy", true],
      ["idle", false],
      ["starting", false],
    ]);
    const { finished } = finishedSince(busy, [
      { id: "busy", status: "stopping" },
      { id: "idle", status: "idle" },
      { id: "starting", status: "starting" },
    ]);
    expect(finished).toEqual([]);
  });

  it("does not report a thread seen for the first time, idle", () => {
    expect(finishedSince(new Map(), [{ id: "new", status: "idle" }]).finished).toEqual([]);
  });

  it("counts an error, or a status it does not know, as idle", () => {
    const busy = new Map([
      ["a", true],
      ["b", true],
    ]);
    expect(
      finishedSince(busy, [
        { id: "a", status: "error" },
        { id: "b", status: "brand-new" },
      ]).finished,
    ).toEqual(["a", "b"]);
    expect(isBusy("starting") && isBusy("active") && isBusy("stopping")).toBe(true);
    expect(isBusy("pending")).toBe(false);
  });
});
