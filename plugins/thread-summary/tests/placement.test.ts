import { describe, expect, it } from "vitest";
import { CARD_WIDTH, DRAWER_CLOSE, GAP, INSET, dismissesAt, placeCard } from "../lib/placement";

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

describe("dismissesAt", () => {
  it("closes once dragged down a quarter of the drawer's own height", () => {
    expect(DRAWER_CLOSE).toBe(0.25);
    expect(dismissesAt(100, 400)).toBe(true);
    expect(dismissesAt(300, 400)).toBe(true);
  });

  it("springs back short of it", () => {
    expect(dismissesAt(99, 400)).toBe(false);
    expect(dismissesAt(0, 400)).toBe(false);
  });

  it("measures a short drawer against itself, not the screen", () => {
    // 200px of an 874px phone: a share of the screen would close it on any drag.
    expect(dismissesAt(20, 200)).toBe(false);
    expect(dismissesAt(50, 200)).toBe(true);
  });

  it("never closes without a drag", () => {
    expect(dismissesAt(0, 0)).toBe(false);
  });
});
