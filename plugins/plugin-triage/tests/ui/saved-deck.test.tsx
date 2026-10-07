// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EntryDeck } from "../../ui/EntryDeck";
import { resetDecisions } from "../../ui/decisions";
import { resetTriageStore, triageStore } from "../../ui/triage-store";
import { toCard } from "../../lib/new-deck";
import { entry } from "../fixtures";

const toCompose = vi.fn();
const openUrl = vi.fn();
const call = vi.fn(async (method: string) => (method === "entry_plan" ? { summary: null, confirmedSource: null } : {}));
vi.mock("@get-bb/plugin-sdk/app", () => ({
  experimental_Icon: () => null,
  Markdown: ({ content }: { content: string }) => <div>{content}</div>,
  useRpc: () => ({ call }),
  useBbNavigate: () => ({ toCompose, openUrl }),
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), dismiss: vi.fn() }) }));
vi.mock("../../ui/haptics", () => ({ haptic: vi.fn() }));

afterEach(() => {
  resetDecisions();
  resetTriageStore();
});

const alpha = toCard(entry({ entryId: "alpha", overview: "The long story." }));

function setup(cards = [alpha]) {
  render(<EntryDeck deck="saved" cards={cards} keyboard empty={<p>Nothing saved</p>} />);
}

describe("the Saved tab", () => {
  it("deals saved plugins as a deck, with its own decisions", () => {
    setup();
    expect(screen.getByTestId("top-card")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Install (→)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove from Saved (←)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Move to the back (↑)" })).toBeTruthy();
    expect(screen.getByText(/forget · ↑ later · → install · space details/)).toBeTruthy();
  });

  it("opens a card's details from a tap, as the New deck does", () => {
    setup();
    fireEvent.click(screen.getByText("alpha does a thing."));
    expect(screen.getByRole("button", { name: /Less/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("The long story.")).toBeTruthy();
  });

  it("vets the plugin with an agent from the card", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Vet with an agent" }));
    expect(toCompose).toHaveBeenCalledWith(expect.objectContaining({ focusPrompt: true }));
  });

  it("sends the top card to the back on ↑, where it stays saved", async () => {
    const beta = toCard(entry({ entryId: "beta" }));
    triageStore.addSaved(beta);
    triageStore.addSaved(alpha);
    setup(triageStore.getSnapshot().saved);
    fireEvent.click(screen.getByRole("button", { name: "Move to the back (↑)" }));
    await waitFor(() => expect(triageStore.getSnapshot().saved.map((card) => card.entryId)).toEqual(["beta", "alpha"]));
    expect(call.mock.calls.map(([method]) => method)).not.toContain("decide");
  });

  it("explains an empty deck", () => {
    setup([]);
    expect(screen.getByText("Nothing saved")).toBeTruthy();
    expect(screen.queryByTestId("top-card")).toBeNull();
  });
});
