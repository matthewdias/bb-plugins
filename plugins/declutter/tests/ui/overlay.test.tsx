// The overlay against bb's markup: it writes the rules for what is hidden,
// rewrites them when another window changes the list, and reports what the
// catalog has not seen.
import { waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { keyOf, MARK_ATTR, type Item } from "../../lib/items";
import { CHANGED } from "../../lib/state";
import { CACHE_KEY, DeclutterOverlay, SCAN_MS, STYLE_ID } from "../../src/overlay";
import type { rpcContract } from "../../server";
import { byLabel, mountBb } from "../fixture";

const side: Item = { surface: "header", pluginId: "side-chats", label: "Side chats" };
const copy: Item = { surface: "message", pluginId: null, label: "Copy message" };

let server: { items: Item[]; hidden: string[]; reports: Item[][] };

function render() {
  return renderSlot<object, typeof rpcContract>({ component: DeclutterOverlay }, {}, {
    rpc: {
      state_get: () => ({
        items: server.items.map((item) => ({ key: keyOf(item), item, firstSeen: 1 })),
        hidden: server.hidden,
      }),
      items_report: ({ items }) => {
        server.reports.push(items as Item[]);
        server.items.push(...(items as Item[]));
        return { added: items.length };
      },
      hidden_set: () => ({ hidden: server.hidden }),
      hidden_reset: () => ({ hidden: [] }),
    },
  });
}

const rules = () => document.getElementById(STYLE_ID)?.textContent ?? "";

beforeEach(() => {
  server = { items: [], hidden: [], reports: [] };
  localStorage.clear();
  mountBb();
});

afterEach(() => {
  vi.useRealTimers();
  document.head.innerHTML = "";
});

describe("the stylesheet", () => {
  it("hides what the server says is hidden", async () => {
    server.hidden = [keyOf(side)];
    render();
    await waitFor(() => expect(rules()).toContain('[aria-label="Side chats"]'));
    expect(byLabel("Side chats").matches(rules().split(" {")[0]!)).toBe(true);
  });

  it("applies the last list at once, before the server answers", () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify([keyOf(copy)]));
    render();
    expect(rules()).toContain('[aria-label="Copy message"]');
  });

  it("follows another window's change", async () => {
    const view = render();
    await waitFor(() => expect(view.rpcCalls.map((call) => call.method)).toContain("state_get"));
    server.hidden = [keyOf(copy)];
    await view.emitRealtime(CHANGED, null);
    await waitFor(() => expect(rules()).toContain('[aria-label="Copy message"]'));
    expect(JSON.parse(localStorage.getItem(CACHE_KEY)!)).toEqual([keyOf(copy)]);
  });

  it("goes away when nothing is hidden, and when the plugin unloads", async () => {
    server.hidden = [keyOf(side)];
    const view = render();
    await waitFor(() => expect(rules()).not.toBe(""));
    server.hidden = [];
    await view.emitRealtime(CHANGED, null);
    await waitFor(() => expect(document.getElementById(STYLE_ID)).toBeNull());
    server.hidden = [keyOf(side)];
    await view.emitRealtime(CHANGED, null);
    await waitFor(() => expect(rules()).not.toBe(""));
    view.unmount();
    expect(document.getElementById(STYLE_ID)).toBeNull();
  });
});

describe("split buttons named by text", () => {
  const commit: Item = { surface: "header", pluginId: null, label: "Commit" };
  const marked = () => document.querySelectorAll(`[${MARK_ATTR}]`).length;

  it("keeps Commit marked when bb draws it again, and unmarks it when shown", async () => {
    server.hidden = [keyOf(commit)];
    const view = render();
    await waitFor(() => expect(marked()).toBe(1));
    // bb re-renders the header: the old split button goes, a new one arrives.
    const actions = document.querySelector("[data-thread-header-workflow-actions]")!;
    actions.querySelector(`[${MARK_ATTR}]`)!.remove();
    const fresh = document.createElement("span");
    fresh.setAttribute("data-thread-header-responsive-action", "");
    fresh.innerHTML = "<button>Commit</button>";
    actions.append(fresh);
    await waitFor(() => expect(fresh.hasAttribute(MARK_ATTR)).toBe(true));
    server.hidden = [];
    await view.emitRealtime(CHANGED, null);
    await waitFor(() => expect(marked()).toBe(0));
  });
});

describe("reporting", () => {
  it("reports only what the catalog lacks, once", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    server.items = [side];
    render();
    await vi.advanceTimersByTimeAsync(SCAN_MS + 10);
    await waitFor(() => expect(server.reports).toHaveLength(1));
    const reported = server.reports[0]!.map(keyOf);
    expect(reported).toContain(keyOf(copy));
    expect(reported).not.toContain(keyOf(side));
    await vi.advanceTimersByTimeAsync(SCAN_MS * 2);
    expect(server.reports).toHaveLength(1);
  });
});
