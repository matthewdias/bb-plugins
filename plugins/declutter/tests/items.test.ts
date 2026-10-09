// The scanner and the stylesheet against bb's markup (tests/fixture.ts):
// what is found, and that hiding one item hides exactly that item.
import { beforeEach, describe, expect, it } from "vitest";
import { cleanLabel, itemOf, keyOf, MARK_ATTR, markTextNamed, scan, selectorsFor, stylesheetFor, type Item } from "../lib/items";
import { byLabel, byPlugin, mountBb } from "./fixture";

/** Hidden when it, or an ancestor, matches a rule for `items`. */
function hiddenBy(items: Item[], el: Element): boolean {
  const selectors = items.flatMap(selectorsFor);
  for (let node: Element | null = el; node; node = node.parentElement) {
    if (selectors.some((selector) => node!.matches(selector))) return true;
  }
  return false;
}

const header = (pluginId: string | null, label: string): Item => ({ surface: "header", pluginId, label });
const banner = (pluginId: string): Item => ({ surface: "banner", pluginId, label: null });
const message = (label: string): Item => ({ surface: "message", pluginId: null, label });

beforeEach(mountBb);

describe("scan", () => {
  it("finds every header control, banner and message action", () => {
    const keys = scan(document).map(keyOf).sort();
    expect(keys).toEqual(
      [
        header("side-chats", "Side chats"),
        header("thread-summary", "Thread Summary"),
        header(null, "Thread actions"),
        header(null, "Open workspace in VS Code"),
        header(null, "Commit"),
        header(null, "Close pane"),
        header(null, "Show right panel"),
        banner("follow-up"),
        banner("gh-context"),
        message("Copy message"),
        message("Mark unread from here"),
        message("Reply in side chat"),
        message("Message actions"),
      ]
        .map(keyOf)
        .sort(),
    );
  });

  it("does not list a plugin's own buttons as bb's", () => {
    const labels = scan(document).map((item) => item.label);
    expect(labels).not.toContain("Open side chat");
    expect(labels).not.toContain("Git: main → origin/main");
  });

  it("names a split button by its first half only", () => {
    const labels = scan(document).map((item) => item.label);
    expect(labels).not.toContain("Choose another app to open workspace");
  });

  it("finds nothing outside bb's markup", () => {
    document.body.innerHTML = `<div data-bb-plugin="x"><button aria-label="Stray"></button></div>`;
    expect(scan(document)).toEqual([]);
  });
});

describe("hiding", () => {
  it("hides one plugin's header control and nothing else", () => {
    const items = [header("side-chats", "Side chats")];
    expect(hiddenBy(items, byLabel("Side chats"))).toBe(true);
    expect(hiddenBy(items, byLabel("Thread Summary"))).toBe(false);
    expect(hiddenBy(items, byLabel("Close pane"))).toBe(false);
  });

  it("hides bb's own header button whether or not it carries a shortcut", () => {
    expect(hiddenBy([header(null, "Show right panel")], byLabel("Show right panel (⌘ J)"))).toBe(true);
    expect(hiddenBy([header(null, "Close pane")], byLabel("Close pane"))).toBe(true);
    expect(hiddenBy([header(null, "Close pane")], byLabel("Show right panel (⌘ J)"))).toBe(false);
  });

  it("hides the whole split button, chooser included", () => {
    const items = [header(null, "Open workspace in VS Code")];
    expect(hiddenBy(items, byLabel("Choose another app to open workspace"))).toBe(true);
  });

  it("hides a split button named only by its text, once marked", () => {
    const commit = [...document.querySelectorAll("button")].find((b) => b.textContent === "Commit")!;
    const items = [header(null, "Commit")];
    expect(hiddenBy(items, commit)).toBe(false);
    expect(markTextNamed(document, items)).toBe(true);
    expect(hiddenBy(items, commit)).toBe(true);
    expect(hiddenBy(items, byLabel("Choose another app to open workspace"))).toBe(false);
  });

  it("unmarks a split button once it is shown again", () => {
    markTextNamed(document, [header(null, "Commit")]);
    expect(markTextNamed(document, [])).toBe(false);
    expect(document.querySelector(`[${MARK_ATTR}]`)).toBeNull();
  });

  it("leaves a plugin's buttons alone when a bb button shares the name", () => {
    // A bb rule must not reach into a plugin root.
    const items = [header(null, "Open side chat")];
    expect(hiddenBy(items, byLabel("Open side chat"))).toBe(false);
  });

  it("hides a plugin's banner but not its controls inside the composer", () => {
    const items = [banner("follow-up")];
    expect(hiddenBy(items, byPlugin("[data-app-composer] > div:first-child", "follow-up"))).toBe(true);
    expect(hiddenBy(items, byLabel("Add follow-up"))).toBe(false);
    expect(hiddenBy(items, byPlugin("[data-app-composer]", "gh-context"))).toBe(false);
  });

  it("hides a message action on every message, and only that one", () => {
    const items = [message("Mark unread from here")];
    expect(hiddenBy(items, byLabel("Mark unread from here"))).toBe(true);
    expect(hiddenBy(items, byLabel("Copy message"))).toBe(false);
  });

  it("writes one rule, or none", () => {
    expect(stylesheetFor([])).toBe("");
    const css = stylesheetFor([message("Copy message"), banner("gh-context")]);
    expect(css.match(/display: none !important/g)).toHaveLength(1);
  });

  it("quotes names that would break a selector", () => {
    const tricky = header(null, 'Say "hi" \\ there');
    const button = document.createElement("button");
    button.setAttribute("aria-label", 'Say "hi" \\ there');
    document.querySelector("[data-thread-header-pane-actions]")!.append(button);
    expect(hiddenBy([tricky], button)).toBe(true);
  });
});

describe("keys", () => {
  it("round-trip", () => {
    for (const item of [header("p", "L"), header(null, "L"), banner("p"), message("L")]) {
      expect(itemOf(keyOf(item))).toEqual(item);
    }
  });

  it("refuse anything else", () => {
    expect(itemOf("nope")).toBeNull();
    expect(itemOf(JSON.stringify(["footer", null, "x"]))).toBeNull();
    expect(itemOf(JSON.stringify(["header", 3, "x"]))).toBeNull();
  });
});

describe("cleanLabel", () => {
  it("drops bb's shortcut hint and keeps other parentheses", () => {
    expect(cleanLabel("Show right panel (⌘ J)")).toBe("Show right panel");
    expect(cleanLabel("Search threads (Ctrl K)")).toBe("Search threads");
    expect(cleanLabel("Pull requests (2)")).toBe("Pull requests (2)");
  });
});
