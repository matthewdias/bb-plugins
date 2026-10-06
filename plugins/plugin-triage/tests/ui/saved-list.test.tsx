// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SavedList } from "../../ui/SavedList";
import { toCard } from "../../lib/new-deck";
import { entry } from "../fixtures";

vi.mock("@get-bb/plugin-sdk/app", () => ({ experimental_Icon: () => null }));

function setup(overrides: Parameters<typeof entry>[0] = { entryId: "alpha" }) {
  const handlers = {
    onDetails: vi.fn(),
    onInstall: vi.fn(),
    onRemove: vi.fn(),
    onOpen: vi.fn(),
    onVet: vi.fn(),
  };
  render(<SavedList cards={[toCard(entry(overrides))]} {...handlers} />);
  return handlers;
}

describe("a saved card", () => {
  it("opens the plugin's details when the card is clicked", () => {
    const handlers = setup();
    fireEvent.click(screen.getByRole("button", { name: "alpha details" }));
    expect(handlers.onDetails).toHaveBeenCalledTimes(1);
    expect(handlers.onInstall).not.toHaveBeenCalled();
  });

  it("installs from its footer without opening the details", () => {
    const handlers = setup();
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    expect(handlers.onInstall).toHaveBeenCalledTimes(1);
    expect(handlers.onDetails).not.toHaveBeenCalled();
  });

  it("names the author with their GitHub avatar, as bb's cards do", () => {
    setup({ entryId: "alpha", author: { name: "Some One", github: "someone", url: null } });
    expect(screen.getByText("Some One")).toBeTruthy();
    expect(document.querySelector('img[src^="https://github.com/someone.png"]')).not.toBeNull();
  });

  it("can't install an incompatible plugin, and says why", () => {
    setup({ entryId: "alpha", compatible: false, incompatibleReason: "requires bb >=0.46" });
    const install = screen.getByRole("button", { name: "Install" }) as HTMLButtonElement;
    expect(install.disabled).toBe(true);
    expect(install.title).toBe("requires bb >=0.46");
  });

  it("explains an empty list", () => {
    render(
      <SavedList cards={[]} onDetails={vi.fn()} onInstall={vi.fn()} onRemove={vi.fn()} onOpen={vi.fn()} onVet={vi.fn()} />,
    );
    expect(screen.getByText(/Nothing saved/)).toBeTruthy();
  });
});
