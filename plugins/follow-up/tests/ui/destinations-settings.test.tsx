import { describe, expect, it } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { DestinationsSettings } from "../../src/destinations-settings.tsx";
import type { Destination } from "../../lib/destinations.ts";

// The Settings section where destinations are set up: built by the user, from
// a blank or from an example, and saved as one list.

function renderSettings(saved: Destination[] = [], outcome = "saved") {
  const state = { saved: [...saved] };
  return renderSlot({ component: DestinationsSettings }, {}, {
    rpc: {
      followups_destinations: async () => ({ destinations: state.saved, defaultId: null }),
      followups_set_destinations: async ({ destinations }: { destinations: Destination[] }) => {
        if (outcome === "saved") state.saved = destinations;
        return { outcome, destinations: state.saved };
      },
    } as never,
  });
}

type Slot = ReturnType<typeof renderSettings>;
const saves = (slot: Slot) =>
  slot.inspection.rpcCalls
    .filter((call) => call.method === "followups_set_destinations")
    .map((call) => (call.input as { destinations: Destination[] }).destinations);

describe("destinations in Settings", () => {
  it("starts from an example, and saves it with an id from its name", async () => {
    const slot = renderSettings();
    fireEvent.click(await slot.findByRole("button", { name: "Start from “GitHub issue”" }));
    expect((slot.getByRole("textbox", { name: "Command" }) as HTMLTextAreaElement).value).toContain(
      '"$FOLLOWUP_TITLE"',
    );
    fireEvent.click(slot.getByRole("button", { name: "Save destinations" }));
    await waitFor(() =>
      expect(saves(slot)).toEqual([
        [
          {
            id: "github-issue",
            name: "GitHub issue",
            kind: "command",
            command: 'gh issue create --title "$FOLLOWUP_TITLE" --body "$FOLLOWUP_DETAIL"',
          },
        ],
      ]),
    );
    expect(await slot.findByRole("status")).toHaveProperty("textContent", "Saved.");
  });

  it("an agent destination saves its recipe, on the describing model unless one is chosen", async () => {
    const slot = renderSettings();
    fireEvent.click(await slot.findByRole("button", { name: "Add a destination" }));
    fireEvent.change(slot.getByRole("textbox", { name: "Destination name" }), {
      target: { value: "Jira ENG" },
    });
    fireEvent.click(slot.getByRole("radio", { name: "Ask an agent" }));
    fireEvent.change(slot.getByRole("textbox", { name: "Recipe" }), {
      target: { value: "File it in ENG." },
    });
    fireEvent.click(slot.getByRole("button", { name: "Save destinations" }));
    await waitFor(() =>
      expect(saves(slot)).toEqual([
        [{ id: "jira-eng", name: "Jira ENG", kind: "agent", recipe: "File it in ENG.", execution: null }],
      ]),
    );
  });

  it("refuses to save an incomplete destination, and says which", async () => {
    const slot = renderSettings();
    fireEvent.click(await slot.findByRole("button", { name: "Add a destination" }));
    fireEvent.click(slot.getByRole("button", { name: "Save destinations" }));
    expect((await slot.findByRole("status")).textContent).toBe("Every destination needs a name.");
    fireEvent.change(slot.getByRole("textbox", { name: "Destination name" }), {
      target: { value: "GitHub" },
    });
    fireEvent.click(slot.getByRole("button", { name: "Save destinations" }));
    expect((await slot.findByRole("status")).textContent).toBe("GitHub needs a command.");
    expect(saves(slot)).toEqual([]);
  });

  it("says so when two destinations share a name", async () => {
    const slot = renderSettings([], "duplicate-name");
    fireEvent.click(await slot.findByRole("button", { name: "Start from “GitHub issue”" }));
    fireEvent.click(slot.getByRole("button", { name: "Save destinations" }));
    expect((await slot.findByRole("status")).textContent).toBe(
      "Two destinations share a name. Names have to differ.",
    );
  });

  it("removes a destination, keeping an existing one's id", async () => {
    const slot = renderSettings([
      { id: "github", name: "GitHub", kind: "command", command: "gh issue create" },
      { id: "jira-eng", name: "Jira ENG", kind: "agent", recipe: "File it.", execution: null },
    ]);
    fireEvent.click(await slot.findByRole("button", { name: "Remove GitHub" }));
    fireEvent.click(slot.getByRole("button", { name: "Save destinations" }));
    await waitFor(() =>
      expect(saves(slot)).toEqual([
        [{ id: "jira-eng", name: "Jira ENG", kind: "agent", recipe: "File it.", execution: null }],
      ]),
    );
  });
});
