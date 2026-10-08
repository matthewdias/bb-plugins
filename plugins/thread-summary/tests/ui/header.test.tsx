import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
// Loaded at the top, not inside a test: the first load pulls in every
// hugeicons icon through the settings checkbox and the vendored overlay, which
// can outlast a test's timeout on a busy machine (#18).
import pluginApp from "../../app";
import { SummaryAction } from "../../src/header";
import { resetDeviceState } from "../../src/device-state";
import { isOpen } from "../../src/open-cards";
import { resetHiddenProviders } from "../../src/use-hidden-providers";
import { GIT_ID, PULL_REQUEST_ID } from "../../lib/order";
import { disposeProviders, freshThread, hiddenBackend, provide, sidebarThread } from "./fixtures";

void pluginApp;

beforeEach(() => {
  window.localStorage.clear();
  resetDeviceState();
  resetHiddenProviders();
});
afterEach(() => {
  disposeProviders();
});

interface Options {
  threadId?: string;
  compact?: boolean;
  showChips?: boolean;
  hidden?: string[];
  openFilePreview?: (options: unknown) => boolean;
}

function render({ threadId = freshThread(), compact = false, showChips = true, hidden = [], openFilePreview }: Options = {}) {
  const slot = renderSlot(
    { component: SummaryAction },
    { threadId, projectId: "proj_1", isCompactViewport: compact },
    {
      pluginId: "thread-summary",
      settings: { showChips },
      rpc: hiddenBackend(hidden) as never,
      sidebarThreads: { status: "ready", threads: [sidebarThread(threadId)] },
      ...(openFilePreview !== undefined ? { openFilePreview: openFilePreview as never } : {}),
    },
  );
  return { slot, threadId };
}

const button = (slot: ReturnType<typeof render>["slot"]) => slot.getByRole("button", { name: "Thread summary" });
const card = () => document.querySelector<HTMLElement>("[data-thread-summary-card]");
const chipIds = () =>
  Array.from(document.querySelectorAll("[data-thread-summary-chip]")).map((chip) => chip.getAttribute("data-thread-summary-chip"));

/** Three providers about one thread: Git (warning), the PR (error), and a gauge (default). */
function seed(threadId: string) {
  provide(
    { id: "follow-up/progress", name: "Follow-up progress" },
    { [threadId]: { icon: "TextWrap", label: "1 of 4 follow-ups done", fraction: 0.25, text: "3" } },
  );
  provide(
    { id: PULL_REQUEST_ID, name: "Pull request" },
    {
      [threadId]: {
        icon: "GitPullRequest",
        label: "#41 Thread Summary",
        tone: "error",
        text: "checks failing",
        detail: { title: "#41 Thread Summary", rows: [{ label: "Checks", value: "failing", tone: "error" }] },
        open: { href: "https://github.com/matthewdias/bb-plugins/pull/41" },
      },
    },
  );
  provide(
    { id: GIT_ID, name: "Git" },
    {
      [threadId]: {
        icon: "GitBranch",
        label: "feature → main",
        tone: "warning",
        text: "↑3 ↓1",
        detail: {
          title: "feature → main",
          rows: [
            { label: "Ahead · behind", value: "3 · 1", tone: "warning" },
            { label: "app.tsx", value: "+4 −1", file: "plugins/thread-summary/app.tsx" },
          ],
        },
      },
    },
  );
}

describe("the header", () => {
  it("draws the button as the PropertyNew glyph, bundled, since bb 0.45 has no icon by that name", () => {
    const { slot } = render();
    const svg = button(slot).querySelector("svg");
    expect(svg?.getAttribute("data-icon")).toBe("PropertyNew");
    // The glyph itself, not a name the host would fall back from: its
    // horizontal rule under the title bar is unique to PropertyNew.
    const paths = Array.from(svg?.querySelectorAll("path") ?? []).map((path) => path.getAttribute("d"));
    expect(paths).toContain("M3.50008 7.99991H20.5001");
  });

  it("sizes the button's glyph as bb sizes its own header icons, stroke scaling with it", () => {
    const { slot } = render();
    const svg = button(slot).querySelector("svg")!;
    // bb's header icons: 16px, and 20px on a phone with a coarse pointer.
    expect(svg.getAttribute("class")?.split(" ")).toEqual(
      expect.arrayContaining(["size-4", "max-md:pointer-coarse:size-5"]),
    );
    // Room for 20px in the 28px button: padding would shrink the glyph,
    // a flex item, back to 16px.
    expect(svg.getAttribute("class")?.split(" ")).toContain("shrink-0");
    const buttonClasses = button(slot).className.split(" ");
    expect(buttonClasses).toEqual(expect.arrayContaining(["size-7", "p-0"]));
    expect(buttonClasses.filter((name) => /^p[xy]?-/.test(name))).toEqual(["p-0"]);
    // In the 24-unit viewBox, so 1px at 16px and 1.25px at 20px, as theirs.
    expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(Array.from(svg.querySelectorAll("path")).every((path) => path.getAttribute("stroke-width") === "1.5")).toBe(true);
  });

  it("shows chips, worst first, and no dot", async () => {
    const { slot, threadId } = render();
    seed(threadId);
    await waitFor(() => expect(chipIds()).toEqual([PULL_REQUEST_ID, GIT_ID, "follow-up/progress"]));
    expect(slot.getByRole("button", { name: "Pull request: #41 Thread Summary (checks failing)" })).toBeTruthy();
    expect(document.querySelector("[data-thread-summary-dot]")).toBeNull();
  });

  it("caps a chip's text at 112px, the same for every provider, and no wider than its text", async () => {
    const { slot, threadId } = render();
    seed(threadId);
    await waitFor(() => expect(chipIds()).toHaveLength(3));
    const texts = Array.from(document.querySelectorAll("[data-thread-summary-chip] span.truncate"));
    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts) {
      const classes = text.className.split(" ");
      expect(classes).toContain("max-w-28");
      expect(classes.filter((name) => /^(max-)?w-/.test(name))).toEqual(["max-w-28"]);
      expect(classes).toContain("min-w-0");
    }
    void slot;
  });

  it("lets the chips shrink to share bb's 256px, while the button never does", async () => {
    // bb wraps a header action in `flex max-w-64 shrink-0`; jsdom cannot lay
    // that out, so this guards the classes and the live check the layout.
    const { slot, threadId } = render();
    seed(threadId);
    await waitFor(() => expect(chipIds()).toHaveLength(3));
    const group = document.querySelector<HTMLElement>("[data-thread-summary-header]")!;
    expect(group.className.split(" ")).toEqual(expect.arrayContaining(["min-w-0", "max-w-full"]));
    for (const chip of Array.from(document.querySelectorAll("[data-thread-summary-chip]"))) {
      expect(chip.className.split(" ")).toEqual(expect.arrayContaining(["min-w-0", "shrink"]));
      expect(chip.querySelector("span.truncate")?.className.split(" ")).toContain("min-w-0");
    }
    const classes = button(slot).className.split(" ");
    expect(classes).toContain("shrink-0");
    expect(classes).not.toContain("shrink");
  });

  it("draws at most three chips", async () => {
    const { threadId } = render();
    seed(threadId);
    provide({ id: "extra/one", name: "Extra" }, { [threadId]: { icon: "Circle", label: "x", tone: "info" } });
    await waitFor(() => expect(chipIds()).toEqual([PULL_REQUEST_ID, GIT_ID, "extra/one"]));
  });

  it("with chips off, shows a dot in the worst tone instead", async () => {
    const { threadId } = render({ showChips: false });
    seed(threadId);
    await waitFor(() =>
      expect(document.querySelector("[data-thread-summary-dot]")?.getAttribute("data-thread-summary-dot")).toBe("error"),
    );
    expect(chipIds()).toEqual([]);
  });

  it("with chips off, shows no dot when everything is quiet", async () => {
    const { threadId } = render({ showChips: false });
    provide({ id: GIT_ID, name: "Git" }, { [threadId]: { icon: "GitBranch", label: "main", text: "↑0" } });
    await waitFor(() => expect(chipIds()).toEqual([]));
    expect(document.querySelector("[data-thread-summary-dot]")).toBeNull();
  });

  it("on a compact viewport, shows only the button and its dot, whatever the setting", async () => {
    const { threadId } = render({ compact: true, showChips: true });
    seed(threadId);
    await waitFor(() =>
      expect(document.querySelector("[data-thread-summary-dot]")?.getAttribute("data-thread-summary-dot")).toBe("error"),
    );
    expect(chipIds()).toEqual([]);
  });

  it("leaves hidden providers off the chips and the card", async () => {
    const { slot, threadId } = render({ hidden: [PULL_REQUEST_ID] });
    seed(threadId);
    await waitFor(() => expect(chipIds()).toEqual([GIT_ID, "follow-up/progress"]));
    fireEvent.click(button(slot));
    expect(card()!.querySelector(`[data-thread-summary-block="${PULL_REQUEST_ID}"]`)).toBeNull();
  });
});

describe("the card", () => {
  it("opens from a chip", async () => {
    const { slot, threadId } = render();
    seed(threadId);
    await waitFor(() => expect(chipIds()).toHaveLength(3));
    fireEvent.click(slot.getByRole("button", { name: /^Git:/ }));
    expect(card()).not.toBeNull();
    expect(button(slot).getAttribute("aria-expanded")).toBe("true");
  });

  it("draws one block per provider, Git and the PR first, named by the provider", async () => {
    const { slot, threadId } = render();
    seed(threadId);
    fireEvent.click(button(slot));
    await waitFor(() =>
      expect(Array.from(card()!.querySelectorAll("[data-thread-summary-block]")).map((block) => block.getAttribute("data-thread-summary-block"))).toEqual([
        GIT_ID,
        PULL_REQUEST_ID,
        "follow-up/progress",
      ]),
    );
    const git = within(card()!).getByRole("group", { name: "Git" });
    expect(git.getAttribute("title")).toBe("Git");
    expect(git.textContent).toBe("feature → main↑3 ↓1");
    // A gauge draws as the ring.
    expect(within(card()!).getByRole("group", { name: "Follow-up progress" }).querySelector("svg circle")).not.toBeNull();
  });

  it("shows a provider's detail rows with its line, with no mode to switch", async () => {
    const { slot, threadId } = render();
    seed(threadId);
    fireEvent.click(button(slot));
    await waitFor(() => expect(within(card()!).getByText("Ahead · behind")).toBeTruthy());
    expect(within(card()!).queryByRole("button", { name: /details|headlines/i })).toBeNull();
  });

  it("links a headline to its open href", async () => {
    const { slot, threadId } = render();
    seed(threadId);
    fireEvent.click(button(slot));
    await waitFor(() => expect(within(card()!).getByRole("link", { name: "#41 Thread Summary" })).toBeTruthy());
    expect(within(card()!).getByRole("link", { name: "#41 Thread Summary" }).getAttribute("href")).toBe(
      "https://github.com/matthewdias/bb-plugins/pull/41",
    );
  });

  it("draws an unsafe href as plain text", async () => {
    const { slot, threadId } = render();
    provide(
      { id: "evil/link", name: "Evil" },
      {
        [threadId]: {
          icon: "Circle",
          label: "Click me",
          open: { href: "/\t/evil.example" },
          detail: { rows: [{ label: "row link", href: "javascript:alert(1)" }, { label: "file", file: "../../etc/passwd" }] },
        },
      },
    );
    fireEvent.click(button(slot));
    await waitFor(() => expect(within(card()!).getByText("row link")).toBeTruthy());
    const block = card()!.querySelector<HTMLElement>('[data-thread-summary-block="evil/link"]')!;
    expect(within(block).queryAllByRole("link")).toEqual([]);
    expect(within(block).getByText("Click me").closest("a")).toBeNull();
  });

  it("shows the first eight rows, then how many more", async () => {
    const { slot, threadId } = render();
    const rows = Array.from({ length: 11 }, (_, index) => ({ label: `row ${index}` }));
    provide({ id: "many/rows", name: "Many" }, { [threadId]: { icon: "Circle", label: "Many rows", detail: { rows } } });
    fireEvent.click(button(slot));
    await waitFor(() => expect(within(card()!).getByText("row 7")).toBeTruthy());
    expect(within(card()!).queryByText("row 8")).toBeNull();
    expect(within(card()!).getByText("3 more")).toBeTruthy();
  });

  it("does not say more when there are exactly eight", async () => {
    const { slot, threadId } = render();
    const rows = Array.from({ length: 8 }, (_, index) => ({ label: `row ${index}` }));
    provide({ id: "eight/rows", name: "Eight" }, { [threadId]: { icon: "Circle", label: "Eight rows", detail: { rows } } });
    fireEvent.click(button(slot));
    await waitFor(() => expect(within(card()!).getByText("row 7")).toBeTruthy());
    expect(within(card()!).queryByText(/more$/)).toBeNull();
  });

  it("opens a file row in the thread's workspace", async () => {
    const openFilePreview = vi.fn(() => true);
    const { slot, threadId } = render({ openFilePreview });
    seed(threadId);
    fireEvent.click(button(slot));
    const link = await waitFor(() => within(card()!).getByRole("link", { name: "app.tsx" }));
    fireEvent.click(link);
    expect(openFilePreview).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { kind: "workspace", environmentId: "env_1", path: "plugins/thread-summary/app.tsx" },
      }),
    );
  });

  it("tells the Git provider while it is open, so Git refreshes and polls", () => {
    const { slot, threadId } = render();
    expect(isOpen(threadId)).toBe(false);
    fireEvent.click(button(slot));
    expect(isOpen(threadId)).toBe(true);
    fireEvent.click(button(slot));
    expect(isOpen(threadId)).toBe(false);
  });

  it("says so when no provider has anything to say", () => {
    const { slot } = render();
    fireEvent.click(button(slot));
    expect(within(card()!).getByText("Nothing to report for this thread.")).toBeTruthy();
  });

  it("has no controls of its own", () => {
    const { slot } = render();
    fireEvent.click(button(slot));
    expect(within(card()!).queryAllByRole("button")).toEqual([]);
    expect(card()!.querySelector("[data-thread-summary-strip]")).toBeNull();
    expect(within(card()!).queryByRole("link", { name: /settings/i })).toBeNull();
  });
});

describe("showing and hiding", () => {
  it("toggles from the button, and says which it is", () => {
    const { slot } = render();
    expect(card()).toBeNull();
    expect(button(slot).getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button(slot));
    expect(card()).not.toBeNull();
    expect(button(slot).getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(button(slot));
    expect(card()).toBeNull();
    expect(button(slot).getAttribute("aria-expanded")).toBe("false");
  });

  it("remembers showing on this device, and forgets it when hidden", () => {
    const { slot } = render();
    fireEvent.click(button(slot));
    expect(window.localStorage.getItem("thread-summary:shown")).toBe("true");
    fireEvent.click(button(slot));
    expect(window.localStorage.getItem("thread-summary:shown")).toBe("false");
  });

  it("stays showing through a thread switch", () => {
    const { slot } = render();
    fireEvent.click(button(slot));
    act(() => {
      slot.lifecycle.rerender(<SummaryAction isCompactViewport={false} projectId="proj_1" threadId={freshThread()} />);
    });
    expect(card()).not.toBeNull();
  });

  it("stays hidden through a thread switch", () => {
    const { slot } = render();
    act(() => {
      slot.lifecycle.rerender(<SummaryAction isCompactViewport={false} projectId="proj_1" threadId={freshThread()} />);
    });
    expect(card()).toBeNull();
  });

  it("shows at once in a header mounted while showing, as a reload or a thread switch can mount it", () => {
    window.localStorage.setItem("thread-summary:shown", "true");
    render();
    expect(card()).not.toBeNull();
  });

  it("does not show by itself otherwise", () => {
    render();
    expect(card()).toBeNull();
  });

  it("is not closed by a click outside, or in one of bb's portaled overlays", () => {
    const { slot } = render();
    fireEvent.click(button(slot));
    fireEvent.pointerDown(document.body);
    fireEvent.click(document.body);
    const menu = document.createElement("div");
    menu.setAttribute("data-bb-portaled-overlay", "");
    menu.innerHTML = "<button>menu item</button>";
    document.body.append(menu);
    fireEvent.pointerDown(menu.querySelector("button")!);
    menu.remove();
    expect(card()).not.toBeNull();
  });
});

describe("the keyboard", () => {
  // A click a key made has no click count; a mouse click has one.
  const keyboardClick = (element: Element) => fireEvent.click(element, { detail: 0 });
  const mouseClick = (element: Element) => fireEvent.click(element, { detail: 1 });

  it("moves focus into the card when the button opens it from the keyboard", () => {
    const { slot } = render();
    button(slot).focus();
    keyboardClick(button(slot));
    expect(card()!.contains(document.activeElement)).toBe(true);
  });

  it("moves focus into the card when a chip opens it from the keyboard", async () => {
    const { slot, threadId } = render();
    seed(threadId);
    const chip = await waitFor(() => slot.getByRole("button", { name: /^Git:/ }));
    chip.focus();
    keyboardClick(chip);
    expect(card()!.contains(document.activeElement)).toBe(true);
  });

  it("leaves focus alone when the mouse opens it", () => {
    const { slot } = render();
    button(slot).focus();
    mouseClick(button(slot));
    expect(card()).not.toBeNull();
    expect(card()!.contains(document.activeElement)).toBe(false);
  });

  it("hides on Escape from inside the card, and returns focus to the button", () => {
    const { slot } = render();
    keyboardClick(button(slot));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(card()).toBeNull();
    expect(document.activeElement).toBe(button(slot));
    expect(window.localStorage.getItem("thread-summary:shown")).toBe("false");
  });

  it("ignores Escape pressed anywhere else", () => {
    const { slot } = render();
    mouseClick(button(slot));
    const composer = document.createElement("textarea");
    document.body.append(composer);
    composer.focus();
    fireEvent.keyDown(composer, { key: "Escape" });
    expect(card()).not.toBeNull();
    expect(document.activeElement).toBe(composer);
    composer.remove();
  });

  it("leaves an Escape that something else already handled alone", () => {
    const { slot } = render();
    keyboardClick(button(slot));
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    event.preventDefault();
    act(() => {
      document.activeElement!.dispatchEvent(event);
    });
    expect(card()).not.toBeNull();
  });
});
