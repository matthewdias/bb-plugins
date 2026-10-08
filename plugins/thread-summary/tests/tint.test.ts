import { describe, expect, it } from "vitest";
import { MUTED_TINT, TINT, TONE_COLORS, glyphFill, pillColors, toneTint } from "../lib/tone";

describe("toneTint", () => {
  it("mixes a tone's own colour at 15% into transparency", () => {
    expect(TINT).toBe(15);
    expect(toneTint("success")).toBe(`color-mix(in srgb, ${TONE_COLORS.success} 15%, transparent)`);
    expect(toneTint("error")).toBe("color-mix(in srgb, var(--destructive) 15%, transparent)");
    expect(toneTint("warning")).toBe(`color-mix(in srgb, ${TONE_COLORS.warning} 15%, transparent)`);
  });

  it("gives the default tone the muted colour at 14%", () => {
    expect(MUTED_TINT).toBe(14);
    expect(toneTint("default")).toBe("color-mix(in srgb, var(--muted-foreground) 14%, transparent)");
  });

  it("treats a missing or unknown tone as default", () => {
    expect(toneTint(undefined)).toBe(toneTint("default"));
    expect(toneTint("purple")).toBe(toneTint("default"));
    expect(toneTint("toString")).toBe(toneTint("default"));
  });
});

describe("glyphFill", () => {
  it("is the tone's tint", () => {
    expect(glyphFill("info")).toBe(toneTint("info"));
    expect(glyphFill(undefined)).toBe(toneTint("default"));
  });
});

describe("pillColors", () => {
  it("is the tone's tint with text in the tone", () => {
    expect(pillColors("running")).toEqual({ background: toneTint("running"), color: TONE_COLORS.running });
  });

  it("is a muted fill with foreground text for the default tone", () => {
    expect(pillColors("default")).toEqual({ background: toneTint("default"), color: "var(--foreground)" });
    expect(pillColors(undefined)).toEqual(pillColors("default"));
    expect(pillColors("purple")).toEqual(pillColors("default"));
  });
});
