// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CardStack } from "../../ui/CardStack";

vi.mock("@get-bb/plugin-sdk/app", () => ({ experimental_Icon: () => null }));

describe("the card stack", () => {
  it("keeps its drags from bb's mobile sidebar and side-panel swipes", () => {
    render(
      <CardStack
        cards={[{ key: "a" }, { key: "b" }]}
        render={(card) => <span>{card.key}</span>}
        onDecide={() => {}}
        onUndo={() => {}}
        onDetails={() => {}}
      />,
    );
    // bb skips a touch whose target has one of these ancestors.
    const card = screen.getByTestId("top-card");
    expect(card.closest("[data-no-sidebar-swipe]")).not.toBeNull();
    expect(card.closest("[data-no-secondary-panel-swipe]")).not.toBeNull();
  });
});

describe("pressing the top card", () => {
  function setup(scrollable = false) {
    const decided: string[] = [];
    const tapped = vi.fn();
    render(
      <CardStack
        cards={[{ key: "a" }, { key: "b" }]}
        render={(card, top) =>
          top ? (
            <div>
              <button type="button" data-tap onClick={tapped}>
                shot
              </button>
              <div data-scroll="">body</div>
            </div>
          ) : (
            <span>{card.key}</span>
          )
        }
        onDecide={(card, direction) => decided.push(`${card.key}:${direction}`)}
        onUndo={() => {}}
        onDetails={() => {}}
        scrollable={scrollable}
      />,
    );
    const card = screen.getByTestId("top-card");
    // jsdom has no pointer capture.
    card.setPointerCapture = () => {};
    return { decided, tapped, card };
  }

  function press(target: Element, moves: [number, number][], card: Element) {
    fireEvent.pointerDown(target, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    for (const [x, y] of moves) fireEvent.pointerMove(card, { pointerId: 1, clientX: 100 + x, clientY: 100 + y });
    const [x, y] = moves.at(-1) ?? [0, 0];
    fireEvent.pointerUp(card, { pointerId: 1, clientX: 100 + x, clientY: 100 + y });
  }

  it("leaves a tap on the screenshot to the screenshot", async () => {
    const { decided, tapped, card } = setup();
    const shot = screen.getByText("shot");
    fireEvent.pointerDown(shot, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(card, { pointerId: 1, clientX: 102, clientY: 101 });
    // A wobble is not a drag: the card stays put, and nothing captures the
    // pointer away from the screenshot's click.
    expect(card.style.transform).toBe("");
    fireEvent.pointerUp(card, { pointerId: 1, clientX: 102, clientY: 101 });
    fireEvent.click(shot);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(decided).toEqual([]);
    expect(tapped).toHaveBeenCalledTimes(1);
  });

  it("drags the card from the screenshot once the press moves", async () => {
    const { decided, card } = setup();
    press(screen.getByText("shot"), [[-10, 0], [-80, 0], [-160, 0]], card);
    await waitFor(() => expect(decided).toEqual(["a:left"]));
  });

  it("does not save from an upward drag on a scrolling body, which is a scroll", async () => {
    const { decided, card } = setup();
    press(screen.getByText("body"), [[0, -20], [0, -200]], card);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(decided).toEqual([]);
  });

  it("hands vertical touch to the browser while the details are open", () => {
    const { card } = setup(true);
    expect(card.className).toContain("touch-pan-y");
    expect(card.className).not.toContain("touch-none");
  });

  it("holds every touch for the drag while the details are closed", () => {
    const { card } = setup(false);
    expect(card.className).toContain("touch-none");
  });

  it("leaves a press that sets off up or down the details to scroll, and drags one that sets off sideways", async () => {
    const { decided, card } = setup(true);
    const body = screen.getByText("body");
    fireEvent.pointerDown(body, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(card, { pointerId: 1, clientX: 103, clientY: 90 });
    fireEvent.pointerMove(card, { pointerId: 1, clientX: 260, clientY: 90 });
    expect(card.style.transform).toBe("");
    fireEvent.pointerUp(card, { pointerId: 1, clientX: 260, clientY: 90 });

    press(body, [[10, 2], [80, 4], [160, 4]], card);
    await waitFor(() => expect(decided).toEqual(["a:right"]));
  });
});

describe("keys while a card's gallery is open", () => {
  // The real card inside the real stack, as the page draws them.
  async function open(screenshots: string[]) {
    vi.resetModules();
    vi.doMock("@get-bb/plugin-sdk/app", () => ({
      experimental_Icon: () => null,
      Markdown: ({ content }: { content: string }) => <div>{content}</div>,
    }));
    const { CardStack: Stack } = await import("../../ui/CardStack");
    const { EntryCard } = await import("../../ui/EntryCard");
    const { toCard } = await import("../../lib/new-deck");
    const { entry } = await import("../fixtures");
    const decided: string[] = [];
    const cards = [toCard(entry({ entryId: "alpha", displayName: "Alpha", screenshots })), toCard(entry({ entryId: "beta" }))];
    render(
      <Stack
        cards={cards}
        render={(card, top) => <EntryCard card={card} top={top} plan={null} planError={null} expanded={false} />}
        onDecide={(card, direction) => decided.push(`${card.entryId}:${direction}`)}
        onUndo={() => decided.push("undo")}
        onDetails={() => decided.push("details")}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: screenshots.length > 1 ? `Open ${screenshots.length} screenshots` : "Open screenshot" }));
    return decided;
  }
  const shown = () => screen.queryByRole("img", { name: /^Alpha, screenshot/ })?.getAttribute("alt");

  it("page through the screenshots and never decide the card, wherever focus is", async () => {
    const decided = await open(["https://x.test/1.png", "https://x.test/2.png"]);
    // Focus left on the page behind the gallery.
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(shown()).toBe("Alpha, screenshot 2 of 2");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowLeft" });
    expect(shown()).toBe("Alpha, screenshot 1 of 2");
    for (const key of ["ArrowUp", " ", "Enter", "z"]) fireEvent.keyDown(document.body, { key });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(decided).toEqual([]);
  });

  it("do nothing to the card when there is only one screenshot", async () => {
    const decided = await open(["https://x.test/only.png"]);
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(decided).toEqual([]);
    expect(shown()).toBe("Alpha, screenshot");
  });

  it("go back to the deck once the gallery closes", async () => {
    const decided = await open(["https://x.test/1.png", "https://x.test/2.png"]);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(shown()).toBeUndefined();
    fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    await waitFor(() => expect(decided).toEqual(["alpha:left"]));
  });
});

describe("Escape", () => {
  function stack(scrollable: boolean) {
    const onDetails = vi.fn();
    render(
      <CardStack
        cards={[{ key: "a" }]}
        render={(card) => <span>{card.key}</span>}
        onDecide={() => {}}
        onUndo={() => {}}
        onDetails={onDetails}
        scrollable={scrollable}
      />,
    );
    const press = () => {
      const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
      document.body.dispatchEvent(event);
      return event;
    };
    return { onDetails, press };
  }

  it("leaves the open details, before bb's own Escape (back to the app) hears it", () => {
    const { onDetails, press } = stack(true);
    const bb = vi.fn();
    document.addEventListener("keydown", bb, { capture: true });
    expect(press().defaultPrevented).toBe(true);
    document.removeEventListener("keydown", bb, { capture: true });
    expect(onDetails).toHaveBeenCalledTimes(1);
    expect(bb).not.toHaveBeenCalled();
  });

  it("is left to bb while the details are closed", () => {
    const { onDetails, press } = stack(false);
    expect(press().defaultPrevented).toBe(false);
    expect(onDetails).not.toHaveBeenCalled();
  });

  it("closes only the gallery when it is open over the details, then the details", async () => {
    vi.resetModules();
    vi.doMock("@get-bb/plugin-sdk/app", () => ({
      experimental_Icon: () => null,
      Markdown: ({ content }: { content: string }) => <div>{content}</div>,
    }));
    const { CardStack: Stack } = await import("../../ui/CardStack");
    const { EntryCard } = await import("../../ui/EntryCard");
    const { toCard } = await import("../../lib/new-deck");
    const { entry } = await import("../fixtures");
    const onDetails = vi.fn();
    const card = toCard(entry({ entryId: "alpha", displayName: "Alpha", screenshots: ["https://x.test/1.png"] }));
    render(
      <Stack
        cards={[card]}
        render={(c, top) => <EntryCard card={c} top={top} plan={null} planError={null} expanded />}
        onDecide={() => {}}
        onUndo={() => {}}
        onDetails={onDetails}
        scrollable
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open screenshot 1" }));
    expect(screen.queryByRole("dialog")).not.toBeNull();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onDetails).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onDetails).toHaveBeenCalledTimes(1);
  });
});
