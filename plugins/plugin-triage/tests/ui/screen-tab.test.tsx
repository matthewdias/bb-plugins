// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useScreenTab } from "../../ui/screen-tab";

describe("the Triage tab in the Plugins screen's address", () => {
  it("opens on the tab the address names", () => {
    window.history.replaceState({}, "", "/plugins?view=triage&tab=cleanup");
    const { result } = renderHook(() => useScreenTab());
    expect(result.current[0]).toBe("cleanup");
  });

  it("pushes a history entry per switch, and Back walks them", async () => {
    window.history.replaceState({}, "", "/plugins?view=triage");
    const { result } = renderHook(() => useScreenTab());
    expect(result.current[0]).toBe("new");
    const before = window.history.length;
    act(() => result.current[1]("updates"));
    expect(window.location.search).toBe("?view=triage&tab=updates");
    expect(result.current[0]).toBe("updates");
    act(() => result.current[1]("saved"));
    expect(window.history.length).toBe(before + 2);
    await act(async () => {
      window.history.back();
      await new Promise((resolve) => window.addEventListener("popstate", resolve, { once: true }));
    });
    expect(result.current[0]).toBe("updates");
  });

  it("keeps a detail pane's path while switching", () => {
    window.history.replaceState({}, "", "/plugins/notes?view=triage&tab=updates");
    const { result } = renderHook(() => useScreenTab());
    act(() => result.current[1]("new"));
    expect(window.location.pathname + window.location.search).toBe("/plugins/notes?view=triage");
  });

  it("leaves the tab alone when bb navigates without announcing it", () => {
    window.history.replaceState({}, "", "/plugins/notes?view=triage&tab=cleanup");
    const { result, rerender } = renderHook(() => useScreenTab());
    // bb closing a detail pane: a pushState with no popstate.
    window.history.pushState({}, "", "/plugins?view=triage");
    rerender();
    expect(result.current[0]).toBe("cleanup");
  });
});
