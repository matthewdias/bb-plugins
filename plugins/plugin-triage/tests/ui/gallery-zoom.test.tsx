// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { Gallery } from "../../ui/Gallery";

vi.mock("@get-bb/plugin-sdk/app", () => ({ experimental_Icon: () => null }));
vi.mock("../../ui/haptics", () => ({ haptic: vi.fn() }));

// jsdom lays nothing out: give the image a fitted size and the stage a place,
// centred at (200, 150).
beforeAll(() => {
  Object.defineProperty(HTMLImageElement.prototype, "offsetWidth", { configurable: true, get: () => 400 });
  Object.defineProperty(HTMLImageElement.prototype, "offsetHeight", { configurable: true, get: () => 300 });
  HTMLElement.prototype.getBoundingClientRect = function () {
    return { left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300, x: 0, y: 0, toJSON() {} } as DOMRect;
  };
});

function setup(shots = ["https://x.test/1.png", "https://x.test/2.png"]) {
  const onIndex = vi.fn();
  const view = render(<Gallery title="Alpha" shots={shots} index={0} onIndex={onIndex} />);
  const stage = screen.getByTestId("gallery-stage");
  const image = screen.getByRole("img");
  const rerender = (index: number | null) => view.rerender(<Gallery title="Alpha" shots={shots} index={index} onIndex={onIndex} />);
  return { onIndex, stage, image, rerender };
}

/** A press, at `at` ms on the clock taps are timed with when given. */
const down = (el: Element, id: number, x: number, y = 150, at?: number) => {
  if (at !== undefined) vi.spyOn(performance, "now").mockReturnValue(at);
  fireEvent.pointerDown(el, { pointerId: id, clientX: x, clientY: y, button: 0 });
};
const move = (el: Element, id: number, x: number, y = 150) => fireEvent.pointerMove(el, { pointerId: id, clientX: x, clientY: y });
const up = (el: Element, id: number, x: number, y = 150) => fireEvent.pointerUp(el, { pointerId: id, clientX: x, clientY: y });
const scaleOf = (image: HTMLElement) => Number(/scale\(([\d.]+)\)/.exec(image.style.transform)?.[1]);

function pinchOpen(stage: Element) {
  down(stage, 1, 150);
  down(stage, 2, 250);
  move(stage, 1, 100);
  move(stage, 2, 300);
}

describe("zooming the gallery", () => {
  it("zooms with a pinch", () => {
    const { stage, image } = setup();
    pinchOpen(stage);
    expect(scaleOf(image)).toBe(2);
  });

  it("pans a zoomed image under one finger instead of paging", () => {
    const { stage, image, onIndex } = setup();
    pinchOpen(stage);
    up(stage, 1, 100);
    up(stage, 2, 300);
    onIndex.mockClear();
    down(stage, 3, 200);
    move(stage, 3, 120);
    up(stage, 3, 120);
    expect(onIndex).not.toHaveBeenCalled();
    expect(image.style.transform).toBe("translate3d(-80px, 0px, 0) scale(2)");
  });

  it("pages with a swipe at fit, as before", () => {
    const { stage, onIndex } = setup();
    down(stage, 1, 300);
    move(stage, 1, 200);
    up(stage, 1, 200);
    expect(onIndex).toHaveBeenCalledWith(1);
  });

  it("zooms in on a double-tap, and back out on another", () => {
    const { image } = setup();
    for (const t of [1000, 1100]) {
      down(image, 1, 260, 150, t);
      up(image, 1, 260);
    }
    expect(scaleOf(image)).toBe(2.5);
    for (const t of [2000, 2100]) {
      down(image, 1, 260, 150, t);
      up(image, 1, 260);
    }
    expect(scaleOf(image)).toBe(1);
  });

  it("does not take two slow taps for a double-tap", () => {
    const { image } = setup();
    for (const t of [1000, 1800]) {
      down(image, 1, 260, 150, t);
      up(image, 1, 260);
    }
    expect(scaleOf(image)).toBe(1);
  });

  it("does not close when a pan ends over the backdrop", () => {
    const { stage, onIndex } = setup();
    pinchOpen(stage);
    up(stage, 1, 100);
    up(stage, 2, 300);
    down(stage, 3, 200);
    move(stage, 3, 100);
    up(stage, 3, 100);
    fireEvent.click(stage);
    expect(onIndex).not.toHaveBeenCalledWith(null);
  });

  it("zooms with a trackpad pinch, and leaves a plain scroll at fit unzoomed", () => {
    const { stage, image } = setup();
    fireEvent(stage, new WheelEvent("wheel", { deltaY: 40, cancelable: true, bubbles: true }));
    expect(scaleOf(image)).toBe(1);
    expect(image.style.transform).toBe("translate3d(0px, 0px, 0) scale(1)");
    const pinchIn = new WheelEvent("wheel", { deltaY: -70, ctrlKey: true, cancelable: true, bubbles: true, clientX: 200, clientY: 150 });
    fireEvent(stage, pinchIn);
    expect(pinchIn.defaultPrevented).toBe(true);
    expect(scaleOf(image)).toBeCloseTo(Math.exp(0.7));
  });

  it("zooms with + and −, resets with 0, and starts at fit on the next screenshot", () => {
    const { image, rerender } = setup();
    fireEvent.keyDown(document.body, { key: "+" });
    expect(scaleOf(image)).toBe(2.5);
    fireEvent.keyDown(document.body, { key: "0" });
    expect(scaleOf(image)).toBe(1);
    fireEvent.keyDown(document.body, { key: "=" });
    rerender(1);
    expect(scaleOf(screen.getByRole("img"))).toBe(1);
  });
});
