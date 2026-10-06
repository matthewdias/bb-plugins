import { describe, expect, it } from "vitest";
import { describeCost, removalCost } from "../lib/removal-cost";

const schema = {
  mode: { label: "Mode", default: "a" },
  width: { label: "Width", default: 300 },
  apiKey: { label: "API key", secret: true as const },
  spare: { label: "Spare key", secret: true as const },
};

describe("what uninstalling deletes", () => {
  it("counts settings changed from their defaults, and only the secrets that are set", () => {
    const cost = removalCost({ schema, values: { mode: "b", width: 300, apiKey: { set: true }, spare: { set: false } } }, 1);
    expect(cost).toEqual({ settings: ["Mode"], secrets: ["API key"], scheduled: true });
  });

  it("finds nothing to lose in a plugin with no settings or schedules", () => {
    expect(removalCost(null, 0)).toEqual({ settings: [], secrets: [], scheduled: false });
  });

  it("says it in a sentence", () => {
    expect(describeCost({ settings: ["Mode"], secrets: [], scheduled: false })).toBe("Uninstalling deletes its changed setting (Mode), for good.");
    expect(describeCost({ settings: ["A", "B", "C"], secrets: ["K1", "K2"], scheduled: true })).toBe(
      "Uninstalling deletes its 3 changed settings (A, B and C), its secrets K1 and K2 and its scheduled work, for good.",
    );
    expect(describeCost({ settings: [], secrets: [], scheduled: false })).toBe(
      "Uninstalling loses nothing you've set; it can be installed again from the store.",
    );
  });
});
