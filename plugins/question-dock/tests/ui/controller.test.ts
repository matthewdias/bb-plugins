// The controller against a copy of the markup bb 0.45 draws for a pending
// question: the thread's scroller, its sticky footer, the card and the
// composer. jsdom does no layout, so the pane's width is set by hand.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DockController } from "../../lib/controller.ts";

const win = window as Window & typeof globalThis;

function mountThread({ testId = "user-question-banner", paneWidth = 1200 } = {}) {
  document.body.innerHTML = `
    <div data-page-scroll-viewport>
      <div class="flex min-h-full">
        <div class="chat">messages</div>
        <div data-scroll-footer>
          <section data-testid="${testId}" data-expanded="">
            <div class="header">
              <button type="button" aria-expanded="true" class="label">Question</button>
              <button type="button" aria-expanded="true" aria-label="Hide details"></button>
            </div>
            <div id="body" class="min-h-0 max-h-[min(32rem,50dvh)] overflow-y-auto">options</div>
          </section>
          <div class="composer">composer</div>
        </div>
      </div>
    </div>`;
  const pane = document.querySelector<HTMLElement>("[data-page-scroll-viewport]")!;
  Object.defineProperty(pane, "clientWidth", { configurable: true, value: paneWidth });
  return {
    pane,
    footer: document.querySelector<HTMLElement>("[data-scroll-footer]")!,
    section: document.querySelector<HTMLElement>("section")!,
    label: document.querySelector<HTMLButtonElement>("button.label")!,
  };
}

function pointer(type: string, target: Element, x: number, y: number) {
  target.dispatchEvent(
    new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, pointerId: 1, isPrimary: true, button: 0 }),
  );
}

function setCompact(compact: boolean) {
  win.matchMedia = ((query: string) => ({ matches: compact, media: query })) as typeof win.matchMedia;
}

let controller: DockController;

beforeEach(() => {
  localStorage.clear();
  setCompact(false);
});

afterEach(() => {
  controller?.stop();
  document.body.innerHTML = "";
});

function start(options = { desktopMode: "dock" as const, mobileSheet: true }) {
  controller = new DockController(win, options);
  controller.start();
  return controller;
}

describe("lifting", () => {
  it("docks a question in a wide pane and makes room beside the chat", () => {
    const { pane, footer, section } = mountThread();
    start();
    expect(section.getAttribute("data-qd-mode")).toBe("dock");
    expect(pane.hasAttribute("data-qd-docked")).toBe(true);
    expect(pane.hasAttribute("data-qd-host")).toBe(true);
    expect(footer.hasAttribute("data-qd-lifted")).toBe(true);
    expect(section.style.getPropertyValue("--qd-w")).toBe("380px");
  });

  it("lifts plan reviews and plugin forms too", () => {
    for (const testId of ["plan-review-banner", "plugin-interaction-shell"]) {
      const { section } = mountThread({ testId });
      start();
      expect(section.getAttribute("data-qd-mode")).toBe("dock");
      controller.stop();
    }
  });

  it("leaves an approval where bb puts it", () => {
    const { pane, footer, section } = mountThread({ testId: "approval-banner" });
    start();
    expect(section.hasAttribute("data-qd-mode")).toBe(false);
    expect(pane.hasAttribute("data-qd-host")).toBe(false);
    expect(footer.hasAttribute("data-qd-lifted")).toBe(false);
  });

  it("floats in a pane too narrow to dock, bottom-anchored above the composer", () => {
    const { pane, section } = mountThread({ paneWidth: 800 });
    start();
    expect(section.getAttribute("data-qd-mode")).toBe("float");
    expect(section.getAttribute("data-qd-anchor")).toBe("bottom");
    expect(pane.hasAttribute("data-qd-docked")).toBe(false);
  });

  it("keeps a collapsed float floating, on the same anchor", () => {
    const { section } = mountThread({ paneWidth: 800 });
    start();
    section.removeAttribute("data-expanded");
    controller.update();
    expect(section.getAttribute("data-qd-mode")).toBe("float");
    expect(section.getAttribute("data-qd-anchor")).toBe("bottom");
  });

  it("leaves everything as bb drew it when set to inline", () => {
    const { section } = mountThread();
    start({ desktopMode: "inline" as never, mobileSheet: true });
    expect(section.hasAttribute("data-qd-mode")).toBe(false);
  });

  it("hands a collapsed dock back to bb's bar", () => {
    const { pane, section } = mountThread();
    start();
    section.removeAttribute("data-expanded");
    controller.update();
    expect(section.hasAttribute("data-qd-mode")).toBe(false);
    expect(pane.hasAttribute("data-qd-docked")).toBe(false);
    expect(pane.hasAttribute("data-qd-host")).toBe(false);
  });

  it("cleans the pane and footer when bb removes the answered card", () => {
    const { pane, footer, section } = mountThread();
    start();
    section.remove();
    controller.update();
    expect(pane.hasAttribute("data-qd-docked")).toBe(false);
    expect(pane.hasAttribute("data-qd-host")).toBe(false);
    expect(footer.hasAttribute("data-qd-lifted")).toBe(false);
  });

  it("puts everything back when stopped", () => {
    const { pane, footer, section } = mountThread();
    start();
    controller.stop();
    expect(section.hasAttribute("data-qd-mode")).toBe(false);
    expect(section.hasAttribute("data-qd-anchor")).toBe(false);
    expect(section.style.getPropertyValue("--qd-x")).toBe("");
    expect(pane.hasAttribute("data-qd-host")).toBe(false);
    expect(footer.hasAttribute("data-qd-lifted")).toBe(false);
  });
});

describe("dragging the header", () => {
  it("floats the card and swallows the click that ends the drag", () => {
    const { pane, section, label } = mountThread();
    const onClick = vi.fn();
    label.addEventListener("click", onClick);
    start();

    pointer("pointerdown", label, 100, 100);
    pointer("pointermove", label, 60, 120);
    expect(section.hasAttribute("data-qd-dragging")).toBe(true);
    pointer("pointerup", label, 60, 120);
    label.click();

    expect(onClick).not.toHaveBeenCalled();
    expect(section.getAttribute("data-qd-mode")).toBe("float");
    expect(pane.hasAttribute("data-qd-docked")).toBe(false);
    expect(localStorage.getItem("question-dock:desktop")).toBe("float");
    expect(localStorage.getItem("question-dock:float")).not.toBeNull();
  });

  it("leaves a press that does not move as bb's click", () => {
    const { section, label } = mountThread();
    const onClick = vi.fn();
    label.addEventListener("click", onClick);
    start();

    pointer("pointerdown", label, 100, 100);
    pointer("pointermove", label, 102, 101);
    pointer("pointerup", label, 102, 101);
    label.click();

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(section.getAttribute("data-qd-mode")).toBe("dock");
  });

  it("does not drag from the card's body", () => {
    const { section } = mountThread();
    start();
    const body = section.querySelector("#body")!;
    pointer("pointerdown", body, 100, 100);
    pointer("pointermove", body, 20, 100);
    expect(section.hasAttribute("data-qd-dragging")).toBe(false);
  });
});

describe("on a phone", () => {
  beforeEach(() => setCompact(true));

  it("opens the card as a sheet", () => {
    const { section } = mountThread({ paneWidth: 390 });
    start();
    expect(section.getAttribute("data-qd-mode")).toBe("sheet");
    expect(section.style.getPropertyValue("--qd-h")).not.toBe("");
  });

  it("closes the sheet with bb's toggle when the chat around it is tapped", () => {
    const { section, label } = mountThread({ paneWidth: 390 });
    const onToggle = vi.fn(() => section.removeAttribute("data-expanded"));
    label.addEventListener("click", onToggle);
    start();

    const chat = document.querySelector(".chat")!;
    const onChatClick = vi.fn();
    chat.addEventListener("click", onChatClick);
    pointer("pointerdown", chat, 10, 10);
    pointer("pointerup", chat, 10, 10);
    (chat as HTMLElement).click();
    controller.update();

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onChatClick).not.toHaveBeenCalled();
    expect(section.hasAttribute("data-qd-mode")).toBe(false);
  });

  it("leaves taps inside the sheet alone", () => {
    const { section, label } = mountThread({ paneWidth: 390 });
    const onToggle = vi.fn();
    label.addEventListener("click", onToggle);
    start();
    pointer("pointerdown", section.querySelector("#body")!, 10, 10);
    expect(onToggle).not.toHaveBeenCalled();
    expect(section.getAttribute("data-qd-mode")).toBe("sheet");
  });

  it("keeps the sheet above an on-screen keyboard", () => {
    // A 844px phone with the keyboard up: 500px of it still visible.
    const viewport = Object.assign(new EventTarget(), { offsetTop: 0, height: 500 });
    const saved = ["visualViewport", "innerHeight"].map((name) => [name, Object.getOwnPropertyDescriptor(win, name)] as const);
    Object.defineProperty(win, "visualViewport", { configurable: true, value: viewport });
    Object.defineProperty(win, "innerHeight", { configurable: true, value: 844 });
    try {
      const { section } = mountThread({ paneWidth: 390 });
      localStorage.setItem("question-dock:sheet", "full");
      start();
      // Bottom edge at the top of the keyboard, and never taller than what is visible.
      expect(section.style.getPropertyValue("--qd-y")).toBe("500px");
      expect(section.style.getPropertyValue("--qd-max-h")).toBe("484px");
      expect(section.style.getPropertyValue("--qd-h")).toBe("484px");

      // The keyboard goes away: the sheet follows the visible viewport back down.
      viewport.height = 844;
      viewport.dispatchEvent(new Event("resize"));
      controller.update();
      expect(section.style.getPropertyValue("--qd-y")).toBe("844px");
      expect(section.style.getPropertyValue("--qd-h")).toBe("759.6px");
    } finally {
      for (const [name, descriptor] of saved) {
        if (descriptor) Object.defineProperty(win, name, descriptor);
        else Reflect.deleteProperty(win, name);
      }
    }
  });

  it("stays bb's card when the sheet is turned off", () => {
    const { section } = mountThread({ paneWidth: 390 });
    start({ desktopMode: "dock", mobileSheet: false });
    expect(section.hasAttribute("data-qd-mode")).toBe(false);
  });
});
