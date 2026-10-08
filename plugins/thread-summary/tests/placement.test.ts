import { describe, expect, it } from "vitest";
import { CARD_WIDTH, GAP, INSET, placeCard, snapDrawer } from "../lib/placement";

const header = { left: 320, top: 40, width: 1080, height: 48 };
const pane = { left: 320, top: 40, width: 1080, height: 860 };

describe("placeCard", () => {
  it("sits under the header against the pane's right edge, 260 wide", () => {
    expect(placeCard(header, pane)).toEqual({
      left: 1400 - INSET - CARD_WIDTH,
      top: 88 + GAP,
      width: CARD_WIDTH,
      maxHeight: 900 - INSET - (88 + GAP),
    });
  });

  it("keeps a preferred width within 250 to 270", () => {
    expect(placeCard(header, pane, 400).width).toBe(270);
    expect(placeCard(header, pane, 100).width).toBe(250);
  });

  it("narrows to the pane and never starts left of it", () => {
    const narrow = { left: 0, top: 0, width: 200, height: 600 };
    const placed = placeCard({ ...narrow, height: 48 }, narrow);
    expect(placed.width).toBe(200 - 2 * INSET);
    expect(placed.left).toBe(INSET);
  });

  it("never starts left of the pane when anchored to something narrower than the card", () => {
    // No <header> found, so the card hangs from the button alone.
    const placed = placeCard({ left: 0, top: 0, width: 28, height: 28 }, { left: 0, top: 0, width: 600, height: 600 });
    expect(placed.left).toBe(INSET);
    expect(placed.width).toBe(CARD_WIDTH);
  });

  it("stays inside the left pane of a split, not the header's full row", () => {
    const left = { left: 320, top: 40, width: 500, height: 860 };
    const placed = placeCard({ left: 320, top: 40, width: 1080, height: 48 }, left);
    expect(placed.left + placed.width).toBe(820 - INSET);
  });

  it("never reports a negative height", () => {
    expect(placeCard(header, { ...pane, height: 10 }).maxHeight).toBe(0);
  });
});

describe("snapDrawer", () => {
  it("closes when let go below 35 %", () => {
    expect(snapDrawer(340, 1000)).toBe("close");
  });

  it("settles on the nearer of half and full", () => {
    expect(snapDrawer(350, 1000)).toBe("half");
    expect(snapDrawer(700, 1000)).toBe("half");
    expect(snapDrawer(720, 1000)).toBe("full");
    expect(snapDrawer(1000, 1000)).toBe("full");
  });

  it("closes in a viewport with no height", () => {
    expect(snapDrawer(100, 0)).toBe("close");
  });
});
