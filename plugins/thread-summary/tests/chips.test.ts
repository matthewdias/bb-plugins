import { describe, expect, it } from "vitest";
import { SHORT_TEXT, isShortText } from "../lib/order";

describe("isShortText", () => {
  it("treats up to eight characters as short: counts, ahead and behind, short states", () => {
    expect(SHORT_TEXT).toBe(8);
    for (const text of ["1", "↑145", "↑3 ↓1", "↑141 ↓26", "merged", "blocked", ":5173", "100%"]) {
      expect(isShortText(text)).toBe(true);
    }
  });

  it("treats anything longer as long", () => {
    for (const text of ["conflicts", "checks failing", "changes requested", "↑1410 ↓26"]) {
      expect(isShortText(text)).toBe(false);
    }
  });

  it("counts characters, not UTF-16 units", () => {
    expect("↑141 ↓26".length).toBe(8);
    expect(isShortText("😀😀😀😀😀😀😀😀")).toBe(true);
    expect(isShortText("😀😀😀😀😀😀😀😀😀")).toBe(false);
  });

  it("treats no text as short: the glyph alone", () => {
    expect(isShortText(undefined)).toBe(true);
  });
});
