import { describe, expect, it } from "vitest";
import { searchForTab, subPathForTab, tabFromSearch, tabFromSubPath } from "../lib/tabs";

describe("Triage tabs in the address", () => {
  it("reads the tab from the Plugins screen's query, New by default", () => {
    expect(tabFromSearch("?view=triage")).toBe("new");
    expect(tabFromSearch("?view=triage&tab=updates")).toBe("updates");
    expect(tabFromSearch("?view=triage&tab=cleanup")).toBe("cleanup");
    expect(tabFromSearch("?tab=saved&view=triage")).toBe("saved");
    expect(tabFromSearch("?view=triage&tab=nope")).toBe("new");
  });

  it("writes the tab beside view=triage, leaving New out", () => {
    expect(searchForTab("?view=triage", "updates")).toBe("?view=triage&tab=updates");
    expect(searchForTab("?view=triage&tab=updates", "saved")).toBe("?view=triage&tab=saved");
    expect(searchForTab("?view=triage&tab=updates", "new")).toBe("?view=triage");
    expect(searchForTab("", "new")).toBe("");
  });

  it("reads and writes the sidebar item's sub-path", () => {
    expect(tabFromSubPath("")).toBe("new");
    expect(tabFromSubPath("cleanup")).toBe("cleanup");
    expect(tabFromSubPath("updates/")).toBe("updates");
    expect(tabFromSubPath("whatever")).toBe("new");
    expect(subPathForTab("new")).toBe("");
    expect(subPathForTab("saved")).toBe("saved");
  });
});

describe("detail links from a tab", () => {
  it("open bb's detail pane beside the same tab", async () => {
    const { pluginDetailsPath } = await import("../ui/navigate");
    expect(pluginDetailsPath("notes")).toBe("/plugins/notes?view=triage");
    expect(pluginDetailsPath("notes", "cleanup")).toBe("/plugins/notes?view=triage&tab=cleanup");
  });
});
