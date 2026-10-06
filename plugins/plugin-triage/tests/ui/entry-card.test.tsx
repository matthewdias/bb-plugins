// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EntryCard } from "../../ui/EntryCard";
import { haptic } from "../../ui/haptics";
import { toCard } from "../../lib/new-deck";
import { entry } from "../fixtures";

vi.mock("../../ui/haptics", () => ({ haptic: vi.fn() }));
vi.mock("@get-bb/plugin-sdk/app", () => ({
  experimental_Icon: () => null,
  Markdown: ({ content }: { content: string }) => <div>{content}</div>,
}));

const SHOTS = ["https://x.test/one.png", "https://x.test/two.png"];

function setup({ top = true, expanded = false } = {}) {
  const onToggleDetails = vi.fn();
  const behind = vi.fn();
  const card = toCard(entry({ entryId: "alpha", displayName: "Alpha", screenshots: SHOTS, overview: "The long story." }));
  // Stands in for the card stack, which reads pointer events bubbling up
  // from the card, through React, as a drag.
  render(
    <div onPointerDown={behind} onPointerUp={behind}>
      <EntryCard
        card={card}
        top={top}
        plan={null}
        planError={null}
        expanded={expanded}
        onToggleDetails={onToggleDetails}
      />
    </div>,
  );
  return { onToggleDetails, behind };
}

const galleryImage = () => screen.queryByRole("img", { name: /^Alpha, screenshot/ });

describe("tapping the card", () => {
  it("opens the details from the description", () => {
    const { onToggleDetails } = setup();
    fireEvent.click(screen.getByText("alpha does a thing."));
    expect(onToggleDetails).toHaveBeenCalledTimes(1);
  });

  it("leaves the open details alone, where a tap is for reading", () => {
    const { onToggleDetails } = setup({ expanded: true });
    fireEvent.click(screen.getByText("alpha does a thing."));
    expect(onToggleDetails).not.toHaveBeenCalled();
  });

  it("does nothing on the card waiting underneath", () => {
    const { onToggleDetails } = setup({ top: false });
    fireEvent.click(screen.getByText("alpha does a thing."));
    expect(onToggleDetails).not.toHaveBeenCalled();
  });
});

describe("the screenshot gallery", () => {
  it("opens full screen from the card's screenshot", () => {
    setup();
    expect(galleryImage()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open 2 screenshots" }));
    expect(galleryImage()?.getAttribute("alt")).toBe("Alpha, screenshot 1 of 2");
  });

  it("moves with the arrow keys, and keeps them from the deck behind it", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Open 2 screenshots" }));
    const dialog = screen.getByRole("dialog");
    const event = new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true });
    act(() => {
      dialog.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(galleryImage()?.getAttribute("alt")).toBe("Alpha, screenshot 2 of 2");
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    expect(galleryImage()?.getAttribute("alt")).toBe("Alpha, screenshot 1 of 2");
  });

  it("moves with a swipe, which the card behind it never sees", () => {
    const { behind } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Open 2 screenshots" }));
    const stage = screen.getByTestId("gallery-stage");
    fireEvent.pointerDown(stage, { pointerId: 1, clientX: 300 });
    fireEvent.pointerUp(stage, { pointerId: 1, clientX: 200 });
    expect(galleryImage()?.getAttribute("alt")).toBe("Alpha, screenshot 2 of 2");
    expect(behind).not.toHaveBeenCalled();
  });

  it("ticks on opening and on each screenshot paged to, not on closing", () => {
    setup();
    vi.mocked(haptic).mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Open 2 screenshots" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowRight" });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(vi.mocked(haptic).mock.calls.map(([kind]) => kind)).toEqual(["selection", "selection"]);
  });

  it("closes on Escape", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Open 2 screenshots" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(galleryImage()).toBeNull();
  });

  it("opens at the screenshot tapped in the details, without closing them", () => {
    const { onToggleDetails } = setup({ expanded: true });
    fireEvent.click(screen.getByRole("button", { name: "Open screenshot 2" }));
    expect(galleryImage()?.getAttribute("alt")).toBe("Alpha, screenshot 2 of 2");
    expect(onToggleDetails).not.toHaveBeenCalled();
  });
});
