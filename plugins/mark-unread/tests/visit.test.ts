import { beforeEach, describe, expect, it } from "vitest";
import { readVisit, VISIT_KEY, visitFor, writeVisit } from "../src/visit";

beforeEach(() => sessionStorage.clear());

describe("visits", () => {
  it("round-trips through storage", () => {
    const visit = { threadId: "thr_a", startedAt: 100, revealedSetAt: 50 };
    writeVisit(sessionStorage, visit);
    expect(readVisit(sessionStorage)).toEqual(visit);
    writeVisit(sessionStorage, null);
    expect(readVisit(sessionStorage)).toBeNull();
  });

  it("continues the stored visit for the same thread", () => {
    writeVisit(sessionStorage, { threadId: "thr_a", startedAt: 100, revealedSetAt: null });
    expect(visitFor(sessionStorage, "thr_a", 999)).toEqual({ threadId: "thr_a", startedAt: 100, revealedSetAt: null });
  });

  it("starts a new visit for another thread", () => {
    writeVisit(sessionStorage, { threadId: "thr_a", startedAt: 100, revealedSetAt: 50 });
    expect(visitFor(sessionStorage, "thr_b", 999)).toEqual({ threadId: "thr_b", startedAt: 999, revealedSetAt: null });
  });

  it("has no visit without a thread", () => {
    expect(visitFor(sessionStorage, null, 999)).toBeNull();
  });

  it.each([
    ["not JSON", "{"],
    ["not an object", "42"],
    ["no thread", JSON.stringify({ startedAt: 1 })],
    ["an empty thread", JSON.stringify({ threadId: "", startedAt: 1 })],
    ["no start", JSON.stringify({ threadId: "thr_a" })],
  ])("treats a stored value that is %s as no visit", (_label, raw) => {
    sessionStorage.setItem(VISIT_KEY, raw);
    expect(readVisit(sessionStorage)).toBeNull();
  });

  it("reads a missing reveal as not revealed", () => {
    sessionStorage.setItem(VISIT_KEY, JSON.stringify({ threadId: "thr_a", startedAt: 1, revealedSetAt: "x" }));
    expect(readVisit(sessionStorage)?.revealedSetAt).toBeNull();
  });

  it("survives storage that refuses writes", () => {
    const refusing = { setItem: () => { throw new Error("QuotaExceededError"); }, removeItem: () => {} } as unknown as Storage;
    expect(() => writeVisit(refusing, { threadId: "thr_a", startedAt: 1, revealedSetAt: null })).not.toThrow();
  });
});
