import { describe, expect, it } from "vitest";
import { complicationView, toneColor, TONE_COLORS } from "../badges/complication-view";

const prefs = { showText: false, hideWhenComplete: false };
const gauge = (fraction: number, extra: object = {}) => ({
  icon: "TextWrap",
  label: "Progress",
  fraction,
  ...extra,
});

describe("complicationView", () => {
  it("draws nothing for an unanswered or silent value", () => {
    expect(complicationView(undefined, prefs)).toBeNull();
    expect(complicationView(null, prefs)).toBeNull();
  });

  it("draws a fraction as a ring, coloured by tone", () => {
    expect(complicationView(gauge(0.25, { tone: "default" }), prefs)).toEqual({
      kind: "ring",
      fraction: 0.25,
      label: "Progress",
      color: TONE_COLORS.default,
      running: false,
      text: null,
    });
    expect(complicationView(gauge(1, { tone: "success" }), prefs)?.color).toBe(TONE_COLORS.success);
  });

  it("draws anything else as the provider's icon", () => {
    expect(
      complicationView({ icon: "Plug", label: "vite :5173", tone: "error" }, prefs),
    ).toEqual({
      kind: "glyph",
      icon: "Plug",
      label: "vite :5173",
      color: TONE_COLORS.error,
      running: false,
      text: null,
    });
  });

  it("shows text only when asked, and only when the value has some", () => {
    const value = gauge(0.5, { text: "3" });
    expect(complicationView(value, prefs)?.text).toBeNull();
    expect(complicationView(value, { ...prefs, showText: true })?.text).toBe("3");
    expect(complicationView(gauge(0.5), { ...prefs, showText: true })?.text).toBeNull();
  });

  it("hides a full gauge only when asked, and never a glyph", () => {
    const hide = { ...prefs, hideWhenComplete: true };
    expect(complicationView(gauge(1), prefs)).not.toBeNull();
    expect(complicationView(gauge(1), hide)).toBeNull();
    expect(complicationView(gauge(0.99), hide)).not.toBeNull();
    expect(complicationView({ icon: "Check", label: "Done", tone: "success" }, hide)).not.toBeNull();
  });

  it("marks a running value so it can pulse", () => {
    expect(complicationView({ icon: "Clock", label: "Building", tone: "running" }, prefs)?.running).toBe(true);
    expect(complicationView(gauge(0.5, { tone: "running" }), prefs)?.running).toBe(true);
  });
});

describe("toneColor", () => {
  it("covers the whole vocabulary, and draws an unknown tone as default", () => {
    for (const tone of ["default", "info", "success", "warning", "error", "running"]) {
      expect(toneColor(tone)).toBe(TONE_COLORS[tone]);
    }
    expect(toneColor("urgent")).toBe(TONE_COLORS.default);
    expect(toneColor(undefined)).toBe(TONE_COLORS.default);
    expect(toneColor("toString")).toBe(TONE_COLORS.default);
  });
});
