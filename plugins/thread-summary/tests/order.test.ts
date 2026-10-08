import { describe, expect, it } from "vitest";
import type { ComplicationValue } from "../lib/complications";
import { GIT_ID, PULL_REQUEST_ID, chips, orderedIds, present, worstTone } from "../lib/order";
import { SEVERITY, severityOf, toneColor } from "../lib/tone";

const value = (tone?: string, label = tone ?? "none"): ComplicationValue => ({
  icon: "Circle",
  label,
  ...(tone !== undefined ? { tone } : {}),
});

const entries = (tones: (string | undefined)[]) =>
  tones.map((tone, index) => ({ provider: { id: `p/${index}` }, value: value(tone, `v${index}`) }));

describe("orderedIds", () => {
  it("puts Git and the pull request first, then the rest in registration order", () => {
    expect(orderedIds(["follow-up/progress", PULL_REQUEST_ID, "other/x", GIT_ID], new Set())).toEqual([
      GIT_ID,
      PULL_REQUEST_ID,
      "follow-up/progress",
      "other/x",
    ]);
  });

  it("leaves hidden providers out, Git and the pull request included", () => {
    expect(
      orderedIds([GIT_ID, PULL_REQUEST_ID, "follow-up/progress"], new Set([GIT_ID, "follow-up/progress"])),
    ).toEqual([PULL_REQUEST_ID]);
  });

  it("does not invent Git or the pull request when they are not registered", () => {
    expect(orderedIds(["follow-up/progress"], new Set())).toEqual(["follow-up/progress"]);
  });
});

describe("present", () => {
  it("keeps only providers that have answered with a value", () => {
    const providers = [{ id: "a/a" }, { id: "b/b" }, { id: "c/c" }];
    expect(present(providers, [value("error"), null, undefined]).map((entry) => entry.provider.id)).toEqual([
      "a/a",
    ]);
  });
});

describe("severity", () => {
  it("ranks error, warning, running, info, success, default", () => {
    expect([...SEVERITY]).toEqual(["error", "warning", "running", "info", "success", "default"]);
    expect(severityOf("error")).toBeLessThan(severityOf("warning"));
    expect(severityOf("warning")).toBeLessThan(severityOf("running"));
    expect(severityOf("running")).toBeLessThan(severityOf("info"));
    expect(severityOf("info")).toBeLessThan(severityOf("success"));
    expect(severityOf("success")).toBeLessThan(severityOf("default"));
  });

  it("ranks and colours an unknown or missing tone as default", () => {
    expect(severityOf("purple")).toBe(severityOf("default"));
    expect(severityOf(undefined)).toBe(severityOf("default"));
    expect(severityOf("constructor")).toBe(severityOf("default"));
    expect(toneColor("purple")).toBe(toneColor("default"));
    expect(toneColor("toString")).toBe(toneColor("default"));
  });
});

describe("chips", () => {
  it("takes the three worst, worst first", () => {
    const picked = chips(entries(["success", "error", "default", "warning", "info"]));
    expect(picked.map((entry) => entry.value.label)).toEqual(["v1", "v3", "v4"]);
  });

  it("breaks ties by provider order", () => {
    const picked = chips(entries(["warning", "error", "warning", "warning"]));
    expect(picked.map((entry) => entry.value.label)).toEqual(["v1", "v0", "v2"]);
  });

  it("draws fewer when fewer have something to say, quiet ones included", () => {
    expect(chips(entries(["default"])).map((entry) => entry.value.label)).toEqual(["v0"]);
    expect(chips([])).toEqual([]);
  });
});

describe("worstTone", () => {
  it("is the worst tone present", () => {
    expect(worstTone(entries(["info", "running", "success"]))).toBe("running");
    expect(worstTone(entries(["success"]))).toBe("success");
  });

  it("is null when everything is quiet, or nothing has spoken", () => {
    expect(worstTone(entries(["default", undefined, "purple"]))).toBeNull();
    expect(worstTone([])).toBeNull();
  });
});
