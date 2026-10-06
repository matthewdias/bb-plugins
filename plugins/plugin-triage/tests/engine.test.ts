// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { startScreenEngine } from "../screen/engine";
import { ACTIVE_ATTR, ROOT_ATTR, ROW_ATTR, TRIAGE_HREF } from "../screen/dom";

// bb's Plugins screen as it renders, with the long Tailwind class lists cut
// down to the classes that differ between an active and an idle row.
const ROW = "flex items-center gap-2 rounded-md text-sm pl-2 hover:bg-sidebar-accent w-full";
function screen(active: "browse" | "installed") {
  const row = (href: string, label: string, on: boolean) =>
    `<a ${on ? 'aria-current="page" ' : ""}class="${ROW}${on ? " bg-sidebar-accent text-sidebar-foreground" : " text-sidebar-foreground"}" href="${href}"><span class="min-w-0 flex-1 truncate text-left">${label}</span></a>`;
  return `
<div class="mt-1 space-y-0.5">
  ${row("/plugins", "Browse plugins", active === "browse")}
  ${row("/plugins?view=installed", "Installed plugins", active === "installed")}
</div>
<div id="extensions-main-panel"><div id="bb-content">bb's own page</div></div>`;
}

let path = "/plugins";
const controllers: AbortController[] = [];
let mounted: (HTMLElement | null)[] = [];

function location() {
  const url = new URL(path, "http://bb.test");
  return { pathname: url.pathname, search: url.search };
}

function start(navigate: (to: string) => void = (to) => (path = to)) {
  const controller = new AbortController();
  controllers.push(controller);
  mounted = [];
  return startScreenEngine({
    signal: controller.signal,
    doc: document,
    location,
    defer: (run) => {
      run();
      return () => {};
    },
    navigate,
    onPanel: (container) => mounted.push(container),
  });
}

/**
 * Plugin Shelf's behaviour on the same sidebar, as its engine does it: a My
 * plugins row right after Installed; on its view it takes the highlight from
 * whatever row has it, and on leaving gives it back to that same row.
 */
function startShelfLike() {
  const MINE = "/plugins?view=mine";
  let demoted: HTMLAnchorElement | null = null;
  function sync() {
    const installed = document.querySelector<HTMLAnchorElement>('a[href="/plugins?view=installed"]')!;
    const parent = installed.parentElement!;
    let row = parent.querySelector<HTMLAnchorElement>(":scope > [data-shelf-row]");
    if (row === null) {
      row = installed.cloneNode(true) as HTMLAnchorElement;
      row.removeAttribute("aria-current");
      row.classList.remove("bg-sidebar-accent");
      row.setAttribute("data-shelf-row", "");
      row.setAttribute("href", MINE);
      row.querySelector("span")!.textContent = "My plugins";
      installed.after(row);
    }
    const mine = location().search === "?view=mine";
    if (mine) {
      if (!row.hasAttribute("aria-current")) {
        row.setAttribute("aria-current", "page");
        row.classList.add("bg-sidebar-accent");
      }
      const current = parent.querySelector<HTMLAnchorElement>(':scope > a[aria-current="page"]:not([data-shelf-row])');
      if (current) {
        current.removeAttribute("aria-current");
        current.classList.remove("bg-sidebar-accent");
        demoted = current;
      }
    } else {
      if (row.hasAttribute("aria-current")) {
        row.removeAttribute("aria-current");
        row.classList.remove("bg-sidebar-accent");
      }
      if (demoted !== null) {
        demoted.setAttribute("aria-current", "page");
        demoted.classList.add("bg-sidebar-accent");
        demoted = null;
      }
    }
  }
  const observer = new MutationObserver(sync);
  observer.observe(document.body, { childList: true, subtree: true });
  sync();
  return { sync, stop: () => observer.disconnect() };
}

/** Lets MutationObserver callbacks, and the passes they schedule, run out. */
async function settle() {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.abort();
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  path = "/plugins";
});

const triage = () => document.querySelector<HTMLAnchorElement>(`[${ROW_ATTR}]`);
const row = (href: string) => document.querySelector<HTMLAnchorElement>(`a[href="${href}"]`)!;
const lit = () =>
  [...document.querySelectorAll<HTMLAnchorElement>('a[aria-current="page"]')].map((a) => a.textContent);
const labels = () => [...document.querySelectorAll("a")].map((a) => a.textContent);
const panel = () => document.getElementById("extensions-main-panel")!;

describe("the Triage row", () => {
  it("goes after Installed plugins and links to the in-screen view", () => {
    document.body.innerHTML = screen("installed");
    start().syncNow();
    expect(labels()).toEqual(["Browse plugins", "Installed plugins", "Triage"]);
    expect(triage()!.getAttribute("href")).toBe(TRIAGE_HREF);
    expect(lit()).toEqual(["Installed plugins"]);
  });

  it("is the only lit row on the triage view, though bb marks Browse", () => {
    path = TRIAGE_HREF;
    document.body.innerHTML = screen("browse");
    start().syncNow();
    expect(lit()).toEqual(["Triage"]);
    expect(triage()!.classList.contains("bg-sidebar-accent")).toBe(true);
    expect(row("/plugins").classList.contains("bg-sidebar-accent")).toBe(false);
  });

  it("lights Browse again on leaving for Browse, which bb does not redraw", () => {
    path = TRIAGE_HREF;
    document.body.innerHTML = screen("browse");
    const engine = start();
    engine.syncNow();
    path = "/plugins";
    engine.syncNow();
    expect(lit()).toEqual(["Browse plugins"]);
  });

  it("navigates in-app on a plain click and leaves modified clicks to the browser", () => {
    document.body.innerHTML = screen("browse");
    const went: string[] = [];
    // jsdom would otherwise try to follow the modified click.
    document.addEventListener("click", (event) => event.preventDefault());
    start((to) => went.push(to)).syncNow();
    triage()!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    triage()!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, metaKey: true }));
    expect(went).toEqual([TRIAGE_HREF]);
  });

  it("shows a count, and clears it", () => {
    document.body.innerHTML = screen("browse");
    const engine = start();
    engine.setCount(7);
    engine.syncNow();
    expect(triage()!.textContent).toBe("Triage7");
    // Padded on the right as bb pads the left, so the count isn't flush.
    expect(triage()!.style.paddingRight).toBe("0.5rem");
    engine.setCount(null);
    engine.syncNow();
    expect(triage()!.textContent).toBe("Triage");
    expect(triage()!.style.paddingRight).toBe("");
  });

  it("is removed, and Browse lit again, when the plugin unloads on its page", () => {
    path = TRIAGE_HREF;
    document.body.innerHTML = screen("browse");
    start().syncNow();
    controllers[0]!.abort();
    expect(triage()).toBeNull();
    expect(lit()).toEqual(["Browse plugins"]);
    expect(panel().hasAttribute(ACTIVE_ATTR)).toBe(false);
  });
});

describe("the page container", () => {
  it("stays beside an entry's detail pane, which keeps the view", () => {
    path = "/plugins/thread-tags?view=triage";
    document.body.innerHTML = screen("browse");
    start().syncNow();
    expect(panel().querySelector(`[${ROOT_ATTR}]`)).not.toBeNull();
    expect(lit()).toEqual(["Triage"]);
  });

  it("is not drawn on a plugin's own panel, nor on another view's details", () => {
    for (const other of ["/plugins/thread-tags/panel?view=triage", "/plugins/thread-tags?view=installed", "/pluginsx?view=triage"]) {
      path = other;
      document.body.innerHTML = screen("browse");
      start().syncNow();
      expect(panel().querySelector(`[${ROOT_ATTR}]`), other).toBeNull();
      for (const controller of controllers.splice(0)) controller.abort();
    }
  });

  it("is added on the triage view and hides bb's page by a rule", () => {
    path = TRIAGE_HREF;
    document.body.innerHTML = screen("browse");
    start().syncNow();
    const root = panel().querySelector(`[${ROOT_ATTR}]`);
    expect(root).not.toBeNull();
    expect(mounted.at(-1)).toBe(root);
    expect(panel().hasAttribute(ACTIVE_ATTR)).toBe(true);
    expect(document.head.textContent).toContain(`[${ACTIVE_ATTR}] > :not([${ROOT_ATTR}])`);
  });

  it("goes away on leaving", () => {
    path = TRIAGE_HREF;
    document.body.innerHTML = screen("browse");
    const engine = start();
    engine.syncNow();
    path = "/plugins?view=installed";
    engine.syncNow();
    expect(panel().querySelector(`[${ROOT_ATTR}]`)).toBeNull();
    expect(mounted.at(-1)).toBeNull();
  });
});

describe("beside Plugin Shelf's row", () => {
  it("keeps the same order whichever plugin loads first", async () => {
    document.body.innerHTML = screen("installed");
    const shelf = startShelfLike();
    start().syncNow();
    await settle();
    const shelfFirst = labels();

    shelf.stop();
    for (const controller of controllers.splice(0)) controller.abort();
    document.body.innerHTML = screen("installed");
    start().syncNow();
    const shelf2 = startShelfLike();
    await settle();
    expect(labels()).toEqual(["Browse plugins", "Installed plugins", "My plugins", "Triage"]);
    expect(shelfFirst).toEqual(labels());
    shelf2.stop();
  });

  it("is never left lit on My plugins, nor after leaving it", async () => {
    // Triage → My plugins: Shelf takes the light from the lit row, which is
    // Triage's, and on leaving gives it back to Triage, wherever you went.
    path = TRIAGE_HREF;
    document.body.innerHTML = screen("browse");
    const engine = start();
    const shelf = startShelfLike();
    engine.syncNow();
    await settle();
    expect(lit()).toEqual(["Triage"]);

    path = "/plugins?view=mine";
    shelf.sync();
    engine.syncNow();
    await settle();
    expect(lit()).toEqual(["My plugins"]);

    path = "/plugins";
    shelf.sync();
    await settle();
    expect(lit()).toEqual(["Browse plugins"]);
    shelf.stop();
  });

  it("leaves My plugins lit on its own page", async () => {
    path = "/plugins?view=mine";
    document.body.innerHTML = screen("browse");
    const shelf = startShelfLike();
    start().syncNow();
    await settle();
    expect(lit()).toEqual(["My plugins"]);
    shelf.stop();
  });
});
