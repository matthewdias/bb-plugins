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
    // 45% of a 1200px pane, and the chat moves over by the same.
    expect(section.style.getPropertyValue("--qd-w")).toBe("540px");
    expect(pane.style.getPropertyValue("--qd-dock-w")).toBe("540px");
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

  it("hands a collapsed float back to bb's bar, and floats it again when it reopens", () => {
    const { footer, section } = mountThread({ paneWidth: 800 });
    start();
    section.removeAttribute("data-expanded");
    controller.update();
    expect(section.hasAttribute("data-qd-mode")).toBe(false);
    expect(section.hasAttribute("data-qd-anchor")).toBe(false);
    expect(footer.hasAttribute("data-qd-lifted")).toBe(false);

    section.setAttribute("data-expanded", "");
    controller.update();
    expect(section.getAttribute("data-qd-mode")).toBe("float");
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

describe("resizing the dock", () => {
  it("widens from its left edge, keeps the width, and moves the chat over", () => {
    const { pane, section, label } = mountThread();
    const onClick = vi.fn();
    label.addEventListener("click", onClick);
    start();
    // jsdom does no layout: the card's box is where its CSS variables say.
    section.getBoundingClientRect = () => new DOMRect(736, 100, 456, 600);

    pointer("pointerdown", section, 738, 300);
    pointer("pointermove", section, 700, 300);
    pointer("pointermove", section, 638, 300);
    expect(section.style.getPropertyValue("--qd-w")).toBe("556px");
    expect(pane.style.getPropertyValue("--qd-dock-w")).toBe("556px");
    pointer("pointerup", section, 638, 300);

    expect(localStorage.getItem("question-dock:dock-width")).toBe("556");
    expect(section.getAttribute("data-qd-mode")).toBe("dock");
    expect(onClick).not.toHaveBeenCalled();
  });

  it("leaves a press inside the card alone", () => {
    const { section } = mountThread();
    start();
    section.getBoundingClientRect = () => new DOMRect(736, 100, 456, 600);
    pointer("pointerdown", section, 800, 300);
    pointer("pointermove", section, 700, 300);
    expect(section.style.getPropertyValue("--qd-w")).toBe("540px");
    expect(section.hasAttribute("data-qd-dragging")).toBe(false);
  });

  it("is forgotten by Reset", () => {
    const { section } = mountThread();
    localStorage.setItem("question-dock:dock-width", "600");
    start();
    expect(section.style.getPropertyValue("--qd-w")).toBe("600px");
    controller.reset();
    expect(section.style.getPropertyValue("--qd-w")).toBe("540px");
  });

  it("gives the chat its width back when the card goes", () => {
    const { pane, section } = mountThread();
    start();
    section.remove();
    controller.update();
    expect(pane.style.getPropertyValue("--qd-dock-w")).toBe("");
  });
});

describe("resizing a float", () => {
  it("resizes from its corner, keeps the size, and floats there again", () => {
    const { pane, section, label } = mountThread({ paneWidth: 800 });
    pane.getBoundingClientRect = () => new DOMRect(0, 0, 800, 900);
    const onClick = vi.fn();
    label.addEventListener("click", onClick);
    start();
    expect(section.getAttribute("data-qd-mode")).toBe("float");
    section.getBoundingClientRect = () => new DOMRect(300, 100, 380, 300);

    pointer("pointerdown", section, 675, 395);
    pointer("pointermove", section, 715, 445);
    // While dragged it is exactly the dragged box, top-anchored.
    expect(section.style.getPropertyValue("--qd-w")).toBe("420px");
    expect(section.style.getPropertyValue("--qd-h")).toBe("350px");
    expect(document.documentElement.getAttribute("data-qd-resizing")).toBe("se");
    pointer("pointerup", section, 715, 445);

    expect(document.documentElement.hasAttribute("data-qd-resizing")).toBe(false);
    expect(JSON.parse(localStorage.getItem("question-dock:float-size")!)).toEqual({ width: 420, height: 350 });
    expect(section.getAttribute("data-qd-mode")).toBe("float");
    // Afterwards the width holds and the height is only a ceiling.
    expect(section.style.getPropertyValue("--qd-h")).toBe("");
    expect(onClick).not.toHaveBeenCalled();
  });

  it("marks the edge under the pointer for the cursor, and only there", () => {
    const { section } = mountThread({ paneWidth: 800 });
    start();
    section.getBoundingClientRect = () => new DOMRect(400, 100, 380, 300);
    pointer("pointermove", section, 402, 250);
    expect(section.getAttribute("data-qd-zone")).toBe("w");
    pointer("pointermove", section, 600, 250);
    expect(section.hasAttribute("data-qd-zone")).toBe(false);
  });

  it("is forgotten by Reset", () => {
    const { section } = mountThread({ paneWidth: 800 });
    localStorage.setItem("question-dock:float-size", JSON.stringify({ width: 500, height: 400 }));
    start();
    expect(section.style.getPropertyValue("--qd-w")).toBe("500px");
    controller.reset();
    expect(section.style.getPropertyValue("--qd-w")).toBe("380px");
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

  it("sits on the pane bb fits above the keyboard, and fills it while typing", () => {
    const { pane, section } = mountThread({ paneWidth: 390 });
    // bb's top bar is 48px; the keyboard is up and bb has fitted the pane above it.
    let bottom = 500;
    pane.getBoundingClientRect = () => new DOMRect(0, 48, 390, bottom - 48);
    start();
    expect(section.style.getPropertyValue("--qd-y")).toBe("500px");
    expect(section.style.getPropertyValue("--qd-max-h")).toBe("444px");
    expect(section.style.getPropertyValue("--qd-h")).toBe("226px");

    const other = document.createElement("textarea");
    section.querySelector("#body")!.append(other);
    other.focus();
    controller.update();
    expect(section.style.getPropertyValue("--qd-h")).toBe("444px");

    // The keyboard goes away and bb gives the pane back.
    other.blur();
    bottom = 844;
    controller.update();
    expect(section.style.getPropertyValue("--qd-y")).toBe("844px");
    expect(section.style.getPropertyValue("--qd-h")).toBe("398px");
  });

  it("reaches over the home indicator's inset, except while typing", () => {
    const { pane, section } = mountThread({ paneWidth: 390 });
    const shell = document.createElement("div");
    shell.setAttribute("data-app-content-shell", "");
    shell.style.paddingBottom = "34px";
    pane.replaceWith(shell);
    shell.append(pane);
    pane.getBoundingClientRect = () => new DOMRect(0, 48, 390, 762);
    start();
    // Down to the shell's bottom edge, padded by bb's inset.
    expect(section.style.getPropertyValue("--qd-y")).toBe("844px");
    expect(section.style.getPropertyValue("--qd-pad-b")).toBe("34px");
    expect(section.style.getPropertyValue("--qd-h")).toBe(`${381 + 34}px`);

    const other = document.createElement("textarea");
    section.querySelector("#body")!.append(other);
    other.focus();
    controller.update();
    // The keyboard hides the indicator: no padding under the buttons.
    expect(section.style.getPropertyValue("--qd-pad-b")).toBe("0px");
    expect(section.style.getPropertyValue("--qd-h")).toBe("754px");
  });

  it("stays bb's card when the sheet is turned off", () => {
    const { section } = mountThread({ paneWidth: 390 });
    start({ desktopMode: "dock", mobileSheet: false });
    expect(section.hasAttribute("data-qd-mode")).toBe(false);
  });
});
