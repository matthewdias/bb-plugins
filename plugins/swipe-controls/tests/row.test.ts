import { describe, expect, it } from "vitest";
import { ROW, type RowLayout, armOf, clampOffset, fullPx, releaseOf, revealWidth } from "../lib/row.ts";

const layout = (overrides: Partial<RowLayout> = {}): RowLayout => ({
  width: 300,
  trailingActions: 2,
  leading: true,
  trailing: true,
  full: true,
  ...overrides,
});

describe("geometry", () => {
  it("opens to one button width per action", () => {
    expect(revealWidth(layout())).toBe(2 * ROW.actionWidthPx);
  });

  it("puts the full swipe past the buttons and most of the row", () => {
    expect(fullPx(layout({ width: 400 }))).toBe(400 * ROW.fullRatio);
    expect(fullPx(layout({ width: 200 }))).toBe(200 - ROW.fullEdgeMarginPx);
    expect(fullPx(layout({ width: 260 }))).toBe(revealWidth(layout()) + ROW.fullExtraPx);
  });
});

describe("clampOffset", () => {
  it("follows the finger both ways when both are allowed", () => {
    expect(clampOffset(50, layout())).toBe(50);
    expect(clampOffset(-50, layout())).toBe(-50);
  });

  it("refuses a direction the row doesn't take", () => {
    expect(clampOffset(50, layout({ leading: false }))).toBe(0);
    expect(clampOffset(-50, layout({ trailing: false }))).toBe(0);
  });

  it("resists past the buttons when there is no full swipe", () => {
    const reveal = revealWidth(layout());
    expect(clampOffset(-(reveal + 100), layout({ full: false }))).toBe(-(reveal + 100 * ROW.overdragResistance));
    expect(clampOffset(-(reveal + 100), layout())).toBe(-(reveal + 100));
  });

  it("never travels past the row's width", () => {
    expect(clampOffset(-1000, layout())).toBe(-300);
    expect(clampOffset(1000, layout())).toBe(300);
  });
});

describe("armOf", () => {
  it("arms the leading action at its distance", () => {
    expect(armOf(ROW.leadingArmPx - 1, layout())).toBe(null);
    expect(armOf(ROW.leadingArmPx, layout())).toBe("leading");
  });

  it("arms the full swipe at its distance, only when enabled", () => {
    const full = fullPx(layout());
    expect(armOf(-(full - 1), layout())).toBe(null);
    expect(armOf(-full, layout())).toBe("full");
    expect(armOf(-full, layout({ full: false }))).toBe(null);
  });
});

describe("releaseOf", () => {
  it("springs back short of every threshold", () => {
    expect(releaseOf(20, 0, layout())).toBe("close");
    expect(releaseOf(-20, 0, layout())).toBe("close");
  });

  it("takes the leading action when armed", () => {
    expect(releaseOf(ROW.leadingArmPx, 0, layout())).toBe("leading");
  });

  it("lets a flick back cancel an armed action", () => {
    expect(releaseOf(ROW.leadingArmPx, -1, layout())).toBe("close");
    expect(releaseOf(-fullPx(layout()), 1, layout())).toBe("close");
  });

  it("takes the leading action from a short fling", () => {
    expect(releaseOf(ROW.leadingArmPx / 2, 1, layout())).toBe("leading");
    expect(releaseOf(ROW.leadingArmPx / 2 - 1, 1, layout())).toBe("close");
  });

  it("stays open past half the buttons", () => {
    const half = revealWidth(layout()) / 2;
    expect(releaseOf(-half, 0, layout())).toBe("open");
    expect(releaseOf(-(half - 1), 0, layout())).toBe("close");
  });

  it("opens from a short leftward fling", () => {
    expect(releaseOf(-ROW.flingMinPx, -1, layout())).toBe("open");
    expect(releaseOf(-(ROW.flingMinPx - 1), -1, layout())).toBe("close");
  });

  it("archives on a full swipe", () => {
    expect(releaseOf(-fullPx(layout()), 0, layout())).toBe("full");
  });

  it("only opens, never archives, when the full swipe is off", () => {
    expect(releaseOf(-280, 0, layout({ full: false }))).toBe("open");
  });
});
