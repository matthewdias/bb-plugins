// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { haptic } from "../../ui/haptics";
import { CardStack } from "../../ui/CardStack";
import { DECIDE_DISTANCE } from "../../lib/gesture";

vi.mock("@get-bb/plugin-sdk/app", () => ({ experimental_Icon: () => null }));
vi.mock("../../ui/haptics", () => ({ haptic: vi.fn() }));

const kinds = () => vi.mocked(haptic).mock.calls.map(([kind]) => kind);

function setup() {
  render(
    <CardStack
      cards={[{ key: "a" }, { key: "b" }]}
      render={(card) => <span>{card.key}</span>}
      onDecide={() => {}}
      onUndo={() => {}}
      onDetails={() => {}}
    />,
  );
  const card = screen.getByTestId("top-card");
  card.setPointerCapture = () => {};
  fireEvent.pointerDown(card, { pointerId: 1, button: 0, clientX: 200, clientY: 200 });
  const move = (dx: number, dy = 0) => fireEvent.pointerMove(card, { pointerId: 1, clientX: 200 + dx, clientY: 200 + dy });
  const up = (dx: number, dy = 0) => fireEvent.pointerUp(card, { pointerId: 1, clientX: 200 + dx, clientY: 200 + dy });
  return { move, up };
}

beforeEach(() => vi.mocked(haptic).mockClear());

describe("haptics on the deck", () => {
  it("tick once as a drag crosses into deciding, not on every move after", () => {
    const { move } = setup();
    move(20);
    move(DECIDE_DISTANCE - 1);
    expect(kinds()).toEqual([]);
    move(DECIDE_DISTANCE + 1);
    move(DECIDE_DISTANCE + 40);
    expect(kinds()).toEqual(["selection"]);
  });

  it("tick again when the drag swings to another decision, and fall back silently", () => {
    const { move } = setup();
    move(DECIDE_DISTANCE + 10);
    move(10);
    move(-(DECIDE_DISTANCE + 10));
    move(0, -(DECIDE_DISTANCE + 200));
    expect(kinds()).toEqual(["selection", "selection", "selection"]);
  });

  it("thud firmer for an install than for a dismissal", () => {
    const stack = setup();
    stack.move(DECIDE_DISTANCE + 10);
    stack.up(DECIDE_DISTANCE + 10);
    expect(kinds().at(-1)).toBe("impact-medium");
  });

  it("thud lightly for a dismissal", () => {
    const { move, up } = setup();
    move(-(DECIDE_DISTANCE + 10));
    up(-(DECIDE_DISTANCE + 10));
    expect(kinds()).toEqual(["selection", "impact-light"]);
  });

  it("stay silent for a drag that snaps back", () => {
    // Under the flick minimum: jsdom fires events a millisecond apart, so a
    // longer drag here would read as a fast flick and decide.
    const { move, up } = setup();
    move(30);
    up(30);
    expect(kinds()).toEqual([]);
  });
});
