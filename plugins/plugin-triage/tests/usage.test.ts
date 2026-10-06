import { describe, expect, it } from "vitest";
import { observe } from "../lib/usage";

const plugin = (id: string, count: number, enabled = true) => ({ id, enabled, handlerStats: { count } });

describe("usage samples", () => {
  it("starts watching a plugin, counting any activity since the server started as now", () => {
    const seen = observe({}, [plugin("busy", 5), plugin("quiet", 0)], 100);
    expect(seen.busy).toMatchObject({ firstSeenAt: 100, lastCount: 5, lastActiveAt: 100 });
    expect(seen.quiet).toMatchObject({ lastActiveAt: null });
  });

  it("marks a plugin active when its count goes up, and not when it stays", () => {
    const first = observe({}, [plugin("a", 3)], 100);
    expect(observe(first, [plugin("a", 3)], 200).a!.lastActiveAt).toBe(100);
    expect(observe(first, [plugin("a", 4)], 300).a!.lastActiveAt).toBe(300);
  });

  it("reads a drop as a server restart: active if anything happened since, not otherwise", () => {
    const first = observe({}, [plugin("a", 50), plugin("b", 50)], 100);
    const after = observe(first, [plugin("a", 2), plugin("b", 0)], 200);
    expect(after.a!.lastActiveAt).toBe(200);
    expect(after.b!.lastActiveAt).toBe(100);
    expect(after.b!.lastCount).toBe(0);
  });

  it("notes when a plugin was turned off, and whether that was before watching", () => {
    const first = observe({}, [plugin("old", 0, false), plugin("a", 0)], 100);
    expect(first.old).toMatchObject({ disabledSince: 100, disabledBeforeWatching: true });
    const later = observe(first, [plugin("old", 0, false), plugin("a", 0, false)], 200);
    expect(later.old).toMatchObject({ disabledSince: 100, disabledBeforeWatching: true });
    expect(later.a).toMatchObject({ disabledSince: 200, disabledBeforeWatching: false });
    expect(observe(later, [plugin("a", 0, true)], 300).a).toMatchObject({ disabledSince: null, disabledBeforeWatching: false });
  });

  it("forgets plugins no longer installed", () => {
    expect(Object.keys(observe(observe({}, [plugin("gone", 1)], 1), [], 2))).toEqual([]);
  });
});
